# algorithms

Serviço Python (FastAPI) para os algoritmos do PatientFlow. No Compose de
desenvolvimento, está disponível em `http://localhost:8000` e na rede Docker em
`http://algorithms:8000`.

Expõe regras operacionais determinísticas `rules-v1`, sem treino de modelos:

- `GET /health` — estado do serviço.
- `POST /v1/bed-ranking` — ordenação de camas candidatas, com pontuação e razões.
- `POST /v1/occupancy-forecast` — cenários de ocupação a 24/48 horas por serviço.

Os contratos e fórmulas estão em [ANALYTICS.md](../backend/ANALYTICS.md).
Este serviço não acede à base de dados, não autoriza utilizadores e não recebe
dados identificativos do doente. É consumido pelo backend, que filtra os dados
pelo âmbito Keycloak, valida os resultados e mantém uma alternativa local.

Local sem Docker, a partir da pasta `algorithms` (Python 3.11+; a imagem usa 3.12).
Usar o ambiente Python existente do projeto, ativando-o antes destes comandos.
Para usar Kumo na GPU, instalar primeiro o PyTorch CUDA conforme a secção abaixo.

```bash
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

No PowerShell:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

## NVIDIA Kumo-Tabular: instalação e download

As dependências de inferência estão no `requirements.txt` deste serviço. Não é
necessário criar outro ambiente. No PowerShell, a partir de `algorithms`, usar
o Python do ambiente existente (3.11 ou superior) e um driver NVIDIA atualizado.

1. Instalar o PyTorch CUDA 12.6 antes das restantes dependências:

   ```powershell
   python -m pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cu126
   python -m pip install -r requirements.txt
   ```

   Se já estiver instalada uma versão CPU de `torch==2.14.1`, acrescentar
   `--force-reinstall` ao primeiro comando para a substituir pela versão CUDA.
   Para execução apenas em CPU, usar o índice
   `https://download.pytorch.org/whl/cpu` em vez de `cu126`.

2. Confirmar o dispositivo disponível:

   ```powershell
   python -c "import torch; print('PyTorch:', torch.__version__); print('CUDA available:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
   ```

   Para inferência na GPU, `CUDA available` deve apresentar `True`.

3. Descarregar e carregar o modelo Small de regressão:

   ```powershell
   python -c "import sdm; model = sdm.models.KumoTabular(task='regression', size='small', device='cpu'); print('Kumo-Tabular downloaded and loaded.')"
   ```

   A biblioteca descarrega automaticamente os pesos do Hugging Face na primeira
   utilização e reutiliza a cache nas seguintes. Este comando usa RAM para
   confirmar o download; para carregar posteriormente na GPU, usar `device='cuda'`.
   O checkpoint Small de regressão ocupa aproximadamente 114 MB; as dependências
   e a memória de inferência exigem espaço adicional. Para outra variante, usar
   `size='medium'` ou `size='large'`.

Estes passos instalam a biblioteca e descarregam os pesos; não executam previsões
sobre o CSV nem integram Kumo nos endpoints. Os pesos não são descarregados ao
iniciar a API. Como o Docker instala o mesmo `requirements.txt`, a imagem do
serviço também passa a incluir estas dependências; os comandos acima configuram
o ambiente local, não o acesso à GPU no Docker.

Referências: [instalação NVIDIA](https://nvidia.github.io/structured-data-models/install.html),
[API KumoTabular](https://nvidia.github.io/structured-data-models/api/generated/sdm.models.KumoTabular)
e [versões PyTorch](https://pytorch.org/get-started/previous-versions/).

## Avaliar apenas o Kumo-Tabular

Na pasta `algorithms`, com as dependências instaladas em `.venv`:

```powershell
./.venv/Scripts/python.exe -u -m model.evaluate_kumo
```

O comando usa `datasetgenerator/ml_hospital_consumption_27k.csv`, Kumo Small,
CUDA e um estimador. Usa os oito preditores do CSV; `los_days` é exclusivamente
o alvo. Reserva 20% dos registos para avaliação final e executa cinco folds nos
restantes 80%, com seed 8228. Cada fold usa todo o seu conjunto de treino como
contexto, sem atualizar os pesos do modelo. A mediana prevista (`q500`) é avaliada
em dias, sem arredondamento nem clipping. A preparação interna da biblioteca é
ajustada apenas ao contexto de treino.

Os resultados incluem MAE, RMSE, R², desvio-padrão entre folds, erro por diagnóstico
e erro nos internamentos longos (percentil 90 do treino). Não incluem outros
modelos nem referências por mediana. O CSV não contém identificadores de doente
nem datas de admissão, pelo que a divisão é por linha, não por doente ou por data.

Cada execução cria uma pasta nova em `model/artifacts/kumo_<timestamp>/`, com
`summary.md` (tabela), `summary.csv`, `report.json`, `protocol.json`,
`cv_predictions.csv` e `test_predictions.csv`. Um relatório com `status=failed`
representa uma execução incompleta. Os resultados anteriores não são substituídos.

Opções: `--size medium`, `--estimators 8`, `--batch-size 128`, `--device cpu`,
`--data caminho.csv` e `--output-dir pasta_nova`. Se a memória for insuficiente,
`--context-rows 2000` limita explicitamente os exemplos de contexto a uma amostra
reprodutível de cada treino, mantendo todas as linhas de validação; este limite
fica registado no relatório e altera a experiência. Não existe fallback silencioso
para CPU nem redução automática do contexto.

## Docker e desenvolvimento

Atualizar a imagem a partir da pasta `patient-flow-intelligence`:

```bash
docker compose up -d --build algorithms
```

Os testes automatizados e os respetivos fixtures foram removidos nesta fase.
Com o serviço em execução, consultar `GET /health` para verificar o estado e
`/docs` para experimentar os endpoints através da documentação interativa.

O treino offline de modelos de previsão de duração do internamento está em
[model/README.md](model/README.md): CatBoost, XGBoost, Random Forest e
FT-Transformer, com Optuna e validação cruzada. Estes comandos não são executados
ao iniciar a API; a integração das previsões nos endpoints continua a ser trabalho
futuro descrito no [PLAN.md](../backend/PLAN.md).
