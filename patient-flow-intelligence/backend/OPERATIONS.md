# Contratos de gestão operacional

Todos os caminhos abaixo exigem Bearer token e são relativos a `/api`.
O administrador tem acesso global. Gestores precisam de papel e associação ao
âmbito organizacional. A autorização é aplicada no servidor, independentemente
dos filtros enviados. Gestão da hierarquia e registo/correção demográfica são
reservados ao administrador. Ver [SECURITY.md](SECURITY.md) para a matriz completa.

## Convenções

As coleções devolvem `content`, `page`, `size`, `totalElements`, `totalPages`.
`page` começa em zero; `size` está limitado a 1–100, por omissão 20. A ordenação
é estável, incluindo UUID para desempate. Nenhuma consulta de coleção devolve
entidades JPA ou árvores sem limite.

Os filtros organizacionais aplicados dependem da coleção:

| Coleção | Filtros |
| --- | --- |
| Camas, mapa, episódios e alocações | `ulsId`, `unitId`, `buildingId`, `floorId`, `serviceId`, `wingId`, `wardId`, `roomId` |
| Doentes | `ulsId`, `unitId`, `serviceId`, `wardId` |
| Pedidos de admissão | `ulsId`, `unitId`, `buildingId`, `floorId`, `serviceId` |

Os filtros suportados combinam-se por interseção. Um UUID válido sem
correspondência produz uma coleção vazia, tal como um filtro que não intersecte
o âmbito autorizado. Um recurso individual inexistente ou fora desse âmbito
devolve `404`.

Limitações atuais do DTO de filtros partilhado: em doentes, os filtros físicos
adicionais não são suportados de forma consistente e não devem ser usados;
na fila, `wardId` devolve `400`, enquanto `wingId` e `roomId` referenciam aliases
SQL ausentes e podem causar erro de servidor. Pedidos ainda não admitidos não
têm cama/enfermaria atribuída. Os filtros analíticos estão em [ANALYTICS.md](ANALYTICS.md).

Datas são ISO-8601 com fuso e normalizadas a microssegundos. Campos de texto
têm um máximo de 255 caracteres. Erros de entrada devolvem `400`; conflitos
de estado/integridade/versão devolvem `409`, com `application/problem+json`.

## Hierarquia e serviços clínicos

| Método | Caminho | Comportamento |
| --- | --- | --- |
| GET | `/hierarchy/{type}?parentId=…` | Lista paginada de filhos; omitir `parentId` lista o nível |
| GET | `/hierarchy/{type}/{id}` | Consulta individual |
| POST | `/hierarchy/{type}` | Cria, devolve `201` e o elemento |
| PUT | `/hierarchy/{type}/{id}` | Atualiza o nome de apresentação |
| DELETE | `/hierarchy/{type}/{id}` | Remove apenas se não existirem filhos ou referências; sucesso `204` |

`type` aceita maiúsculas/minúsculas:

| Tipo | Pai obrigatório | Campos próprios obrigatórios |
| --- | --- | --- |
| ULS | Nenhum | `name` |
| UNIT | ULS | `name` |
| BUILDING | UNIT | `name` |
| FLOOR | BUILDING | `name` |
| SERVICE | FLOOR | `name`, `code` |
| WING | SERVICE | `name` |
| WARD | WING | `name`, `code` |
| ROOM | WARD | `code` |
| BED | ROOM | `code` |

O pai é enviado como `parentId`. A hierarquia atual é
`ULS → UNIT → BUILDING → FLOOR → SERVICE → WING → WARD → ROOM → BED`.
O serviço da enfermaria é derivado da ala; `serviceId` não é necessário no
pedido de criação. Embora ainda exista no DTO, não é persistido como uma
associação independente da enfermaria; nas respostas de hierarquia é `null`.
O código do serviço é único por piso; o código da enfermaria é globalmente único.

Criar ULS, unidade ou serviço também cria os respetivos grupos Keycloak e
exige `KEYCLOAK_ADMIN_USERNAME` e `KEYCLOAK_ADMIN_PASSWORD` no processo do
backend. A hierarquia organizacional dos grupos é ULS → UNIT → SERVICE,
independentemente dos níveis físicos intermédios. Ver [SECURITY.md](SECURITY.md).

