from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from bed_allocation.config import settings
from bed_allocation.models.allocation import AllocationSuggestionRecord, LocationAllocation
from bed_allocation.models.hierarchy import Bed
from bed_allocation.repositories.bed_repo import get_available_beds, get_beds_with_imminent_discharge
from bed_allocation.repositories.patient_repo import get_patients_waiting
from bed_allocation.schemas.allocation import AllocationResult
from bed_allocation.solver.optimizer import optimize


async def suggest_allocations(
    session: AsyncSession, encounter_ids: list[UUID] | None = None
) -> AllocationResult:
    patients = await get_patients_waiting(session)
    if encounter_ids is not None:
        selected = set(encounter_ids)
        patients = [patient for patient in patients if patient.encounter_id in selected]
    from bed_allocation.repositories.suggestion_repo import save_suggestions

    beds = await get_available_beds(session)
    imminent = await get_beds_with_imminent_discharge(session, settings.imminent_discharge_hours)
    imminent_map = {bed.bed_id: hours for bed, hours, _ in imminent}
    result = optimize(patients, beds, imminent_map)
    if not settings.use_excel:
        await save_suggestions(session, result)
        await session.commit()
    return result


async def materialize_allocation(
    session: AsyncSession, suggestion: AllocationSuggestionRecord
) -> LocationAllocation:
    allocation = LocationAllocation(
        id=uuid4(),
        encounter_id=suggestion.encounter_id,
        bed_id=suggestion.bed_id,
        assigned_at=datetime.now(timezone.utc),
    )
    session.add(allocation)
    await session.execute(
        update(Bed)
        .where(Bed.id == suggestion.bed_id)
        .values(status="OCCUPIED", version=Bed.version + 1)
    )
    await session.execute(
        update(AllocationSuggestionRecord)
        .where(
            AllocationSuggestionRecord.encounter_id == suggestion.encounter_id,
            AllocationSuggestionRecord.id != suggestion.id,
            AllocationSuggestionRecord.status == "PENDING",
        )
        .values(status="REJECTED")
    )
    suggestion.status = "ACCEPTED"
    return allocation
