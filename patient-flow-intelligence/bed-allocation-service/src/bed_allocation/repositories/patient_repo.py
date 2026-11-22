from pathlib import Path

import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from bed_allocation.config import settings
from bed_allocation.schemas.patient_waiting import PatientWaiting

PATIENT_QUERY = text(
    """
    SELECT e.id AS encounter_id, e.service_id, p.id AS patient_id, p.full_name,
           p.birth_date,
           p.gender, p.isolation, e.expected_discharge_at
    FROM encounters e
    JOIN patients p ON p.id = e.patient_id
    LEFT JOIN location_allocations la
      ON la.encounter_id = e.id AND la.discharged_at IS NULL
    WHERE e.status = 'IN_PROGRESS' AND la.id IS NULL
    """
)


async def get_patients_waiting(session: AsyncSession) -> list[PatientWaiting]:
    if settings.use_excel:
        rows = pd.read_excel(Path("data/patients.xlsx")).to_dict("records")
        return [PatientWaiting.model_validate(row) for row in rows]
    result = await session.execute(PATIENT_QUERY)
    return [PatientWaiting.model_validate(dict(row)) for row in result.mappings()]

