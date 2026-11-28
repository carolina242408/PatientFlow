# algorithms

Serviço FastAPI local, consumido pelo backend do PatientFlow:

- `GET /health`: disponível após carregar o modelo e preparar o contexto.
- `POST /v1/bed-ranking`: regras determinísticas `rules-v1`.
- `POST /v1/occupancy-forecast`: regras determinísticas `rules-v1`.
- `POST /v1/discharge-prediction`: NVIDIA Kumo-Tabular Small, regressão local.

## Previsão de alta

O modelo usa os pesos pré-treinados Small, um estimador e a mediana `q500` de
`los_days`. `fit()` prepara uma única vez o contexto e a cache em memória;
não atualiza os pesos nem executa otimização. A previsão soma os dias, sem
arredondamento, à data de admissão. Resultados negativos ou não finitos são
rejeitados; não existe fallback para a antiga previsão fixa de três dias.

O contexto vem de `datasetgenerator/ml_hospital_consumption_87k.csv` (87.468
linhas). Por defeito não há limite de linhas em GPU; em CPU o limite é
100.000 (hoje abrange todo o CSV). `KUMO_CONTEXT_ROWS` substitui o defeito em
ambos: um inteiro maior ou igual a 2 define o limite, `0` remove-o.

**Dispositivo.** `KUMO_DEVICE=auto` (defeito) usa a GPU NVIDIA quando o CUDA
está disponível e, caso contrário, a CPU, com um aviso no log. `cuda` exige
GPU e falha no arranque sem ela; `cpu` força a CPU. Em GPU a inferência usa
float16; em CPU, float32.

**Redução automática do contexto.** O modelo não tem limite fixo de linhas; o
limite prático é a memória. Cada tentativa de arranque prepara o contexto e faz
uma previsão de aquecimento; se esgotar a memória, tenta de novo com 75% das
linhas, numa amostra reprodutível (seed 8228), e regista um aviso.

- GPU: começa com todas as linhas pedidas e depende desta repetição, porque
  uma falha de alocação CUDA é recuperável. Numa RTX 2060 de 6 GB, as 87.468
  linhas couberam.
  - No arranque, o PyTorch fica limitado a 90% da VRAM livre. Sem este limite,
    os drivers NVIDIA para Windows podem usar a RAM do sistema quando a VRAM
    esgota, em vez de dar erro. O arranque fica extremamente lento e a
    repetição nunca acontece: um teste com 174.936 linhas ficou mais de
    10 minutos parado.
  - Com o limite, o PyTorch gera o erro de memória e a repetição funciona em
    qualquer driver.
- CPU: esgotar a RAM pode terminar o processo em vez de gerar um erro, por
  isso o tamanho é calculado antes. O serviço mede a RAM livre (`/proc/meminfo`
  e o limite de cgroup do container, ou `GlobalMemoryStatusEx` no Windows) e
  aplica o estimador por linha da biblioteca `sdm`, planeando apenas metade.
  O CSV completo precisa de ~17 GB livres.

`KUMO_MEMORY_BUDGET_MB` substitui a medição em ambos os dispositivos, por
exemplo para reservar memória para outros processos.

`GET /health` indica `device` e `contextRows` efetivos. O número de linhas
usado e o hash do CSV fazem parte de `modelVersion`; o dispositivo não.

**Tempo de arranque.** Em CPU cresce mais do que linearmente com as linhas.
Medido num desktop: 4.000 linhas 8 s, 8.000 12 s, 12.000 19 s, 16.000 47 s,
26.734 80 s. Em GPU (RTX 2060), as 87.468 linhas arrancam em ~16 s. O
healthcheck do Compose tem `start_period: 28m` e o backend só arranca depois
de o algorithms ficar saudável.

> **Risco em CPU.** Numa máquina sem GPU e com ~17 GB de RAM livre, o serviço
> usa o CSV completo. Por extrapolação, o arranque demora ~17–27 minutos num
> desktop, perto do limite de 28 minutos; uma CPU mais lenta pode
> ultrapassá-lo. Nesse caso o container fica `unhealthy` e o backend não
> arranca. Máquinas com menos RAM usam menos linhas e arrancam mais depressa,
> pelo que não são afetadas.

Se o algorithms não ficar saudável a tempo em CPU:

1. Confirmar a causa com `docker compose logs algorithms` e
   `docker compose ps algorithms`. A mensagem `Discharge context reduced`
   indica quantas linhas foram usadas.
