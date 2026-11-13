from uuid import UUID

from bed_allocation.config import settings
from bed_allocation.schemas.bed_flat import BedFlat
from bed_allocation.schemas.patient_waiting import PatientWaiting


def build_pair_flags(
    patients: list[PatientWaiting], beds: list[BedFlat]
) -> dict[tuple[UUID, UUID], dict[str, bool]]:
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
                "isolation_ok": not settings.bed_isolation.get(bed.bed_id, False)
                or settings.priority_by_encounter.get(patient.encounter_id, 1) > 1,
            }
    return flags

