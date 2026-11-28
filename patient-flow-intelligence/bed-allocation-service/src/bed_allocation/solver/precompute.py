from datetime import date
from uuid import UUID

from bed_allocation.config import settings
from bed_allocation.schemas.bed_flat import BedFlat
from bed_allocation.schemas.patient_waiting import PatientWaiting


def is_priority_age_cohort(birth_date: date | None, today: date | None = None) -> bool:
    if birth_date is None:
        return False
    reference_date = today or date.today()
    if birth_date > reference_date:
        return False
    age = reference_date.year - birth_date.year - (
        (reference_date.month, reference_date.day) < (birth_date.month, birth_date.day)
    )
    return age < 18 or age >= 65


def build_pair_flags(
    patients: list[PatientWaiting], beds: list[BedFlat],
    imminent_beds: dict[UUID, float] | None = None,
) -> dict[tuple[UUID, UUID], dict[str, bool | float | None]]:
    flags = {}
    for patient in patients:
        for bed in beds:
            room_rule = settings.room_sex_rules.get(bed.room_id, "MIXED")
            sex_ok = room_rule == "MIXED" or patient.gender is None or patient.gender == room_rule
            flags[(patient.encounter_id, bed.bed_id)] = {
                "service_match": patient.service_id is None or patient.service_id == bed.service_id,
                "same_uls": patient.service_id is not None and patient.service_id == bed.service_id,
                "same_unit": patient.service_id is not None and patient.service_id == bed.service_id,
                "same_floor": patient.service_id is not None and patient.service_id == bed.service_id,
                "sex_ok": sex_ok,
                "isolation_ok": patient.isolation == bed.is_isolation_room,
                "isolation_match": patient.isolation == bed.is_isolation_room,
                "imminent_discharge": bed.bed_id in (imminent_beds or {}),
                "age_cohort_priority": is_priority_age_cohort(patient.birth_date),
                "hours_until_free": (imminent_beds or {}).get(bed.bed_id),
            }
    return flags

