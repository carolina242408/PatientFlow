from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class PatientWaiting(BaseModel):
    encounter_id: UUID
    service_id: UUID | None
    patient_id: UUID
    full_name: str
    birth_date: date | None = None
    gender: str | None = None
    isolation: bool = False
    expected_discharge_at: datetime | None = None

