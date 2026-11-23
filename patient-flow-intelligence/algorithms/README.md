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
linhas). Por defeito usa uma amostra reprodutível de 4.096 linhas, seed 8228,
para limitar a memória. `KUMO_CONTEXT_ROWS=0` usa todas as linhas; um inteiro
maior ou igual a 2 escolhe outro limite. Não existe redução automática do
contexto nem fallback silencioso entre CUDA e CPU. A configuração de contexto
e o hash do CSV fazem parte de `modelVersion`.

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

# Serving: ficheiros locais, sem downloads. CUDA é opcional; o default é CPU.
$env:KUMO_DEVICE = 'cuda'
$env:KUMO_CONTEXT_ROWS = '4096'
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

Quando o Docker estiver configurado, a partir de `patient-flow-intelligence`:

```powershell
# CPU
docker compose up -d --build algorithms backend

# CUDA 12.6, com driver NVIDIA e suporte GPU do Docker
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build algorithms backend
```

Ambas as imagens usam as versões existentes de dependências. A variante CPU
instala a wheel CPU do PyTorch; a variante GPU usa a wheel CUDA 12.6.
Usar apenas um worker para não duplicar a cache. O consumo de memória e a
latência dependem do contexto e do dispositivo; não foram medidos nesta integração.

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
