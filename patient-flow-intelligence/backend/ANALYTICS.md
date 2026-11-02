# Indicadores e apoio operacional — passo 7

Esta implementação usa regras determinísticas e médias históricas simples,
identificadas por `rules-v1`. O treino e utilização de modelos inteligentes
pertencem exclusivamente ao passo 10 futuro do [plano](PLAN.md).

## API e autorização

Todos os endpoints exigem Bearer token e o acesso organizacional definido em
[SECURITY.md](SECURITY.md). O administrador consulta globalmente; os gestores
recebem apenas dados dos seus âmbitos. Filtros nunca ampliam esse acesso.

| Método e caminho | Parâmetros |
| --- | --- |
| `GET /api/analytics/indicators` | `ulsId`, `unitId`, `serviceId`, `from`, `to` |
| `GET /api/analytics/alerts` | `ulsId`, `unitId`, `serviceId` |
| `GET /api/analytics/occupancy-forecast` | `ulsId`, `unitId`, `serviceId`, `page`, `size` |
| `GET /api/admission-requests/{id}/bed-suggestions` | `preferredWardId`, `limit` |

A análise agrega ULS, unidade ou serviço. `wardId` é rejeitado para evitar
atribuir a uma enfermaria uma fila que só tem serviço de destino. Os episódios
históricos sem serviço só participam nos indicadores globais do administrador;
não podem ser classificados em cenários de um serviço.

Uma coleção num âmbito sem correspondência fica vazia; rates/médias sem
denominador ou amostras são `null`. Um pedido de admissão externo ao âmbito
devolve `404`. Falta de papel/associação devolve `403`.

## Períodos e fotografia atual

`asOf` identifica o instante capturado para a fotografia atual. As consultas de
um pedido usam uma transação de leitura consistente. As datas são ISO-8601 com
fuso; os cálculos usam instantes e durações de 24 horas.

O período histórico é `[from, to)`: início incluído, fim excluído. Por omissão,
`to=asOf` e `from=to-30 dias`. Exige-se `from < to`, `to <= asOf` e uma janela
máxima de 366 dias. O período não altera a fotografia de camas/fila atual,
pois o sistema ainda não dispõe de um histórico completo de capacidade/bloqueios.

## Fórmulas dos indicadores

| Campo | Definição |
| --- | --- |
| `beds.total` | Todas as camas visíveis |
| `beds.capacity` | Total menos camas `BLOCKED`; camas em limpeza continuam na capacidade |
| `beds.available`, `occupied`, `blocked`, `cleaning` | Contagens do estado atual |
| `beds.occupancyPercent` | `100 × occupied / capacity`; `null` com capacidade zero |
| `stays.active` | Episódios `IN_PROGRESS` visíveis |
| `stays.admissionsInPeriod` | Início do episódio no período, qualquer estado atual |
| `stays.dischargesInPeriod` | Episódios terminados cuja alta administrativa pertence ao período |
| `stays.averageLengthOfStayDays` | Média de `(alta administrativa - admissão) / 86400` nas altas do período com início conhecido |
| `stays.lengthOfStaySamples` | Número de episódios usados nessa média |
| `stays.prolongedActiveStays` | Episódios ativos com duração igual ou superior a `longStayDays` |
| `stays.oldestActiveStayDays` | Maior duração de episódio ativo com início conhecido |
| `stays.clinicalDischargePending` | Episódios ativos com alta clínica registada |
| `stays.oldestClinicalPendingHours` | Maior intervalo atual desde a alta clínica, sem valores negativos |
| `stays.averageClinicalAdministrativeHours` | Média entre alta clínica e administrativa nas altas do período com ambas as datas |
| `stays.dischargeDelaySamples` | Número de episódios usados nessa média |
| `stays.expectedDischarges24h`, `48h` | Altas previstas futuras de episódios ativos até ao respetivo horizonte; contagens cumulativas |
| `stays.overdueExpectedDischarges` | Episódios ativos com data prevista anterior a `asOf` |

