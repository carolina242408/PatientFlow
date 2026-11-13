from uuid import uuid4

import pytest

from bed_allocation.schemas.patient_waiting import PatientWaiting
from bed_allocation.services.allocation_service import suggest_allocations


@pytest.mark.asyncio
async def test_selected_encounters_are_filtered_before_solving(monkeypatch):
    first = PatientWaiting(
        encounter_id=uuid4(), service_id=None, patient_id=uuid4(), full_name="First"
    )
    second = PatientWaiting(
        encounter_id=uuid4(), service_id=None, patient_id=uuid4(), full_name="Second"
    )
    monkeypatch.setattr(
        "bed_allocation.services.allocation_service.get_patients_waiting",
        lambda session: _async_result([first, second]),
    )
    monkeypatch.setattr(
        "bed_allocation.services.allocation_service.get_available_beds",
        lambda session: _async_result([]),
    )
    selected = []

    def capture(patients, beds):
        selected.extend(patients)
        from bed_allocation.schemas.allocation import AllocationResult

        return AllocationResult()

    monkeypatch.setattr("bed_allocation.services.allocation_service.optimize", capture)

    result = await suggest_allocations(object(), [first.encounter_id])

    assert result.suggestions == []
    assert [patient.encounter_id for patient in selected] == [first.encounter_id]


async def _async_result(value):
    return value