Pai, código e associação ao serviço são imutáveis nesta versão. Para reorganizar
a estrutura, criar novos elementos, preservando o histórico dos anteriores.
DELETE usa as restrições relacionais e nunca elimina uma árvore em cascata.
Camas novas começam em `AVAILABLE`.

Exemplo de criação de enfermaria:

```json
{
  "name": "Medicina Interna — Norte",
  "code": "Ward 30005",
  "parentId": "UUID_DA_ALA"
}
```

## Doentes

| Método | Caminho | Comportamento |
| --- | --- | --- |
| GET | `/patients?q=…` | Pesquisa literal por nome/SNS, paginação e filtros organizacionais |
| GET | `/patients/{id}` | Dados demográficos e `version` |
| POST | `/patients` | Regista doente, devolve `201`; SNS repetido devolve `409` |
| PUT | `/patients/{id}` | Substitui dados demográficos, exigindo a versão atual |

POST exige `snsNumber`, `fullName`; aceita `hospitalNumber`, `birthDate`, `gender`.
PUT exige `version`, `fullName` e aceita os mesmos campos opcionais, exceto SNS,
que é imutável. Num PUT, `null` limpa um campo opcional; género omitido passa a
`unknown`. Nascimento futuro é rejeitado. A resposta inclui o novo `version`.

FHIR reutiliza o doente pelo SNS sem sobrescrever dados demográficos. Assim,
reenvios antigos não desfazem correções explícitas. A consulta por âmbito inclui
doentes com episódios nesse âmbito e, quando não se filtra uma enfermaria,
doentes com pedidos de admissão nesse serviço/unidade/ULS.

## Camas e mapa

| Método | Caminho | Comportamento |
| --- | --- | --- |
| GET | `/beds?status=AVAILABLE` | Lista paginada, com filtros organizacionais e por estado |
| GET | `/beds/{id}` | Estado, versão, localização, ocupante e episódio atual |
| GET | `/bed-map` | `beds` paginadas e `counts` por estado |
| PUT | `/beds/{id}/status` | Alteração operacional de estado |

O mapa inclui ULS, unidade, serviço, enfermaria, quarto, doente e episódio,
além de `expectedDischargeAt` e `clinicalDischargeAt` do internamento atual.
As contagens abrangem o âmbito completo, independentemente da página e do
filtro `status` aplicado à lista de camas.

```json
{"status":"BLOCKED","reason":"Manutenção","version":0}
```

Estados: `AVAILABLE`, `OCCUPIED`, `BLOCKED`, `CLEANING`.

- Admissão é a única operação que passa de `AVAILABLE` para `OCCUPIED`.
- Alta administrativa fecha a alocação e passa de `OCCUPIED` para `CLEANING`.
- O endpoint de estado permite mudanças entre `AVAILABLE`, `BLOCKED` e `CLEANING`.
- Bloquear exige `reason` não vazio. Passar para `AVAILABLE` limpa o motivo.
- Não se pode alterar manualmente uma cama ocupada nem atribuir `OCCUPIED`.
- Uma cama em limpeza/bloqueada não pode receber uma admissão.
- A versão impede que uma alteração baseada numa consulta antiga substitua uma mais recente.

## Episódios, altas e histórico

| Método | Caminho | Comportamento |
| --- | --- | --- |
| GET | `/encounters?status=IN_PROGRESS&patientId=…` | Coleção paginada, com filtros organizacionais |
| GET | `/encounters/{id}` | Episódio, doente, serviço, localização e datas de alta |
| PUT | `/encounters/{id}/discharge-plan` | Define/limpa `expectedDischargeAt`; exige `version` |
| POST | `/encounters/{id}/clinical-discharge` | Regista alta clínica; exige `version`, aceita `at` |
| POST | `/encounters/{id}/administrative-discharge` | Termina episódio e inicia limpeza; exige `version`, aceita `at` |
| GET | `/allocations` | Histórico paginado, com filtros organizacionais, `bedId`, `encounterId`, `patientId`, `active` |

```json
{"version":0,"expectedDischargeAt":"2027-01-15T12:00:00Z"}
```

