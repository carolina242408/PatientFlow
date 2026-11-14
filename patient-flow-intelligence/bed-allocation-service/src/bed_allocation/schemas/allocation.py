from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from bed_allocation.models.enums import SuggestionStatus


class AllocationSuggestion(BaseModel):
    encounter_id: UUID
    bed_id: UUID
    score: float
    justification: str


class AllocationResult(BaseModel):
    suggestions: list[AllocationSuggestion] = Field(default_factory=list)
    solver_status: str = "EMPTY"


class SuggestionResponse(AllocationSuggestion):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    status: SuggestionStatus
    created_at: datetime


class SuggestionStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def normalize_status(cls, value: str) -> str:
        return {
            "ACEITE": SuggestionStatus.ACCEPTED,
            "REJEITADA": SuggestionStatus.REJECTED,
            "PENDENTE": SuggestionStatus.PENDING,
        }.get(value, value)


class ServiceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str


class ImminentBed(BaseModel):
    bed_id: UUID
    bed_label: str
    current_patient_name: str
    expected_discharge_at: datetime
    hours_until_free: float


class ManualAdmissionRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    birth_date: date | None = None
    gender: str | None = Field(default=None, pattern="^[FM]$")
    sns_number: str | None = Field(default=None, pattern=r"^\d{9}$")
    hospital_number: str | None = None
    service_id: UUID | None = None
    diagnosis_code: str | None = None
    diagnosis_description: str | None = None
    priority: int = Field(ge=1, le=5)
    expected_discharge_at: datetime | None = None
    auto_accept: bool = False


class ManualAdmissionSuggestion(BaseModel):
    id: UUID
    bed_id: UUID
    bed_label: str
    score: float
    justification: str


class ManualAdmissionResult(BaseModel):
    encounter_id: UUID
    patient_id: UUID
    suggestions: list[ManualAdmissionSuggestion] = Field(default_factory=list)
    solver_status: str
    accepted_allocation_id: UUID | None = None
