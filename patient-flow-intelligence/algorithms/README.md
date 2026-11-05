# algorithms

Serviço Python (FastAPI) para os algoritmos do PatientFlow. No Compose de
desenvolvimento, está disponível em `http://localhost:8000`. No
`compose.mvp.yml`, só está acessível na rede Docker em `http://algorithms:8000`.

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

Testes das regras, sem instalar FastAPI:

```bash
python -m unittest discover -s tests -p test_decision_rules.py -v
```

Com a API em execução, testar também HTTP e validação dos pedidos:

```bash
ALGORITHMS_TEST_URL=http://localhost:8000 python -m unittest discover -s tests -v
```

No PowerShell, definir primeiro `$env:ALGORITHMS_TEST_URL='http://localhost:8000'`
e executar `python -m unittest discover -s tests -v`. Usar o Python do ambiente
virtual quando não estiver ativado. Existem cinco testes de regras e dois testes
HTTP; estes últimos são ignorados se `ALGORITHMS_TEST_URL` não estiver definida.

Os fixtures em `tests/fixtures/rules-v1.json` são partilhados com os testes
Java através dos recursos de teste Maven. A suite Java tem atualmente os
bloqueios descritos no [README do backend](../backend/README.md#testes).
Modelos inteligentes treinados são trabalho futuro descrito no
[PLAN.md](../backend/PLAN.md).
