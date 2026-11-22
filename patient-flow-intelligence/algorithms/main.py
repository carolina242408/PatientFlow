from contextlib import asynccontextmanager
from datetime import timedelta
import logging
import os
import sys
from typing import Literal
from uuid import UUID
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import JSONResponse
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from decision_rules import rank_beds, forecast_occupancy
from discharge_model import DischargeModel
import prediction_queue

# Configuração essencial para forçar o Python a mostrar os logs INFO na consola do Docker
logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("algorithms")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.discharge_model = DischargeModel()
    logger.info(f"Modelo de alta carregado com sucesso. Versão: {app.state.discharge_model.version}")
    if rabbitmq_url := os.environ.get("RABBITMQ_URL"):
        model = app.state.discharge_model
        prediction_queue.start(rabbitmq_url, lambda message: discharge_prediction_message(message, model))
    try:
        yield
    finally:
        app.state.discharge_model.close()


app = FastAPI(title="PatientFlow Algorithms", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError):
    if request.url.path != "/v1/discharge-prediction":
        return await request_validation_exception_handler(request, error)
    # Pydantic's default error response echoes submitted values, potentially PHI.
    return JSONResponse(status_code=422, content={"detail": "Invalid request parameters"})


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Candidate(Contract):
    bedId: UUID
    wardCode: str = Field(min_length=1, max_length=255)
    roomCode: str = Field(min_length=1, max_length=255)
    bedCode: str = Field(min_length=1, max_length=255)
    occupiedInRoom: int = Field(ge=0, le=1_000_000)
    preferredWard: bool


class RankInput(Contract):
    limit: int = Field(ge=1, le=20)
    candidates: list[Candidate] = Field(max_length=5000)

    @model_validator(mode="after")
    def unique_beds(self):
        if len({c.bedId for c in self.candidates}) != len(self.candidates):
            raise ValueError("Duplicate bed identifiers")
        return self


class ForecastInput(Contract):
    serviceId: UUID
    capacity: int = Field(ge=0, le=1_000_000_000)
    occupied: int = Field(ge=0, le=1_000_000_000)
    historicalUnscheduledAdmissions: int = Field(ge=0, le=1_000_000_000)
    historicalDischarges: int = Field(ge=0, le=1_000_000_000)
    knownAdmissions24h: int = Field(ge=0, le=1_000_000_000)
    knownAdmissions48h: int = Field(ge=0, le=1_000_000_000)
    plannedDischarges24h: int = Field(ge=0, le=1_000_000_000)
    plannedDischarges48h: int = Field(ge=0, le=1_000_000_000)

    @model_validator(mode="after")
    def consistent_counts(self):
        if self.occupied > self.capacity:
            raise ValueError("Occupied beds exceed capacity")
        if self.knownAdmissions48h < self.knownAdmissions24h or self.plannedDischarges48h < self.plannedDischarges24h:
            raise ValueError("Cumulative 48h counts must cover 24h counts")
        return self


class ForecastBatch(Contract):
    historyDays: int = Field(ge=1, le=90)
    services: list[ForecastInput] = Field(max_length=100)

    @model_validator(mode="after")
    def unique_services(self):
        if len({s.serviceId for s in self.services}) != len(self.services):
            raise ValueError("Duplicate service identifiers")
        return self


@app.post("/v1/bed-ranking")
def bed_ranking(data: RankInput):
    return rank_beds(data.model_dump(mode="json"))


@app.post("/v1/occupancy-forecast")
def occupancy_forecast(data: ForecastBatch):
    return forecast_occupancy(data.model_dump(mode="json"))


class DischargeInput(Contract):
    gender: Literal["F", "M"]
    age: int = Field(ge=0, le=130, strict=True)
    diagnosisCode: str = Field(min_length=1, max_length=64, pattern=r"^\S+$")
    admittedAt: AwareDatetime
    month: int = Field(ge=1, le=12, strict=True)
    admission_weekday: Literal["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    time_period: Literal["Morning", "Afternoon", "Evening", "Night"]
    season: Literal["Winter", "Spring", "Summer", "Autumn"]
    specialty: Literal["CIR", "MED", "UCI"]

    @model_validator(mode="after")
    def consistent_admission_features(self):
        at = self.admittedAt
        weekdays = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
        period = "Night" if at.hour < 6 else "Morning" if at.hour < 12 else "Afternoon" if at.hour < 18 else "Evening"
        month_day = at.month * 100 + at.day
        season = ("Winter" if month_day < 320 or month_day >= 1221 else
                  "Spring" if month_day < 621 else "Summer" if month_day < 923 else "Autumn")
        if (self.month != at.month or self.admission_weekday != weekdays[at.weekday()]
                or self.time_period != period or self.season != season):
            raise ValueError("Calendar features do not match admission timestamp")
        return self


def predict_discharge(data: DischargeInput, model: DischargeModel) -> dict:
    logger.info(f"A receber pedido de predição | Diagnóstico: {data.diagnosisCode} | Especialidade: {data.specialty}")
    features = data.model_dump(exclude={"admittedAt", "diagnosisCode"})
    features["diagnosis_code"] = data.diagnosisCode
    days = model.predict_days(features)
    
    expected = data.admittedAt + timedelta(days=days)
    logger.info(
        f"Predição concluída com sucesso | Dias previstos: {days} | "
        f"Data de Alta Prevista: {expected} | Model Version: {model.version}"
    )
    return {"expectedDischargeAt": expected, "modelVersion": model.version}


def discharge_prediction_message(message: dict, model: DischargeModel) -> dict | None:
    """Pedido vindo do RabbitMQ: {"encounterId", "input": DischargeInput}. None descarta um pedido inválido."""
    try:
        encounter_id = str(UUID(message["encounterId"]))
        data = DischargeInput.model_validate(message["input"])
        result = predict_discharge(data, model)
    except BlockingIOError:
        raise
    except (KeyError, TypeError, ValueError):
        logger.warning("Pedido de previsão inválido descartado")
        return None
    return {
        "encounterId": encounter_id,
        "admittedAt": data.admittedAt.isoformat(),
        "expectedDischargeAt": result["expectedDischargeAt"].isoformat(),
        "modelVersion": result["modelVersion"],
    }


@app.post("/v1/discharge-prediction")
def discharge_prediction(data: DischargeInput, request: Request):
    try:
        return predict_discharge(data, request.app.state.discharge_model)
    except ValueError:
        logger.warning("Falha de validação nos dados de entrada da predição")
        raise HTTPException(status_code=422, detail="Unsupported prediction features") from None
    except BlockingIOError:
        logger.error("Discharge predictor is busy")
        raise HTTPException(status_code=503, detail="Discharge predictor is busy") from None
    except Exception as e:
        logger.error("Discharge prediction failed with error: %s", e)
        raise HTTPException(status_code=503, detail="Discharge prediction unavailable") from None


@app.get("/health")
def health(request: Request):
    model = request.app.state.discharge_model
    return {"status": "ok", "modelVersion": model.version, "contextRows": model.context_rows}