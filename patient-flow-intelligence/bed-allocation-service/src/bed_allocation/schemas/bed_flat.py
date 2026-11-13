from uuid import UUID

from pydantic import BaseModel


class BedFlat(BaseModel):
    bed_id: UUID
    bed_code: str
    room_id: UUID
    room_code: str
    ward_id: UUID
    ward_code: str
    ward_name: str
    service_id: UUID
    service_code: str
    service_name: str
    floor_id: UUID
    floor_name: str
    unit_id: UUID
    unit_name: str
    uls_id: UUID
    uls_name: str

