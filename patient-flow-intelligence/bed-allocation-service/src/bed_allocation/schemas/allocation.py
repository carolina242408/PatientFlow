from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from bed_allocation.models.enums import SuggestionStatus


class AllocationSuggestion(BaseModel):
    encounter_id: UUID
    bed_id: UUID
    bed_label: str | None = None
    score: float
    justification: str


class AllocationResult(BaseModel):
    suggestions: list[AllocationSuggestion] = Field(default_factory=list)
    reallocations: list["ReallocationSuggestion"] = Field(default_factory=list)
    comparisons: list["BedComparison"] = Field(default_factory=list)
    room_eviction_ranking: list["RoomEvictionEntry"] = Field(default_factory=list)
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
    isolation: bool = False
    sns_number: str | None = Field(default=None, pattern=r"^\d{9}$")
    hospital_number: str | None = None
    service_id: UUID | None = None
    diagnosis_code: str | None = None
    diagnosis_description: str | None = None
    priority: int = Field(ge=1, le=5)
    expected_discharge_at: datetime | None = None


class ManualAdmissionSuggestion(BaseModel):
    id: UUID
    bed_id: UUID
    bed_label: str
    score: float
    justification: str


class ManualAdmissionResult(BaseModel):
    encounter_id: UUID
    patient_id: UUID
    suggestions: list[AllocationSuggestion] = Field(default_factory=list)
    reallocations: list["ReallocationSuggestion"] = Field(default_factory=list)
    comparisons: list["BedComparison"] = Field(default_factory=list)
    room_eviction_ranking: list["RoomEvictionEntry"] = Field(default_factory=list)
    solver_status: str
    debug_enabled: bool = False


class ReallocationWarning(BaseModel):
    code: Literal["WARD_TRANSFER", "NO_BED_AVAILABLE"]
    message: str
    affected_patients: list[str] = Field(default_factory=list)


class ReallocationSuggestion(BaseModel):
    new_patient_encounter_id: UUID
    from_bed_id: UUID
    from_bed_label: str
    displaced_encounter_id: UUID
    displaced_patient_name: str
    to_bed_id: UUID | None
    to_bed_label: str | None
    target_is_ward_transfer: bool = False
    score_combined: float
    justification: str
    room_eviction_score: float
    displaced_priority: int
    displaced_original_score: float
    warning: ReallocationWarning | None = None


class RoomEvictionEntry(BaseModel):
    room_id: UUID
    room_label: str
    eviction_score: float
    occupant_scores: list[tuple[str, float]] = Field(default_factory=list)
    is_isolation_room: bool


class DebugEntry(BaseModel):
    encounter_id: UUID
    patient_name: str
    bed_id: UUID
    bed_label: str
    score_breakdown: dict[str, float]
    total_score: float


class BedComparison(BaseModel):
    bed_id: UUID
    bed_label: str
    candidates: list[DebugEntry] = Field(default_factory=list)


AllocationResult.model_rebuild()
ManualAdmissionResult.model_rebuild()
