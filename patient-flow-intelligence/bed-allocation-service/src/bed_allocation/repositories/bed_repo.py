from pathlib import Path

import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from bed_allocation.config import settings
from bed_allocation.schemas.bed_flat import BedFlat

BED_QUERY = text(
    """
    SELECT b.id AS bed_id, b.code AS bed_code, r.id AS room_id, r.code AS room_code,
           w.id AS ward_id, w.code AS ward_code, w.name AS ward_name,
           cs.id AS service_id, cs.code AS service_code, cs.name AS service_name,
           f.id AS floor_id, f.level_name AS floor_name,
           hu.id AS unit_id, hu.name AS unit_name, u.id AS uls_id, u.name AS uls_name
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
        return [BedFlat.model_validate(row) for row in rows]
    result = await session.execute(BED_QUERY)
    return [BedFlat.model_validate(dict(row)) for row in result.mappings()]


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
            BedFlat.model_validate(dict(row)),
            float(row["hours_until_free"]),
            str(row["current_patient_name"]),
        )
        for row in rows
    ]