Para cada pedido em espera, `dueAt = max(requestedAt, desiredAdmissionAt)`;
na ausência de data pretendida, usa-se `requestedAt`.

| Campo | Definição |
| --- | --- |
| `waiting.pending` | Todos os pedidos `WAITING`, incluindo os agendados para o futuro |
| `waiting.dueNow` | Pedidos `WAITING` com `dueAt <= asOf` |
| `waiting.emergencyDueNow` | Subconjunto devido com origem `EMERGENCY` |
| `waiting.overdue` | Pedidos cuja espera desde `dueAt` atingiu o limiar de aviso |
| `waiting.averageWaitingHours`, `oldestWaitingHours` | Média/máximo da espera dos pedidos já devidos |

O futuro agendamento de uma cirurgia não é contado como espera atual só por
o pedido ter sido registado antes. Percentagens e durações são apresentadas
com duas casas decimais; amostras desconhecidas não são substituídas por zero.

## Alertas e limiares

`GET /api/analytics/alerts` calcula alertas sobre o âmbito solicitado e devolve
`asOf`, os limiares usados e uma lista com `code`, `severity`, `explanation`,
`observed`, `threshold`, `unit`, `affectedCount`.

| Código | Condição |
| --- | --- |
| `OCCUPANCY_PRESSURE` | Ocupação atinge aviso/crítico |
| `NO_AVAILABLE_BEDS` | Nenhuma cama livre e existem pedidos já devidos |
| `WAITING_TIME` | Maior espera atinge aviso/crítico |
| `CLEANING_BACKLOG` | Número de camas em limpeza atinge o limiar |
| `PROLONGED_STAYS` | Existem internamentos ativos prolongados; observado é a maior duração |
| `CLINICAL_DISCHARGE_DELAY` | Alta clínica pendente de fecho administrativo acima do limiar |
| `OVERDUE_DISCHARGE_PLAN` | Existem datas previstas ultrapassadas |

Para localizar pressão num serviço, filtrar por `serviceId`. Alertas são
calculados no pedido, sem estado de reconhecimento/persistência. Os eventos
da etapa 6 permitem invalidar as vistas após alterações; o cliente deve também
atualizar periodicamente os alertas que dependem apenas da passagem do tempo.

Valores iniciais de demonstração, configuráveis no arranque:

| Variável | Omissão | Unidade |
| --- | --- | --- |
| `OCCUPANCY_WARNING_PERCENT` | 85 | % |
| `OCCUPANCY_CRITICAL_PERCENT` | 95 | % |
| `LONG_STAY_DAYS` | 14 | dias |
| `WAITING_WARNING_HOURS` | 4 | horas |
| `WAITING_CRITICAL_HOURS` | 12 | horas |
| `CLEANING_WARNING_BEDS` | 3 | camas |
| `CLINICAL_WARNING_HOURS` | 6 | horas |
| `FORECAST_HISTORY_DAYS` | 14 | dias, entre 1 e 90 |

O arranque rejeita limiares inválidos, negativos ou aviso superior a crítico.

## Sugestões de camas

O pedido tem de estar `WAITING`. Pedidos encerrados devolvem `409`. Quando
o doente já tem um internamento ativo, a resposta é `eligible=false`, motivo
`ACTIVE_ENCOUNTER`, sem sugestões. Não são expostos dados desse internamento.

São candidatas apenas camas `AVAILABLE` do serviço solicitado. A enfermaria
preferida, opcional, tem de ser autorizada e pertencer ao mesmo serviço.

```text
score = 100 + (20 se enfermaria preferida) - 5 × min(camas ocupadas no quarto, 10)
```