Num episódio ativo, omitir/usar `null` em `expectedDischargeAt` limpa a previsão.
As datas previstas/clínicas não podem anteceder a admissão. Alta clínica mantém
a cama ocupada e a alocação aberta. Alta administrativa não pode anteceder a
alta clínica. `at` omitido usa o instante de processamento.

Em DTOs, `administrativeDischargeAt` corresponde a `Encounter.endPeriod`.
FHIR `finished` regista essa alta administrativa; não inventa uma data clínica.
Um episódio terminado não aceita novas alterações ao planeamento.

Reenvios equivalentes de altas clínicas/administrativas são aceites sem novos
efeitos, mesmo com a versão anterior da operação já concluída. Uma data
explícita diferente da registada devolve `409`. Nas alterações ainda por aplicar,
a versão tem de coincidir com a atual.

## Admissões pendentes e espera por internamento

| Método | Caminho | Comportamento |
| --- | --- | --- |
| GET | `/admission-requests?status=WAITING&origin=EMERGENCY` | Fila paginada, com os filtros organizacionais indicados acima |
| GET | `/admission-requests/{id}` | Consulta individual |
| POST | `/admission-requests` | Cria pedido, devolve `201` |
| PUT | `/admission-requests/{id}` | Atualiza prioridade e data pretendida; exige `version` |
| POST | `/admission-requests/{id}/cancel` | Cancela pedido em espera, corpo `{"version":0}` |
| POST | `/admission-requests/{id}/admit` | Admite numa cama do serviço solicitado |

Criação:

```json
{
  "requestNumber":"REQ-2026-001",
  "patientId":"UUID_DO_DOENTE",
  "serviceId":"UUID_DO_SERVICO",
  "origin":"EMERGENCY",
  "priority":1,
  "desiredAdmissionAt":null
}
```

Origens: `EMERGENCY`, `SCHEDULED`, `SURGICAL`, `TRANSFER`, `OTHER`.
Prioridade de 1 (mais urgente) a 5; ordenação por prioridade, data do pedido e UUID.
`requestedAt` é opcional, usa agora por omissão e não pode estar no futuro.
A data pretendida não pode anteceder o pedido. O número do pedido é único;
só pode existir um pedido `WAITING` por doente. Estados: `WAITING`, `ADMITTED`, `CANCELLED`.

Admissão do pedido:

```json
{"version":0,"bedId":"UUID_DA_CAMA","visitNumber":"VISITA-001"}
```

`admittedAt` é opcional e não pode anteceder o pedido. O número de visita tem
de ser novo. A cama deve estar livre e pertencer ao serviço solicitado.
Criação do episódio, ocupação da cama e fecho do pedido decorrem na mesma
transação. Uma falha mantém o pedido em espera, sem episódio/alocação parcial.
O pedido admitido passa a referenciar o episódio e mantém-se no histórico.
`TRANSFER` identifica a origem; não executa uma transferência de cama automática.

Reenvios equivalentes de `/admit` devolvem o pedido já admitido sem novos efeitos.
Uma visita, cama ou data explícita diferente devolve `409`. Repetir um cancelamento
já concluído é aceite. Um pedido admitido não pode ser cancelado, nem um pedido
cancelado admitido.

## Concorrência e mensagens fora de ordem

O número de visita identifica o episódio, mesmo que os UUID dos recursos FHIR
se alterem. Bloqueios consultivos PostgreSQL duram até ao fim da transação e
abrangem chaves ainda sem linha persistida. A ordem é visita → SNS → pedido
(quando aplicável) → cama. Os estados operacionais da cama usam o mesmo bloqueio
de linha das admissões/altas. Índices exclusivos reforçam as invariantes no banco.

Admissões equivalentes reenviadas depois da alta devolvem `204` sem reabrir o
episódio. Reenviar a alta de um episódio antigo nunca liberta a cama de outro.
Uma alta anterior à primeira admissão devolve `404` sem criar dados; o emissor
pode reenviá-la após entregar a admissão. Não há armazenamento/reordenação
automática de mensagens FHIR nesta versão. Alterações contraditórias são
rejeitadas em vez de serem aplicadas como transferências implícitas.
