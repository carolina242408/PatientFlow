from uuid import uuid4

from bed_allocation.schemas.bed_flat import BedFlat
from bed_allocation.schemas.patient_waiting import PatientWaiting
from bed_allocation.solver.optimizer import optimize


def bed(service_id, *, isolation=False):
    return BedFlat(
        bed_id=uuid4(), bed_code="B", room_id=uuid4(), room_code="R", ward_id=uuid4(),
        ward_code="W", ward_name="Ward", service_id=service_id, service_code="S",
        service_name="Service", floor_id=uuid4(), floor_name="F", unit_id=uuid4(),
        unit_name="Unit", uls_id=uuid4(), uls_name="ULS",
    )


def patient(service_id):
    return PatientWaiting(encounter_id=uuid4(), service_id=service_id, patient_id=uuid4(), full_name="P")


def test_empty_input():
    assert optimize([], []).suggestions == []


def test_assigns_unique_compatible_pairs():
    service = uuid4()
    patients = [patient(service), patient(service)]
    beds = [bed(service), bed(service)]
    result = optimize(patients, beds)
    assert len(result.suggestions) == 2
    assert {s.encounter_id for s in result.suggestions} == {p.encounter_id for p in patients}