Maior pontuação vem primeiro. Empates são resolvidos por código de enfermaria,
quarto, cama e UUID. A prioridade ordena os pedidos na fila; não altera a
classificação de camas para um mesmo pedido. `limit` vai de 1 a 20, por omissão
5. Há um limite de 5000 candidatas por serviço.

Cada sugestão inclui cama, localização, pontuação e códigos das razões. A
pontuação é operacional, não uma probabilidade nem uma avaliação clínica.
Não são inferidas necessidades de isolamento/equipamento ou compatibilidades
que o domínio ainda não representa. A consulta não reserva camas nem admite
doentes; `/admit` volta a verificar estado e concorrência.

## Cenários de ocupação a 24/48 horas

Os cenários são paginados por serviço (`page=0`, `size=20`, máximo 100), para
evitar que capacidade livre de outro serviço esconda procura não satisfeita.
Cada linha devolve contagens de entrada, horizontes e qualidade do histórico.

O histórico é `[asOf-historyDays, asOf)`. Para um horizonte `h`:

```text
admissões esperadas = pedidos conhecidos devidos até asOf+h
                   + admissões históricas sem pedido associado × h / (historyDays × 24)

altas esperadas = min(ocupação atual,
                     max(altas previstas futuras até asOf+h,
                         altas históricas × h / (historyDays × 24)))

procura projetada = max(0, ocupação atual + admissões esperadas - altas esperadas)
ocupação projetada = min(capacidade, procura projetada)
procura não satisfeita = max(0, procura projetada - capacidade)
```

As altas históricas são administrativas. Usa-se o máximo entre altas planeadas
e média histórica para evitar somar duas vezes as mesmas saídas. Planos já
ultrapassados são alertados, mas não assumidos como saídas futuras confirmadas.
Admissões com pedido associado não são extrapoladas novamente sobre a fila
conhecida. A projeção pressupõe capacidade constante e não prevê tempos de
limpeza ou altas dos novos doentes durante o horizonte.

Contagens projetadas podem ser fracionárias. O resultado apresenta estimativas
com duas casas decimais, percentagem `null` com capacidade zero e `unmetDemand`
quando há excesso de procura. `NO_OBSERVED_HISTORY` sinaliza ausência de eventos
históricos usados; `OBSERVED_COUNTS_ONLY` não garante cobertura completa da
janela. A falta de dados ou dados sintéticos limitam a interpretação.

## Integração com algorithms e degradação

O serviço Python expõe `POST /v1/bed-ranking` e `POST /v1/occupancy-forecast`.
Só recebe candidatos ou contagens já autorizados; não recebe JWT, SNS, nome,
nascimento ou dados demográficos. A API pública continua no backend com Keycloak.

| Variável/configuração | Omissão |
| --- | --- |
| `ALGORITHMS_ENABLED` | `true` |
| `ALGORITHMS_URL` | `http://localhost:8000` |
| `patientflow.algorithms.connect-timeout` | `500ms` |
| `patientflow.algorithms.request-timeout` | `1s` |

O backend limita a resposta a 256 KiB e valida versão, identificadores, ordem
e resultados contra o contrato determinístico. Erros HTTP, timeout, JSON
malformado ou resultados contraditórios ativam a alternativa local equivalente.
As respostas identificam `engine.source`, `algorithmVersion`, `degraded` e
`reason`. Não há tentativas repetidas que prolonguem um pedido por indisponibilidade.
Desativar explicitamente o serviço usa a referência local sem marcar uma avaria.

Os contratos de exemplo em `algorithms/tests/fixtures/rules-v1.json` são usados
pelos testes Java e Python. Uma evolução para modelos treinados exigirá um novo
contrato no passo 10, sem substituir silenciosamente o significado de `rules-v1`.

Para atualizar o serviço no ambiente de desenvolvimento:

```bash
docker compose up -d --build algorithms
```

O backend corre localmente e usa a porta publicada 8000. Se for executado numa
rede Docker, configurar `ALGORITHMS_URL` para o endereço interno adequado.
