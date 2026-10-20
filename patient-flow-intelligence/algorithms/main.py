from fastapi import FastAPI

app = FastAPI(title="PatientFlow Algorithms")


@app.get("/health")
def health():
    return {"status": "ok"}
