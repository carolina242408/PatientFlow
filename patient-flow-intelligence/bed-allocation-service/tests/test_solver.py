from datetime import date
from uuid import uuid4

from bed_allocation.config import is_isolation_bed, settings
from bed_allocation.schemas.bed_flat import BedFlat
from bed_allocation.schemas.patient_waiting import PatientWaiting
from bed_allocation.solver.precompute import is_priority_age_cohort
from bed_allocation.solver.optimizer import optimize, reallocation_suggestions


def bed(service_id, *, isolation=False):
    return BedFlat(
        bed_id=uuid4(), bed_code="B", room_id=uuid4(), room_code="R", ward_id=uuid4(),
        ward_code="W", ward_name="Ward", service_id=service_id, service_code="S",
        service_name="Service", floor_id=uuid4(), floor_name="F", unit_id=uuid4(),
        unit_name="Unit", uls_id=uuid4(), uls_name="ULS", is_isolation_room=isolation,
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


def test_assigns_isolation_patient_to_empty_isolation_bed():
    service = uuid4()
    isolation_patient = patient(service)
    isolation_patient.isolation = True

    result = optimize([isolation_patient], [bed(service, isolation=True)])

    assert len(result.suggestions) == 1
    assert result.suggestions[0].encounter_id == isolation_patient.encounter_id


def test_explicit_bed_isolation_configuration_is_used(monkeypatch):
    isolation_bed = bed(None)
    monkeypatch.setattr(settings, "bed_isolation", {isolation_bed.bed_id: True})

    assert is_isolation_bed(isolation_bed.bed_id, isolation_bed.room_id)


def test_empty_room_isolation_fallback():
    empty_room_bed = bed(None)

    assert is_isolation_bed(empty_room_bed.bed_id, empty_room_bed.room_id, room_is_empty=True)


def test_isolation_reallocation_allows_displaced_patient_to_change_service():
    service = uuid4()
    other_service = uuid4()
    new_patient = patient(service)
    new_patient.isolation = True
    current_bed = bed(service, isolation=True)
    target_bed = bed(other_service)
    allocation = {
        "encounter_id": uuid4(),
        "service_id": service,
        "patient_id": uuid4(),
        "full_name": "Current patient",
        "birth_date": None,
        "gender": None,
        "isolation": False,
        "expected_discharge_at": None,
        "current_bed_id": current_bed.bed_id,
        "current_bed_code": current_bed.bed_code,
        "current_room_id": current_bed.room_id,
        "current_room_code": current_bed.room_code,
        "current_ward_id": current_bed.ward_id,
        "current_ward_code": current_bed.ward_code,
        "current_ward_name": current_bed.ward_name,
        "current_service_id": current_bed.service_id,
        "current_service_code": current_bed.service_code,
        "current_service_name": current_bed.service_name,
        "current_floor_id": current_bed.floor_id,
        "current_floor_name": current_bed.floor_name,
        "current_unit_id": current_bed.unit_id,
        "current_unit_name": current_bed.unit_name,
        "current_uls_id": current_bed.uls_id,
        "current_uls_name": current_bed.uls_name,
        "patient_priority": 3,
    }

    suggestions = reallocation_suggestions(new_patient, [target_bed], [allocation])

    assert len(suggestions) == 1
    assert suggestions[0].to_bed_id == target_bed.bed_id


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

