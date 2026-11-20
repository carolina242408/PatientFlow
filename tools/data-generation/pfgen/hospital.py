"""Hospital physical model: wards -> rooms -> beds (+ overflow stretchers)."""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover
    from .simulation import Episode


@dataclass(eq=False)
class Bed:
    uid: int
    code: str                 # PV1-3.3  ("001", "MAC1")
    kind: str                 # PV1-3.6  "Cama" | "Maca"
    room: "Room"
    occupant: "Episode | None" = None
    blocked_until: datetime | None = None   # cleaning after discharge/transfer

    @property
    def ward(self) -> "Ward":
        return self.room.ward

    @property
    def is_stretcher(self) -> bool:
        return self.kind == "Maca"

    @property
    def key(self) -> str:
        return f"{self.ward.code}^{self.room.number}^{self.code}"

    @property
    def fhir_id(self) -> str:
        return f"bed-{self.ward.code}-{self.room.number}-{self.code}".lower()

    def is_free(self, now: datetime) -> bool:
        return self.occupant is None and (self.blocked_until is None or self.blocked_until <= now)

    def display(self) -> str:
        return f"Ward {self.ward.code}, Room {self.room.number}, Bed {self.code}"


@dataclass(eq=False)
class Room:
    number: str
    label: str
    ward: "Ward"
    beds: list[Bed] = field(default_factory=list)
    corridor: bool = False

    @property
    def fhir_id(self) -> str:
        return f"room-{self.ward.code}-{self.number}".lower()

    def accepts(self, sex: str) -> bool:
        """Sex cohorting: a room takes a patient if empty or all occupants share the sex."""
        if self.ward.mixed_sex or self.corridor:
            return True
        return all(b.occupant is None or b.occupant.patient.sex == sex for b in self.beds)

    def occupied_by(self, sex: str) -> int:
        return sum(1 for b in self.beds if b.occupant is not None and b.occupant.patient.sex == sex)


@dataclass(eq=False)
class Ward:
    code: str
    name: str
    specialty: str
    building: int
    floor: int
    mixed_sex: bool = False
    rooms: list[Room] = field(default_factory=list)
    stretchers: list[Bed] = field(default_factory=list)

    @property
    def fhir_id(self) -> str:
        return f"ward-{self.code}"

    @property
    def beds(self) -> list[Bed]:
        return [b for r in self.rooms for b in r.beds]

    @property
    def capacity(self) -> int:
        return len(self.beds)

    def occupied(self) -> int:
        return sum(1 for b in self.beds if b.occupant is not None)

    def free_beds(self, now: datetime) -> int:
        return sum(1 for b in self.beds if b.is_free(now))


class Hospital:
    def __init__(self, config: dict[str, Any]):
        self.config = config
        inst = config["institution"]
        self.facility: str = inst["facility"]
        self.sending_application: str = inst["sending_application"]
        self.receiving_application: str = inst["receiving_application"]
        self.servicing_facility: str = inst.get("servicing_facility", "")
        self.name: str = inst["name"]
        self.financial_entity: dict = inst.get("financial_entity", {"code": "935601", "name": "SNS"})
        self.emergency: dict = config["emergency"]
        self.outpatient: dict = config.get("outpatient", {"code": "10020", "name": "CONSULTA EXTERNA"})
        building = int(inst.get("building", 1))

        self.wards: list[Ward] = []
        uid = 3000
        for w in config["wards"]:
            ward = Ward(
                code=str(w["code"]),
                name=w["name"],
                specialty=w["specialty"],
                building=int(w.get("building", building)),
                floor=int(w["floor"]),
                mixed_sex=bool(w.get("mixed_sex", False)),
            )
            for room_def in self._expand_rooms(w["rooms"]):
                room = Room(number=str(room_def["number"]), label=room_def["label"], ward=ward)
                for _ in range(int(room_def["beds"])):
                    uid += 1
                    bed_no = sum(len(r.beds) for r in ward.rooms) + len(room.beds) + 1
                    room.beds.append(Bed(uid=uid, code=f"{bed_no:03d}", kind="Cama", room=room))
                ward.rooms.append(room)
            stretchers = int(w.get("stretchers", 0))
            if stretchers:
                corridor = Room(number=f"{ward.floor}099", label="CORREDOR", ward=ward, corridor=True)
                for i in range(stretchers):
                    uid += 1
                    bed = Bed(uid=uid, code=f"MAC{i + 1}", kind="Maca", room=corridor)
                    corridor.beds.append(bed)
                    ward.stretchers.append(bed)
            self.wards.append(ward)

        self.by_code = {w.code: w for w in self.wards}
        self.specialties = sorted({w.specialty for w in self.wards})

    @staticmethod
    def _expand_rooms(spec: Any) -> list[dict]:
        if isinstance(spec, list):
            return [
                {"number": r["number"], "label": r.get("label", f"SALA {i + 1}"), "beds": r.get("beds", 1)}
                for i, r in enumerate(spec)
            ]
        first = int(spec["first_number"])
        return [
            {"number": first + i, "label": f"SALA {i + 1}", "beds": int(spec["beds_per_room"])}
            for i in range(int(spec["count"]))
        ]

    # ------------------------------------------------------------------ queries
    def wards_of(self, specialty: str) -> list[Ward]:
        return [w for w in self.wards if w.specialty == specialty]

    def capacity_of(self, specialty: str) -> int:
        return sum(w.capacity for w in self.wards_of(specialty))

    def all_beds(self) -> list[Bed]:
        return [b for w in self.wards for r in w.rooms for b in r.beds] + [
            b for w in self.wards for b in w.stretchers
        ]

    def find_bed(
        self,
        wards: list[Ward],
        sex: str,
        now: datetime,
        rng: random.Random,
        exclude_room: Room | None = None,
    ) -> Bed | None:
        """Pick a free real bed, packing patients into same-sex rooms first."""
        candidates: list[tuple[float, Bed]] = []
        for ward in wards:
            load = ward.occupied() / max(1, ward.capacity)
            for room in ward.rooms:
                if room is exclude_room or not room.accepts(sex):
                    continue
                same_sex = room.occupied_by(sex)
                for bed in room.beds:
                    if bed.is_free(now):
                        # prefer rooms already holding same-sex patients, then less loaded wards
                        score = -same_sex * 10 + load * 5 + rng.random()
                        candidates.append((score, bed))
        if not candidates:
            return None
        return min(candidates, key=lambda c: c[0])[1]

    def find_stretcher(self, wards: list[Ward], now: datetime) -> Bed | None:
        for ward in sorted(wards, key=lambda w: w.occupied()):
            for bed in ward.stretchers:
                if bed.is_free(now):
                    return bed
        return None
