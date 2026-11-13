from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class PatientWaiting(BaseModel):
    encounter_id: UUID
    service_id: UUID | None
    patient_id: UUID
    full_name: str
    gender: str | None = None
    expected_discharge_at: datetime | None = None

