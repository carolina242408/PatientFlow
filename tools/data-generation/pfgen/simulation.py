"""Discrete-event simulation of inpatient flow in a Portuguese hospital.

Events produced (all become HL7 ADT messages):

* A01 admission  - from Urgência (urgent) or Consulta Externa (elective), with
  a bed attributed. When the service is full the patient goes to a stretcher
  (maca) in the ward, waits in the Urgência, or - after a maximum wait - is
  admitted as an *outlier* in another service's ward ("internado em serviço
  alheio"; PV1-10 keeps the owning service while PV1-3 is the borrowed bed).
* A02 transfer   - bed change, room change, stretcher -> bed, outlier returning
  to its own ward, consult-driven service transfer, ICU admission (clinical
  deterioration or post-op) and ICU step-down.
* A03 discharge  - home / RNCCI / care home / other hospital / death, mostly
  late morning and afternoon, fewer on weekends.

Beds are blocked for cleaning after every exit, rooms are sex-cohorted and
every state change is validated so a bed never holds two patients.
"""

from __future__ import annotations

import heapq
import itertools
import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Callable

from .clinical import Diagnosis
from .hospital import Bed, Hospital, Ward
from .identity import IdentityRegistry, PatientIdentity, Staff
from .synthea import PoolPatient

DAY = timedelta(days=1)
HOUR = timedelta(hours=1)

# (reason code, Portuguese text, HL7 EVN-4 table 0062)
R_ADMISSION = ("ADM", "ADMISSAO", "A")
R_BED = ("MC", "MUDANCA DE CAMA", "03")
R_ROOM = ("MQ", "MUDANCA DE QUARTO", "03")
R_STRETCHER = ("MCC", "MACA PARA CAMA", "03")
R_RETURN = ("RS", "REGRESSO AO SERVICO DE ORIGEM", "03")
R_SERVICE = ("TS", "TRANSFERENCIA DE SERVICO", "02")
R_ICU = ("TU", "TRANSFERENCIA PARA MEDICINA INTENSIVA", "02")
R_STEPDOWN = ("AU", "ALTA DA MEDICINA INTENSIVA", "02")
R_DISCHARGE = ("ALT", "ALTA", "")
R_DEATH = ("OBT", "OBITO", "")
R_CENSUS = ("CEN", "CARGA INICIAL DE INTERNADOS", "A")


@dataclass(eq=False)
class Movement:
    start: datetime
    bed: Bed
    service: Ward
    end: datetime | None = None


@dataclass(eq=False)
class Episode:
    patient: PatientIdentity
    pool: PoolPatient
    specialty: str
    admitting_specialty: str
    diagnosis: Diagnosis
    urgent: bool
    arrival: datetime
    readmission_of: str | None = None
    number: str | None = None
    state: str = "waiting"             # waiting | admitted | discharged | cancelled
    admit_time: datetime | None = None
    discharge_time: datetime | None = None
    planned_discharge: datetime | None = None
    bed: Bed | None = None
    service: Ward | None = None
    attending: Staff | None = None
    movements: list[Movement] = field(default_factory=list)
    discharge_token: int = 0
    dies: bool = False
    return_specialty: str | None = None
    remaining: timedelta | None = None
    disposition: dict | None = None
    condition: str | None = None
    procedures: list[dict] = field(default_factory=list)
    postponed: int = 0

    @property
    def is_outlier(self) -> bool:
        return self.bed is not None and self.service is not None and self.bed.ward is not self.service


@dataclass
class AdtEvent:
    trigger: str                     # A01 | A02 | A03
    occurred: datetime
    episode: Episode
    bed: Bed
    service: Ward
    attending: Staff
    reason: tuple[str, str, str]
    prior_bed: Bed | None = None
    prior_service: Ward | None = None
    census: bool = False


@dataclass
class SimulationResult:
    events: list[AdtEvent]
    episodes: list[Episode]
    start: datetime
    end: datetime
    stats: dict[str, Any]
    doctors: dict[str, list[Staff]]
    operators: list[Staff]
    census: list[tuple[Episode, Bed, Ward, Staff]] = field(default_factory=list)


