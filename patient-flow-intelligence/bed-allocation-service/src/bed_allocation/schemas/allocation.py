from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

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
    status: SuggestionStatus