2. Limitar as linhas no `.env` de `patient-flow-intelligence`, por exemplo
   `KUMO_CONTEXT_ROWS=30000` (~1–2 minutos no desktop medido), e reiniciar
   com `docker compose up -d algorithms backend`.
3. Em alternativa, para manter todas as linhas, aumentar `start_period` no
   healthcheck do algorithms em `docker-compose.yml`.

Contrato de entrada (valores ilustrativos, sem dados reais):

```json
{
  "gender": "F",
  "age": 70,
  "diagnosisCode": "K80.20",
  "admittedAt": "2026-11-17T10:00:00+00:00",
  "month": 11,
  "admission_weekday": "Tuesday",
  "time_period": "Morning",
  "season": "Autumn",
  "specialty": "CIR"
}
```

O nome é `specialty`, como no CSV. `birthDate` deixou de fazer parte da API
de algoritmos; a data de nascimento continua na base de dados clínica.
O backend deriva as features segundo `datasetgenerator/data_analysis .ipynb`:

- Idade: dias entre nascimento e admissão divididos por 365,25, truncados.
- Género FHIR: `female` → `F`, `male` → `M`.
- Mês e dia da semana: calendário da admissão, nomes ingleses.
- Período: Night 00–05h, Morning 06–11h, Afternoon 12–17h, Evening 18–23h.
- Estações: Winter começa em 21/12, Spring em 20/03, Summer em 21/06,
  Autumn em 23/09, tal como no notebook.
- Serviço: `30004` → `MED`, `30006` → `CIR`, `30020` → `UCI`, conforme
  `tools/data-generation/config/hospital.yaml`. Outros serviços não são
  convertidos por aproximação.

O offset explícito da admissão é preservado para calcular o calendário.
Datas FHIR sem offset mantêm a convenção UTC existente no transformador.
O diagnóstico ICD-10 é associado ao encontro, com preferência por `rank=1`;
sem prioridade explícita exige-se um único código associado. Dados incompletos
ou ambíguos não geram previsão. O resultado só é gravado se o encontro continuar
ativo, com a mesma admissão e sem um plano de alta já definido.

O pedido e a resposta da previsão de alta passam pelo RabbitMQ, não por HTTP.
Na admissão, o backend publica `{"encounterId", "input"}` na fila
`discharge.prediction.requests`; este serviço consome-a (`prediction_queue.py`,
ativo quando `RABBITMQ_URL` está definido) e publica
`{"encounterId", "admittedAt", "expectedDischargeAt", "modelVersion"}` em
`discharge.prediction.results`, que o backend consome e grava. As filas são
duráveis e as mensagens persistentes: com o modelo em baixo o pedido espera na
fila, e com o backend em baixo espera o resultado. Um pedido só é confirmado
depois de o resultado estar publicado. Pedidos inválidos são descartados; com o
modelo ocupado o pedido volta à fila; outra falha é repetida uma vez.

O endpoint HTTP `POST /v1/discharge-prediction` mantém-se para testes manuais:
devolve 503 se o modelo estiver ocupado ou falhar e 422 se os parâmetros forem
inválidos. O backend já não o usa.

## Execução local

Python 3.11+; usar o ambiente existente. As dependências já estão fixadas em
`requirements.txt`. A partir de `algorithms`, no PowerShell:

```powershell
# Preparação: acesso à Internet apenas para artefactos públicos, sem ler o CSV.
.\.venv\Scripts\python.exe kumo_assets.py

# Serving: ficheiros locais, sem downloads. Por defeito: GPU se existir, senão
# CPU, com todas as linhas que couberem em memória. Opcionalmente:
# $env:KUMO_DEVICE = 'cpu'; $env:KUMO_CONTEXT_ROWS = '4096'
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log
```

`kumo_assets.py` guarda pesos, licença e configuração em `models/kumo-small/`,
excluído do Git. Usa a revisão fixa `3c3e10bbdb590ace29e7026847f92db3c603096d`
(v1.0.1) e verifica SHA-256 do checkpoint. Para preparar outra máquina sem
Internet, transferir esta pasta, as dependências e o CSV por um canal autorizado.
`KUMO_MODEL_DIR` e `KUMO_DATASET` permitem indicar caminhos locais alternativos.

## Privacidade e Docker

O processo de inferência força `HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE`,
`HF_HUB_DISABLE_TELEMETRY`, `HF_HUB_DISABLE_IMPLICIT_TOKEN`, `DO_NOT_TRACK` e
desativa W&B. Carrega diretamente o checkpoint local com `weights_only=True`,
sem chamar o resolvedor de downloads da biblioteca. Não há chamadas a APIs
externas no percurso de previsão. Pesos/contexto ausentes ou inválidos impedem
o arranque. As respostas de validação não devolvem os valores recebidos e os
erros de inferência não registam o payload.