class Simulation:
    def __init__(
        self,
        hospital: Hospital,
        config: dict[str, Any],
        pool: list[PoolPatient],
        registry: IdentityRegistry,
        rng: random.Random,
    ):
        self.h = hospital
        self.cfg = config
        self.flow = config["flow"]
        self.specs: dict[str, dict] = config["specialties"]
        self.pool = pool
        self.registry = registry
        self.rng = rng

        sim = config["simulation"]
        self.start = datetime.fromisoformat(sim["start"])
        self.end = self.start + timedelta(days=float(sim["days"]))
        self.t0 = self.start - timedelta(days=float(sim.get("warmup_days", 0)))
        self.now = self.t0

        self._heap: list[tuple[datetime, int, Callable, tuple]] = []
        self._seq = itertools.count()
        self.events: list[AdtEvent] = []
        self.episodes: list[Episode] = []
        self.active: set[str] = set()
        self.used: set[str] = set()
        self.waiting: dict[str, list[Episode]] = defaultdict(list)
        self.census_snapshot: list[tuple[Episode, Bed, Ward, Staff]] = []
        self.stats: dict[str, Any] = defaultdict(int)
        self.occupancy_samples: dict[str, list[float]] = defaultdict(list)
        self.max_wait = timedelta(0)

        self.doctors = {
            w.code: [registry.create_staff(w.code, doctor=True) for _ in range(rng.randint(4, 7))]
            for w in hospital.wards
        }
        self.operators = [registry.create_staff(None, doctor=False) for _ in range(12)]

        lo, hi = self.flow.get("bed_turnaround_minutes", [45, 120])
        self.turnaround = (int(lo), int(hi))

    # ================================================================== helpers
    def schedule(self, when: datetime, handler: Callable, *args: Any) -> None:
        heapq.heappush(self._heap, (when, next(self._seq), handler, args))

    def spec(self, name: str) -> dict:
        return self.specs.get(name, self.specs["MED"])

    def poisson(self, lam: float) -> int:
        if lam <= 0:
            return 0
        if lam > 30:
            return max(0, int(round(self.rng.gauss(lam, math.sqrt(lam)))))
        limit, k, p = math.exp(-lam), 0, 1.0
        while True:
            p *= self.rng.random()
            if p <= limit:
                return k
            k += 1

    def lognormal_days(self, mean: float, sd: float) -> timedelta:
        sigma2 = math.log(1 + (sd * sd) / (mean * mean))
        mu = math.log(mean) - sigma2 / 2
        days = self.rng.lognormvariate(mu, math.sqrt(sigma2))
        return timedelta(days=min(90.0, max(0.4, days)))

    def draw_los(self, specialty: str, factor: float = 1.0) -> timedelta:
        los = self.spec(specialty)["los"]
        return self.lognormal_days(float(los["mean"]) * factor, float(los["sd"]) * factor)

    def weighted_hour(self, profile: list[float]) -> int:
        return self.rng.choices(range(24), weights=profile)[0]

    def age_factor(self, ep: Episode) -> float:
        age = ep.patient.age_on(self.now.date())
        return min(2.2, max(0.3, (age / 70.0) ** 2))

    def discharge_slot(self, target: datetime, dies: bool) -> datetime:
        earliest = self.now + timedelta(hours=4)
        if dies:
            slot = target.replace(hour=self.rng.randint(0, 23), minute=self.rng.randint(0, 59))
        else:
            hour = self.weighted_hour(self.flow["discharge_hour_profile"])
            slot = target.replace(hour=hour, minute=self.rng.randint(0, 59), second=0, microsecond=0)
            if slot.weekday() >= 5 and self.rng.random() > float(self.flow.get("weekend_discharge_factor", 0.45)):
                slot += timedelta(days=7 - slot.weekday())          # postpone to Monday
        while slot < earliest:
            slot += DAY
        return slot

    def home_ward(self, specialty: str) -> Ward:
        wards = self.h.wards_of(specialty) or self.h.wards_of("MED")
        return min(wards, key=lambda w: (w.occupied() / max(1, w.capacity), self.rng.random()))

    def pick_doctor(self, ward: Ward) -> Staff:
        return self.rng.choice(self.doctors[ward.code])

    # ================================================================== arrivals
    def arrival_rate(self, specialty: str) -> float:
        cfg = self.spec(specialty)
        if "admissions_per_day" in cfg:
            return float(cfg["admissions_per_day"])
        capacity = self.h.capacity_of(specialty)
        return capacity * float(cfg.get("target_occupancy", 0.85)) / float(cfg["los"]["mean"])

    def expected_admissions(self) -> float:
        total_days = (self.end - self.t0).total_seconds() / 86400
        return sum(self.arrival_rate(s) for s in self.h.specialties) * total_days

    def schedule_arrivals(self) -> None:
        urgent_profile = self.flow["urgent_hour_profile"]
        weekday_factor = self.flow.get("weekday_factor", [1] * 7)
        day = datetime.combine(self.t0.date(), datetime.min.time())
        while day < self.end:
            for specialty in self.h.specialties:
                lam = self.arrival_rate(specialty)
                elective_share = float(self.spec(specialty).get("elective_share", 0))
                for _ in range(self.poisson(lam * (1 - elective_share) * weekday_factor[day.weekday()])):
                    when = day + timedelta(hours=self.weighted_hour(urgent_profile), minutes=self.rng.randint(0, 59))
                    if self.t0 <= when < self.end:
                        self.schedule(when, self.on_arrival, specialty, True, None, None)
                if day.weekday() < 5:
                    for _ in range(self.poisson(lam * elective_share * 7 / 5)):
                        when = day + timedelta(hours=self.rng.randint(8, 11), minutes=self.rng.randint(0, 59))
                        if self.t0 <= when < self.end:
                            self.schedule(when, self.on_arrival, specialty, False, None, None)
            day += DAY

    def select_patient(self, specialty: str) -> PoolPatient | None:
        cfg = self.spec(specialty)
        mean, sd = float(cfg["age"]["mean"]), float(cfg["age"]["sd"])
        today = self.now.date()
        with_case, without_case = [], []
        for p in self.pool:
            if p.deceased or p.key in self.active or p.key in self.used:
                continue
            age = p.age_on(today)
            weight = math.exp(-0.5 * ((age - mean) / sd) ** 2) + 0.01
            (with_case if specialty in p.cases else without_case).append((p, weight))
        candidates = with_case or without_case
        if not candidates:
            # population exhausted: reuse a previously discharged patient (counts as readmission)
            candidates = [(p, 1.0) for p in self.pool if not p.deceased and p.key not in self.active]
            if not candidates:
                return None
            self.stats["pool_reuse"] += 1
        people, weights = zip(*candidates)
        return self.rng.choices(people, weights=weights)[0]

    def choose_diagnosis(self, p: PoolPatient, specialty: str) -> Diagnosis:
        if p.cases.get(specialty):
            diagnoses, weights = zip(*p.cases[specialty])
            return self.rng.choices(diagnoses, weights=weights)[0]
        fb = self.rng.choice(self.spec(specialty)["fallback_diagnoses"])
        return Diagnosis(fb["icd10"], fb["text"], "ICD10", source="config")

    # ================================================================== handlers
    def on_arrival(self, specialty: str, urgent: bool, patient: PoolPatient | None, readmission_of: str | None,
                   episode: Episode | None = None) -> None:
        if episode is None:
            p = patient or self.select_patient(specialty)
            if p is None or p.deceased or p.key in self.active:
                self.stats["arrivals_without_patient"] += 1
                return
            identity = self.registry.create(p.key, p.sex, p.birth_date, self.now.date())
            episode = Episode(
                patient=identity, pool=p, specialty=specialty, admitting_specialty=specialty,
                diagnosis=self.choose_diagnosis(p, specialty), urgent=urgent, arrival=self.now,
                readmission_of=readmission_of,
            )
            self.episodes.append(episode)
            self.active.add(p.key)
            self.used.add(p.key)
            if readmission_of:
                self.stats["readmissions"] += 1

        if self.try_admit(episode, allow_stretcher=urgent):
            return
        if not urgent:
            # elective admission postponed (no bed): try again next working day, cancel after 2 tries
            if episode.postponed < 2:
                episode.postponed += 1
                self.stats["elective_postponed"] += 1
                retry = self.now + DAY
                while retry.weekday() >= 5:
                    retry += DAY
                self.schedule(retry, self.on_arrival, specialty, False, None, None, episode)
            else:
                episode.state = "cancelled"
                self.active.discard(episode.pool.key)
                self.stats["elective_cancelled"] += 1
            return
        self.waiting[specialty].append(episode)
        hours = float(self.flow.get("emergency_wait_max_hours", 10))
        self.schedule(self.now + timedelta(hours=hours), self.on_er_timeout, episode)

    def try_admit(self, ep: Episode, allow_stretcher: bool) -> bool:
        wards = self.h.wards_of(ep.specialty)
        bed = self.h.find_bed(wards, ep.patient.sex, self.now, self.rng)
        if bed is None and allow_stretcher:
            bed = self.h.find_stretcher(wards, self.now)
            if bed is not None:
                self.stats["stretcher_admissions"] += 1
        if bed is None:
            return False
        self.admit(ep, bed, bed.ward)
        return True

    def on_er_timeout(self, ep: Episode) -> None:
        if ep.state != "waiting":
            return
        for other in self.spec(ep.specialty).get("overflow_to", []):
            bed = self.h.find_bed(self.h.wards_of(other), ep.patient.sex, self.now, self.rng)
            if bed is not None:
                self.waiting[ep.specialty].remove(ep)
                self.stats["outlier_admissions"] += 1
                self.admit(ep, bed, self.home_ward(ep.specialty))
                return
        self.schedule(self.now + 2 * HOUR, self.on_er_timeout, ep)

    def admit(self, ep: Episode, bed: Bed, service: Ward) -> None:
        if ep in self.waiting.get(ep.specialty, []):
            self.waiting[ep.specialty].remove(ep)
        wait = self.now - ep.arrival
        self.max_wait = max(self.max_wait, wait)
        self.stats["wait_hours_total"] += wait.total_seconds() / 3600

        ep.number = self.registry.next_episode(self.now.year)
        ep.state = "admitted"
        ep.admit_time = self.now
        ep.service = service
        ep.attending = self.pick_doctor(service)
        self._occupy(ep, bed)
        self.stats["admissions"] += 1
        self.events.append(AdtEvent("A01", self.now, ep, bed, service, ep.attending, R_ADMISSION))
        self.plan(ep)

    def plan(self, ep: Episode) -> None:
        cfg = self.spec(ep.specialty)
        if cfg.get("step_down_to"):
            # direct ICU admission: ICU stay, then step-down to a ward (or death)
            icu_stay = self.draw_los(ep.specialty)
            ep.return_specialty = cfg["step_down_to"]
            ep.remaining = self.draw_los(ep.return_specialty, 0.5)
            if self.rng.random() < float(cfg.get("mortality", 0)) * self.age_factor(ep):
                ep.dies = True
                self.schedule_discharge(ep, self.now + icu_stay * self.rng.uniform(0.3, 1.0))
            else:
                self.schedule(self.now + icu_stay, self.on_stepdown, ep)
            return

        los = self.draw_los(ep.specialty, 0.8 if not ep.urgent else 1.0)
        ep.dies = self.rng.random() < float(cfg.get("mortality", 0)) * self.age_factor(ep)
        self.schedule_discharge(ep, self.now + los)

        if not ep.urgent and self.rng.random() < float(cfg.get("icu_postop", 0)):
            self.schedule(self.now + timedelta(hours=self.rng.uniform(4, 10)), self.on_icu_transfer, ep,
                          self.lognormal_days(1.5, 1.0))
        elif self.rng.random() < float(cfg.get("icu_transfer", 0)):
            self.schedule(self.now + los * self.rng.uniform(0.15, 0.5), self.on_icu_transfer, ep,
                          self.draw_los("UCI"))

        consult = cfg.get("consult_transfer")
        if consult and self.rng.random() < float(consult.get("prob", 0)):
            targets = [t for t in consult.get("to", []) if t in self.h.specialties]
            if targets:
                self.schedule(self.now + los * self.rng.uniform(0.1, 0.35), self.on_consult_transfer, ep,
                              self.rng.choice(targets))

        moves = self.poisson(float(cfg.get("intra_ward_moves_per_day", 0)) * los.total_seconds() / 86400)
        for _ in range(moves):
            when = self.now + los * self.rng.uniform(0.1, 0.9)
            when = when.replace(hour=self.rng.randint(8, 21), minute=self.rng.randint(0, 59))
            if when > self.now:
                self.schedule(when, self.on_intra_move, ep)

    def schedule_discharge(self, ep: Episode, target: datetime) -> None:
        ep.discharge_token += 1
        ep.planned_discharge = self.discharge_slot(target, ep.dies)
        self.schedule(ep.planned_discharge, self.on_discharge, ep, ep.discharge_token)

    def on_intra_move(self, ep: Episode) -> None:
        if ep.state != "admitted" or ep.bed is None or ep.bed.is_stretcher or ep.is_outlier:
            return
        if self.spec(ep.specialty).get("step_down_to") or ep.specialty == "UCI":
            return
        ward, room = ep.bed.ward, ep.bed.room
        same_room = [b for b in room.beds if b is not ep.bed and b.is_free(self.now)]
        if same_room and self.rng.random() < 0.3:
            self._move(ep, self.rng.choice(same_room), ep.service, R_BED)
            return
        bed = self.h.find_bed([ward], ep.patient.sex, self.now, self.rng, exclude_room=room)
        if bed is not None:
            self._move(ep, bed, ep.service, R_ROOM)

    def on_icu_transfer(self, ep: Episode, icu_stay: timedelta) -> None:
        if ep.state != "admitted" or ep.specialty == "UCI" or ep.return_specialty:
            return
        icu_wards = self.h.wards_of("UCI")
        bed = self.h.find_bed(icu_wards, ep.patient.sex, self.now, self.rng)
        if bed is None:
            self.stats["icu_full"] += 1
            return
        remaining = max((ep.planned_discharge or self.now) - self.now, DAY)
        ep.discharge_token += 1                      # cancel planned ward discharge
        ep.return_specialty = ep.specialty
        ep.remaining = remaining
        ep.specialty = "UCI"
        self._move(ep, bed, bed.ward, R_ICU)
        if self.rng.random() < float(self.spec("UCI").get("mortality", 0)) * 0.6 * self.age_factor(ep):
            ep.dies = True
            self.schedule_discharge(ep, self.now + icu_stay * self.rng.uniform(0.3, 1.0))
        else:
            ep.dies = False
            self.schedule(self.now + icu_stay, self.on_stepdown, ep)

    def on_stepdown(self, ep: Episode) -> None:
        if ep.state != "admitted" or not ep.return_specialty:
            return
        target = ep.return_specialty
        bed = self.h.find_bed(self.h.wards_of(target), ep.patient.sex, self.now, self.rng)
        service = bed.ward if bed else None
        if bed is None:
            for other in self.spec(target).get("overflow_to", []):
                bed = self.h.find_bed(self.h.wards_of(other), ep.patient.sex, self.now, self.rng)
                if bed is not None:
                    service = self.home_ward(target)
                    self.stats["outlier_stepdowns"] += 1
                    break
        if bed is None or service is None:
            self.stats["icu_blocked_stepdown_hours"] += 4
            self.schedule(self.now + 4 * HOUR, self.on_stepdown, ep)   # waits in ICU for a ward bed
            return
        ep.specialty = target
        ep.return_specialty = None
        self._move(ep, bed, service, R_STEPDOWN)
        ep.dies = self.rng.random() < float(self.spec(target).get("mortality", 0)) * 0.5 * self.age_factor(ep)
        self.schedule_discharge(ep, self.now + (ep.remaining or self.draw_los(target, 0.5)))

    def on_consult_transfer(self, ep: Episode, target: str) -> None:
        if ep.state != "admitted" or ep.return_specialty or ep.specialty in (target, "UCI") or ep.is_outlier:
            return
        bed = self.h.find_bed(self.h.wards_of(target), ep.patient.sex, self.now, self.rng)
        if bed is None:
            self.stats["consult_transfer_no_bed"] += 1
            return
        ep.specialty = target
        self._move(ep, bed, bed.ward, R_SERVICE)
        self.schedule_discharge(ep, self.now + self.draw_los(target, 0.6))

    def on_discharge(self, ep: Episode, token: int) -> None:
        if ep.state != "admitted" or token != ep.discharge_token:
            return
        bed, service = ep.bed, ep.service
        assert bed is not None and service is not None
        if ep.dies:
            ep.disposition = {"code": "20", "text": "FALECIDO"}
            ep.condition = "FALECIDO"
            ep.pool.deceased = True
            self.stats["deaths"] += 1
        else:
            dests = self.flow["discharge_destinations"]
            ep.disposition = self.rng.choices(dests, weights=[d["weight"] for d in dests])[0]
            conditions = self.flow["discharge_conditions"]
            ep.condition = self.rng.choices(list(conditions), weights=list(conditions.values()))[0]
        procs = self.spec(ep.admitting_specialty).get("procedures")
        if procs and (not ep.urgent or self.rng.random() < 0.7):
            ep.procedures = [self.rng.choice(procs)]

        ep.state = "discharged"
        ep.discharge_time = self.now
        self._release(ep)
        self.active.discard(ep.pool.key)
        self.stats["discharges"] += 1
        self.events.append(AdtEvent("A03", self.now, ep, bed, service, ep.attending or self.pick_doctor(service),
                                    R_DEATH if ep.dies else R_DISCHARGE))

        cfg = self.spec(ep.admitting_specialty)
        if not ep.dies and ep.disposition["code"] != "02" and self.rng.random() < float(cfg.get("readmission_30d", 0)):
            delay = min(29.0, self.rng.expovariate(1 / float(self.flow.get("readmission_delay_days_mean", 11))))
            specialty = ep.admitting_specialty if self.rng.random() < 0.7 else "MED"
            if self.spec(specialty).get("step_down_to"):
                specialty = "MED"
            when = self.now + timedelta(days=max(1.0, delay))
            when = when.replace(hour=self.weighted_hour(self.flow["urgent_hour_profile"]))
            if when < self.end:
                self.schedule(when, self.on_arrival, specialty, True, ep.pool, ep.number)

    def on_bed_ready(self, bed: Bed) -> None:
        if bed.occupant is not None or not bed.is_free(self.now):
            return
        self.reallocate(bed.ward)

    def reallocate(self, ward: Ward) -> None:
        """A bed became available: stretcher -> bed, outliers back home, then Urgência queue."""
        while ward.free_beds(self.now) > 0:
            moved = False
            stretcher = [e for e in self._admitted() if e.bed and e.bed.is_stretcher and e.bed.ward is ward]
            outliers = [e for e in self._admitted()
                        if e.is_outlier and e.service and e.service.specialty == ward.specialty
                        and not e.return_specialty]
            for ep in sorted(stretcher, key=lambda e: e.admit_time):
                bed = self.h.find_bed([ward], ep.patient.sex, self.now, self.rng)
                if bed is not None:
                    self._move(ep, bed, ep.service, R_STRETCHER)
                    moved = True
                    break
            if not moved:
                for ep in sorted(outliers, key=lambda e: e.admit_time):
                    bed = self.h.find_bed([ward], ep.patient.sex, self.now, self.rng)
                    if bed is not None:
                        self._move(ep, bed, ward, R_RETURN)
                        moved = True
                        break
            if not moved:
                for ep in list(self.waiting.get(ward.specialty, [])):
                    bed = self.h.find_bed([ward], ep.patient.sex, self.now, self.rng)
                    if bed is not None:
                        self.admit(ep, bed, ward)
                        moved = True
                        break
            if not moved:
                return

    def on_sample(self) -> None:
        if self.now >= self.start:
            for w in self.h.wards:
                self.occupancy_samples[w.code].append(w.occupied() / max(1, w.capacity))
            self.stats["stretcher_patient_hours"] += sum(
                1 for w in self.h.wards for b in w.stretchers if b.occupant is not None
            )
            self.stats["outlier_patient_hours"] += sum(1 for e in self._admitted() if e.is_outlier)
        nxt = self.now + HOUR
        if nxt <= self.end:
            self.schedule(nxt, self.on_sample)

    def on_snapshot(self) -> None:
        self.census_snapshot = [(e, e.bed, e.service, e.attending) for e in self._admitted()]

    # ================================================================== state changes
    def _admitted(self) -> list[Episode]:
        return [e for e in self.episodes if e.state == "admitted"]

    def _occupy(self, ep: Episode, bed: Bed) -> None:
        if bed.occupant is not None:
            raise AssertionError(f"bed {bed.key} already occupied")
        bed.occupant = ep
        ep.bed = bed
        ep.movements.append(Movement(self.now, bed, ep.service))  # type: ignore[arg-type]

    def _release(self, ep: Episode) -> None:
        bed = ep.bed
        if bed is None:
            return
        bed.occupant = None
        bed.blocked_until = self.now + timedelta(minutes=self.rng.randint(*self.turnaround))
        ep.bed = None
        if ep.movements:
            ep.movements[-1].end = self.now
        self.schedule(bed.blocked_until, self.on_bed_ready, bed)

    def _move(self, ep: Episode, new_bed: Bed, service: Ward, reason: tuple[str, str, str]) -> None:
        prior_bed, prior_service = ep.bed, ep.service
        self._release(ep)
        if service is not prior_service:
            ep.attending = self.pick_doctor(service)
        ep.service = service
        self._occupy(ep, new_bed)
        self.stats[f"transfer_{reason[0]}"] += 1
        self.events.append(AdtEvent("A02", self.now, ep, new_bed, service, ep.attending,  # type: ignore[arg-type]
                                    reason, prior_bed, prior_service))

    # ================================================================== run
    def run(self) -> SimulationResult:
        self.schedule_arrivals()
        self.schedule(self.start - timedelta(microseconds=1), self.on_snapshot)
        self.schedule(self.start, self.on_sample)
        while self._heap:
            when, _, handler, args = heapq.heappop(self._heap)
            if when > self.end:
                break
            self.now = when
            handler(*args)
        self.now = self.end

        stats = dict(self.stats)
        stats["max_emergency_wait_hours"] = round(self.max_wait.total_seconds() / 3600, 1)
        stats["avg_emergency_wait_hours"] = round(stats.pop("wait_hours_total", 0) / max(1, stats.get("admissions", 1)), 2)
        stats["still_waiting_in_emergency"] = sum(len(v) for v in self.waiting.values())
        stats["occupancy_by_ward"] = {
            code: round(sum(v) / len(v), 3) for code, v in self.occupancy_samples.items() if v
        }
        return SimulationResult(self.events, self.episodes, self.start, self.end, stats, self.doctors, self.operators,
                                self.census_snapshot)


def output_events(result: SimulationResult, mode: str) -> list[AdtEvent]:
    """Apply the warm-up output policy ('full' or 'census')."""
    events = sorted(result.events, key=lambda e: e.occurred)
    if mode == "full":
        return events
    # census: one synthetic A01 per patient in a bed at `start`, then post-start events
    census = [
        AdtEvent("A01", result.start, ep, bed, service, attending, R_CENSUS, census=True)
        for ep, bed, service, attending in result.census
    ]
    return census + [e for e in events if e.occurred >= result.start]


def episode_reference_day(ep: Episode) -> date:
    return (ep.admit_time or ep.arrival).date()
