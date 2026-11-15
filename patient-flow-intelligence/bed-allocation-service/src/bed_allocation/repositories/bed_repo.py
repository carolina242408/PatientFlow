from pathlib import Path

import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from bed_allocation.config import is_isolation_bed, settings
from bed_allocation.schemas.bed_flat import BedFlat

BED_QUERY = text(
    """
    SELECT b.id AS bed_id, b.code AS bed_code, r.id AS room_id, r.code AS room_code,
           w.id AS ward_id, w.code AS ward_code, w.name AS ward_name,
           cs.id AS service_id, cs.code AS service_code, cs.name AS service_name,
           f.id AS floor_id, f.level_name AS floor_name,
           hu.id AS unit_id, hu.name AS unit_name, u.id AS uls_id, u.name AS uls_name,
           NOT EXISTS (
               SELECT 1
               FROM location_allocations la
               JOIN beds occupied_beds ON occupied_beds.id = la.bed_id
               WHERE occupied_beds.room_id = r.id AND la.discharged_at IS NULL
           ) AS room_is_empty
    FROM beds b
    JOIN rooms r ON r.id = b.room_id
    JOIN wards w ON w.id = r.ward_id
    JOIN wings wi ON wi.id = w.wing_id
    JOIN clinical_services cs ON cs.id = wi.service_id
    JOIN floors f ON f.id = cs.floor_id
    JOIN buildings bl ON bl.id = f.building_id
    JOIN healthcare_units hu ON hu.id = bl.unit_id
    JOIN uls u ON u.id = hu.uls_id
    WHERE b.status = 'AVAILABLE'
      AND NOT EXISTS (
          SELECT 1 FROM location_allocations la
          WHERE la.bed_id = b.id AND la.discharged_at IS NULL
      )
    """
)


async def get_available_beds(session: AsyncSession) -> list[BedFlat]:
    if settings.use_excel:
        rows = pd.read_excel(Path("data/beds.xlsx")).to_dict("records")
        return [
            bed.model_copy(
                update={
                    "is_isolation_room": is_isolation_bed(bed.bed_id, bed.room_id)
                }
            )
            for row in rows
            for bed in [BedFlat.model_validate(row)]
        ]
    result = await session.execute(BED_QUERY)
    return [
        BedFlat.model_validate(dict(row)).model_copy(
            update={
                "is_isolation_room": is_isolation_bed(
                    row["bed_id"], row["room_id"], bool(row["room_is_empty"])
                )
            }
        )
        for row in result.mappings()
    ]


async def get_beds_with_imminent_discharge(
    session: AsyncSession, within_hours: int
) -> list[tuple[BedFlat, float, str]]:
    query = text(
        """
        SELECT b.id AS bed_id, b.code AS bed_code, r.id AS room_id, r.code AS room_code,
               w.id AS ward_id, w.code AS ward_code, w.name AS ward_name,
               cs.id AS service_id, cs.code AS service_code, cs.name AS service_name,
               f.id AS floor_id, f.level_name AS floor_name,
               hu.id AS unit_id, hu.name AS unit_name, u.id AS uls_id, u.name AS uls_name,
               p.full_name AS current_patient_name, e.expected_discharge_at,
               EXTRACT(EPOCH FROM (e.expected_discharge_at - now())) / 3600 AS hours_until_free
        FROM beds b
        JOIN rooms r ON r.id = b.room_id
        JOIN wards w ON w.id = r.ward_id
        JOIN wings wi ON wi.id = w.wing_id
        JOIN clinical_services cs ON cs.id = wi.service_id
        JOIN floors f ON f.id = cs.floor_id
        JOIN buildings bl ON bl.id = f.building_id
        JOIN healthcare_units hu ON hu.id = bl.unit_id
        JOIN uls u ON u.id = hu.uls_id
        JOIN location_allocations la ON la.bed_id = b.id AND la.discharged_at IS NULL
        JOIN encounters e ON e.id = la.encounter_id
        JOIN patients p ON p.id = e.patient_id
        WHERE e.expected_discharge_at IS NOT NULL
          AND e.expected_discharge_at BETWEEN now()
              AND now() + (interval '1 hour' * :within_hours)
        """
    )
    result = await session.execute(query, {"within_hours": within_hours})
    rows = result.mappings()
    # rooms has no label column; room.code is the fallback used for UI labels.
    return [
        (
            BedFlat.model_validate(dict(row)).model_copy(
                update={
                    "is_isolation_room": is_isolation_bed(row["bed_id"], row["room_id"])
                }
            ),
            float(row["hours_until_free"]),
            str(row["current_patient_name"]),
        )
        for row in rows
    ]


async def get_displaceable_allocations(session: AsyncSession) -> list[dict]:
    query = text(
        """
        SELECT e.id AS encounter_id, p.id AS patient_id, p.full_name,
               p.gender, p.birth_date, p.isolation, e.service_id,
               e.expected_discharge_at, b.id AS current_bed_id,
               b.code AS current_bed_code, r.id AS current_room_id,
               r.code AS current_room_code, w.id AS current_ward_id,
               w.code AS current_ward_code, w.name AS current_ward_name,
               cs.id AS current_service_id, cs.code AS current_service_code,
               cs.name AS current_service_name, f.id AS current_floor_id,
               f.level_name AS current_floor_name, hu.id AS current_unit_id,
               hu.name AS current_unit_name, u.id AS current_uls_id,
               u.name AS current_uls_name,
               b.status AS current_bed_status
        FROM location_allocations la
        JOIN encounters e ON e.id = la.encounter_id
        JOIN patients p ON p.id = e.patient_id
        JOIN beds b ON b.id = la.bed_id
        JOIN rooms r ON r.id = b.room_id
        JOIN wards w ON w.id = r.ward_id
        JOIN wings wi ON wi.id = w.wing_id
        JOIN clinical_services cs ON cs.id = wi.service_id
        JOIN floors f ON f.id = cs.floor_id
        JOIN buildings bl ON bl.id = f.building_id
        JOIN healthcare_units hu ON hu.id = bl.unit_id
        JOIN uls u ON u.id = hu.uls_id
        WHERE la.discharged_at IS NULL
        """
    )
    result = await session.execute(query)
    allocations = []
    for row in result.mappings():
        allocations.append(
            {
                **dict(row),
                "patient_priority": settings.priority_by_encounter.get(row["encounter_id"], 1),
            }
        )
    return allocations