O Dockerfile descarrega apenas artefactos públicos durante a construção.
O CSV e os notebooks ficam fora do contexto de build; o CSV é montado read-only
no arranque, nunca incluído na imagem. O container corre sem root, sem
capabilities, com filesystem read-only e uma pasta temporária em memória.

O Compose liga algorithms apenas à rede `internal: true` partilhada com o
backend, sem porta publicada. Esta rede bloqueia conectividade externa;
o backend continua com acesso às restantes dependências na rede normal.
O backend espera pelo healthcheck do modelo antes de arrancar.
Ao executar Python diretamente, aplicar também uma política de firewall de
saída no host para obter isolamento de rede equivalente: as variáveis offline
configuram bibliotecas, não substituem um firewall.

### CPU ou GPU em Docker

Usar a GPU dentro de um container exige duas coisas:

1. **PyTorch CUDA na imagem.** A imagem por defeito instala a wheel CPU do
   PyTorch, mais pequena; com ela, `auto` resolve sempre para CPU.
   `docker-compose.gpu.yml` muda o argumento de build `TORCH_INDEX_URL` para a
   wheel CUDA 12.6. Não é possível instalar as duas: são o mesmo pacote
   `torch`. A wheel CUDA também funciona em CPU, mas ocupa ~4 GB instalada.
2. **Acesso do container à GPU.** Um container não vê o hardware do host
   mesmo com PyTorch CUDA. `docker-compose.gpu.yml` pede a GPU NVIDIA ao
   Docker e define `KUMO_DEVICE=cuda`. Este pedido não pode estar no
   `docker-compose.yml` normal: em máquinas sem GPU NVIDIA e sem NVIDIA
   Container Toolkit o Docker recusa arrancar o container
   (`could not select device driver "nvidia"`).

Requisitos da máquina com GPU: driver NVIDIA e suporte GPU no Docker (Docker
Desktop com WSL 2 no Windows; NVIDIA Container Toolkit no Linux).

**Máquina sem GPU**, a partir de `patient-flow-intelligence`:

```powershell
docker compose up -d --build algorithms backend
```

**Máquina com GPU, uma vez por máquina:** acrescentar ao `.env` de
`patient-flow-intelligence` (não vai para o Git) a linha seguinte. O separador
é `;` no Windows e `:` em Linux/macOS.

```dotenv
# Windows
COMPOSE_FILE=docker-compose.yml;docker-compose.gpu.yml
# Linux/macOS
# COMPOSE_FILE=docker-compose.yml:docker-compose.gpu.yml
```

A partir daí, os comandos `docker compose` normais incluem o override, sem
`-f`, e o build instala o PyTorch CUDA:

```powershell
docker compose up -d --build algorithms backend
```

Equivale a
`docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build algorithms backend`.
Para confirmar, `docker compose config algorithms` deve mostrar
`TORCH_INDEX_URL: https://download.pytorch.org/whl/cu126` e
`KUMO_DEVICE: cuda`; com o serviço a correr, `GET /health` devolve
`"device": "cuda"` (por exemplo,
`docker compose exec algorithms python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/health').read().decode())"`).

Ao mudar entre CPU e GPU usar sempre `--build`. As duas variantes geram uma
imagem com o mesmo nome, e sem `--build` o Docker reutiliza a imagem anterior,
com o PyTorch errado.

