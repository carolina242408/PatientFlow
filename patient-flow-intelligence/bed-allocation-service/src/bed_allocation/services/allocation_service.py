from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from bed_allocation.config import settings
from bed_allocation.repositories.bed_repo import get_available_beds
from bed_allocation.repositories.patient_repo import get_patients_waiting
from bed_allocation.repositories.suggestion_repo import save_suggestions
from bed_allocation.schemas.allocation import AllocationResult
from bed_allocation.solver.optimizer import optimize


async def suggest_allocations(
    session: AsyncSession, encounter_ids: list[UUID] | None = None
) -> AllocationResult:
    patients = await get_patients_waiting(session)
    if encounter_ids is not None:
        selected = set(encounter_ids)
        patients = [patient for patient in patients if patient.encounter_id in selected]
    beds = await get_available_beds(session)
    result = optimize(patients, beds)
    if not settings.use_excel:
        await save_suggestions(session, result)
    return result
