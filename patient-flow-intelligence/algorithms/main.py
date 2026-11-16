from datetime import date, timedelta
from uuid import UUID
from fastapi import FastAPI
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from decision_rules import rank_beds, forecast_occupancy

app = FastAPI(title="PatientFlow Algorithms")


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
    gender: str | None = Field(default=None, max_length=32)
    birthDate: date | None = None
    diagnosisCode: str = Field(min_length=1, max_length=64)
    admittedAt: AwareDatetime


def predict_discharge(data: DischargeInput) -> dict:
    # stub, admissão + 3 dias. O modelo real entra aqui (mesma entrada/saída).
    return {"expectedDischargeAt": data.admittedAt + timedelta(days=3), "modelVersion": "stub-v0"}


@app.post("/v1/discharge-prediction")
def discharge_prediction(data: DischargeInput):
    return predict_discharge(data)


@app.get("/health")
def health():
    return {"status": "ok"}