Usar apenas um worker para não duplicar a cache. O consumo de memória e a
latência dependem do contexto e do dispositivo. Medido fora de Docker:
~0,1 s por previsão em GPU com 87.468 linhas e ~0,14 s em CPU com 26.734.
Os tempos de arranque estão em [Tempo de arranque](#previsão-de-alta).

## Trocar o dataset de contexto

É possível usar outro CSV, maior ou menor, desde que tenha as mesmas colunas.
O modelo não é treinado: o CSV é lido no arranque e usado como contexto, por
isso basta apontar o serviço para o novo ficheiro e reiniciá-lo. Não é preciso
reconstruir a imagem, porque o CSV não faz parte dela. Por agora a troca é
manual.

### 1. Preparar o CSV

O arranque falha se alguma destas regras não for cumprida:

- Codificação UTF-8 (com ou sem BOM), separador vírgula, com cabeçalho.
- Exatamente estas 9 colunas, por qualquer ordem e sem colunas extra:
  `gender`, `specialty`, `diagnosis_code`, `age`, `month`,
  `admission_weekday`, `time_period`, `season`, `los_days`.
- Pelo menos 2 linhas, sem valores em falta ou vazios.
- `age`: inteiro de 0 a 130. `month`: inteiro de 1 a 12.
- `los_days`: número finito e não negativo (dias de internamento).

Os valores categóricos não são validados no arranque, mas têm de usar
exatamente o vocabulário da API. Caso contrário, os pedidos não correspondem
ao contexto e as previsões degradam-se sem qualquer erro:

| Coluna | Valores |
|---|---|
| `gender` | `F`, `M` |
| `specialty` | `CIR`, `MED`, `UCI` |
| `admission_weekday` | `Monday` … `Sunday` (inglês) |
| `time_period` | `Night`, `Morning`, `Afternoon`, `Evening` |
| `season` | `Winter`, `Spring`, `Summer`, `Autumn` |
| `diagnosis_code` | Código ICD-10, como o backend o envia (ex.: `K80.20`) |

`time_period`, `season` e os restantes campos de calendário devem ser
calculados com as mesmas regras do backend (ver [Previsão de alta](#previsão-de-alta)).
O modelo só conhece os diagnósticos que aparecem no CSV; o dataset atual tem
apenas 15 códigos distintos.

Um CSV com dados reais de doentes não deve ir para o Git. A pasta
`datasetgenerator/` já está excluída do build Docker, mas não do Git.

### 2a. Docker

1. Colocar o ficheiro numa pasta do host, por exemplo
   `algorithms/datasetgenerator/novo_dataset.csv`.
2. Em `docker-compose.yml`, no serviço `algorithms`, alterar o `source` do
   volume. O caminho é relativo a `patient-flow-intelligence` ou absoluto; no
   Windows usar `/`, por exemplo `C:/dados/novo_dataset.csv`. O `target` fica
   igual.

   ```yaml
   volumes:
     - type: bind
       source: ./algorithms/datasetgenerator/novo_dataset.csv
       target: /data/context.csv
   ```
3. Recriar o container, a partir de `patient-flow-intelligence`:

   ```powershell
   docker compose up -d --force-recreate algorithms
   ```

   Usar `--force-recreate` também quando o ficheiro é substituído no mesmo
   caminho: um bind mount de um único ficheiro pode continuar a apontar para
   a versão antiga.

### 2b. Execução local (sem Docker)

```powershell
$env:KUMO_DATASET = 'C:\dados\novo_dataset.csv'
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log
```

### 3. Confirmar

- `docker compose logs algorithms` mostra eventuais erros e quando nem todas
  as linhas couberam: `Discharge context reduced` em CPU, `ran out of memory;
  retrying` em GPU.
- `GET /health` devolve `contextRows` (linhas usadas) e um `modelVersion`
  novo: o hash do CSV (`data…`) muda com o ficheiro.

Erros de arranque e causa:

| Mensagem | Causa |
|---|---|
| `Invalid discharge context CSV schema or row count` | Colunas diferentes das 9 esperadas, ou menos de 2 linhas |
| `Discharge context CSV contains missing values` / `empty values` | Células em falta ou vazias |
| `Unable to parse string …` (pandas) | Texto não numérico em `age`, `month` ou `los_days` |
| `Discharge context CSV contains nonfinite values` | `inf` ou `NaN` em `age`, `month` ou `los_days` |
| `Invalid age …` / `Invalid month …` | Fora dos intervalos ou não inteiros |
| `Negative length of stay …` | `los_days` negativo |

Enquanto o algorithms reinicia, as previsões de alta falham (503 ou sem
ligação). As admissões continuam a ser gravadas, apenas sem previsão.

### Datasets maiores

- **GPU:** usa todas as linhas, sem limite. Se a memória não chegar, reduz
  automaticamente. Teste numa RTX 2060 de 6 GB, com o CSV atual duplicado
  (174.936 linhas): 174.936 → 131.202 → 98.401 linhas, pronto em 72 s.
- **CPU:** limite de 100.000 linhas por defeito; acima disso usa uma amostra
  reprodutível. Para usar mais, definir `KUMO_CONTEXT_ROWS` no `.env`
  (`0` = sem limite). A memória livre continua a limitar o número de linhas.
- O arranque em CPU cresce mais do que linearmente com as linhas. Um dataset
  maior agrava o risco de ultrapassar os 28 minutos do healthcheck (ver
  [Tempo de arranque](#previsão-de-alta)).

## Portabilidade e limitações conhecidas

> **Nota (26/11/2026).** Âmbito: computadores x86-64 comuns (Windows, Linux,
> Mac Intel), sem ARM. Avaliado apenas o serviço algorithms, não o resto do
> stack.

**Funciona em qualquer computador comum:**

- Sem GPU, ou com GPU AMD/Intel: usa a CPU automaticamente. O Compose
  normal instala o PyTorch CPU e nunca depende de GPU.
- Com pouca ou muita RAM: o contexto ajusta-se à memória livre. Em GPU, se a
  memória esgotar, tenta de novo com menos linhas.
- Sem cópias manuais: o CSV está no Git (3,8 MB) e os pesos do modelo são
  descarregados no build.
- Sem problemas de fim de linha ao clonar no Windows: o único script usado
  pelos containers (`backend/mvnw`) mantém o formato Unix.

**Limitações e pontos não verificados:**

1. **GPUs NVIDIA RTX série 50 (Blackwell) não funcionam em modo GPU.** A wheel
   PyTorch CUDA 12.6 suporta as arquiteturas `sm_50` a `sm_90`, sem `sm_120`
   (confirmado na wheel Windows; a wheel Linux do Docker não foi verificada).
   Com `docker-compose.gpu.yml`, o arranque falha em vez de recorrer à CPU;
   sem o override, o serviço corre normalmente em CPU. Possíveis correções,
   por implementar: usar uma build CUDA mais recente nessas máquinas, ou tratar
   uma GPU não suportada como ausente no modo `auto`.
2. **Não testado em Docker.** A imagem não foi construída com estas
   alterações; apenas os ficheiros Compose foram validados
   (`docker compose config`). O código Linux que lê a RAM livre
   (`/proc/meminfo`) e o limite de memória do container (cgroup) nunca foi
   executado: todos os testes correram nativamente no Windows.
3. **Requisitos de cada máquina:**
   - Docker instalado.
   - Internet durante o build, para os pacotes Python e os pesos do modelo.
   - Portas 8080, 5173, 9080, 8081 e 15672 livres.
   - RAM suficiente para todo o stack. No Windows, o Docker Desktop só dá aos
     containers parte da RAM (por defeito, metade), partilhada com Postgres,
     Keycloak, backend e restantes serviços. Num portátil de 8 GB o modelo
     arranca com poucas linhas: funciona, mas não foi medido se menos linhas
     pioram as previsões.
4. **Restantes serviços não avaliados.** Não foi verificado se correm em
   qualquer computador.

## Licença comercial

Verificado em 17/11/2026: os pesos usam [OpenMDW 1.1](https://huggingface.co/nvidia/Kumo-Tabular/blob/main/LICENSE),
que permite utilização comercial, modificação e distribuição. A redistribuição
deve preservar a licença e os avisos de copyright/origem aplicáveis. Os outputs
não recebem restrições adicionais desta licença. Existem cláusulas de
terminação por litígio e exclusão de garantias; direitos sobre dados e outros
materiais continuam a precisar de autorização própria.

A biblioteca NVIDIA usa [Apache 2.0](https://github.com/NVIDIA/structured-data-models/blob/main/LICENSE),
também compatível com uso comercial, sujeita às suas condições de redistribuição.
A licença dos pesos acompanha os artefactos locais e a imagem em
`/opt/kumo-small/LICENSE`; não é necessária uma API comercial Kumo.

## Avaliação offline existente

O script `model.evaluate_kumo` continua separado da API. Por defeito avalia o
CSV de 27k, com 20% de holdout e cinco folds, sem treinar os pesos:

```powershell
.\.venv\Scripts\python.exe -u -m model.evaluate_kumo --data datasetgenerator/ml_hospital_consumption_87k.csv --context-rows 4096
```

Este comando é uma avaliação explícita e usa o resolvedor Hub original; não
herda o isolamento do serviço. Preparar a cache e configurar `HF_HUB_OFFLINE=1`,
`HF_HUB_DISABLE_TELEMETRY=1` e isolamento de rede antes de usar dados sensíveis.
Os resultados ficam em `model/artifacts/kumo_<timestamp>/`. O CSV não tem IDs
de doente nem datas absolutas para avaliar separação por doente ou temporal.
Esta integração não executou benchmarks nem validou a qualidade clínica.

Outros modelos experimentais estão documentados em [model/README.md](model/README.md).
