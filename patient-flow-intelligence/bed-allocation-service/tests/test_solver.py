from datetime import date
from uuid import uuid4

from bed_allocation.schemas.bed_flat import BedFlat
from bed_allocation.schemas.patient_waiting import PatientWaiting
from bed_allocation.solver.precompute import is_priority_age_cohort
from bed_allocation.solver.optimizer import optimize


def bed(service_id, *, isolation=False):
    return BedFlat(
        bed_id=uuid4(), bed_code="B", room_id=uuid4(), room_code="R", ward_id=uuid4(),
        ward_code="W", ward_name="Ward", service_id=service_id, service_code="S",
        service_name="Service", floor_id=uuid4(), floor_name="F", unit_id=uuid4(),
        unit_name="Unit", uls_id=uuid4(), uls_name="ULS",
    )


def patient(service_id, *, birth_date=None):
    return PatientWaiting(
        encounter_id=uuid4(),
        service_id=service_id,
        patient_id=uuid4(),
        full_name="P",
        birth_date=birth_date,
    )


def test_empty_input():
    assert optimize([], []).suggestions == []


def test_assigns_unique_compatible_pairs():
    service = uuid4()
    patients = [patient(service), patient(service)]
    beds = [bed(service), bed(service)]
    result = optimize(patients, beds)
    assert len(result.suggestions) == 2
    assert {s.encounter_id for s in result.suggestions} == {p.encounter_id for p in patients}


def test_priority_age_cohort_is_preferred_for_shared_bed():
    child = patient(None, birth_date=date(2010, 6, 1))
    adult = patient(None, birth_date=date(1986, 6, 1))

    result = optimize([adult, child], [bed(None)])

    assert [suggestion.encounter_id for suggestion in result.suggestions] == [child.encounter_id]


def test_priority_age_cohort_boundaries():
    assert is_priority_age_cohort(date(2008, 6, 2), today=date(2026, 6, 1))
    assert not is_priority_age_cohort(date(2008, 6, 1), today=date(2026, 6, 1))
    assert is_priority_age_cohort(date(1961, 6, 1), today=date(2026, 6, 1))
    assert not is_priority_age_cohort(date(1961, 6, 2), today=date(2026, 6, 1))

