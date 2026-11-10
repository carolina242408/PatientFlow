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

Local sem Docker, a partir da pasta `algorithms` (Python 3.10+; a imagem usa 3.12):

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

No PowerShell:

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt
./.venv/Scripts/python.exe -m uvicorn main:app --reload
```

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
