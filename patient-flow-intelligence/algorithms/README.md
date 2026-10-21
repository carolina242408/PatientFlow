# algorithms

Serviço Python (FastAPI) para os algoritmos do PatientFlow. Corre no `docker compose` em `http://localhost:8000`.

Local sem Docker:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```
