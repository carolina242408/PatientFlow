# algorithms

Serviço Python (FastAPI) para os algoritmos do PatientFlow. Corre no `docker compose` em `http://localhost:8000`.

Expõe regras operacionais determinísticas `rules-v1`, sem treino de modelos:

- `GET /health` — estado do serviço.
- `POST /v1/bed-ranking` — ordenação de camas candidatas, com pontuação e razões.
- `POST /v1/occupancy-forecast` — cenários de ocupação a 24/48 horas por serviço.

Os contratos e fórmulas estão em [ANALYTICS.md](../backend/ANALYTICS.md).
Este serviço não acede à base de dados, não autoriza utilizadores e não recebe
dados identificativos do doente. É consumido pelo backend, que filtra os dados
pelo âmbito Keycloak, valida os resultados e mantém uma alternativa local.

Local sem Docker:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Atualizar a imagem no ambiente de desenvolvimento:

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

Os fixtures em `tests/fixtures/rules-v1.json` são partilhados com os testes
Java através dos recursos de teste Maven. Modelos inteligentes treinados ficam
reservados ao passo 10 futuro de [PLAN.md](../backend/PLAN.md).
