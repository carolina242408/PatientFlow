"""FastAPI REST API server for PatientFlow Synthetic Data Generator.

Provides endpoints for backend integration:
- Data Generation triggers (POST /api/generate)
- HL7 message queries & pagination (GET /api/hl7/messages, GET /api/hl7/messages/{id})
- Raw HL7 message stream (GET /api/hl7/stream)
- Server-Sent Events live stream (GET /api/hl7/live)
- FHIR resources (GET /api/fhir/hospital-locations, GET /api/fhir/patients/{ns})
- Webhook Subscriptions (POST/GET/DELETE /api/subscriptions)
- Subscription Dispatch / Replay (POST /api/subscriptions/dispatch)
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import (
    BackgroundTasks,
    Body,
    FastAPI,
    HTTPException,
    Query,
    Request,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    JSONResponse,
    PlainTextResponse,
    Response,
    StreamingResponse,
)
from pydantic import BaseModel, Field
from ui.app import router as ui_router

from .clinical import Diagnosis
from .hl7 import HL7Builder, RenderedMessage, render_all
from .hospital import Bed, Hospital
from .identity import IdentityRegistry
from .publisher import build_dataset_csv, dispatch_to_subscribers, write_file_outputs
from .simulation import (
    AdtEvent,
    Episode,
    Movement,
    R_ADMISSION,
    R_BED,
    R_DISCHARGE,
    R_ICU,
    R_ROOM,
    R_SERVICE,
    R_STEPDOWN,
    Simulation,
    output_events,
)
from .synthea import PoolPatient, load_pool, run_synthea, synthetic_pool
from .validate import validate_messages

logger = logging.getLogger("pfgen.api")

BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_HOSPITAL_CONFIG = BASE_DIR / "config" / "hospital.yaml"
DEFAULT_SIMULATION_CONFIG = BASE_DIR / "config" / "simulation.yaml"
CACHE_DIR = BASE_DIR / ".cache" / "synthea"
OUTPUT_DIR = BASE_DIR / "output"

app = FastAPI(
    title="PatientFlow Synthetic Data API",
    description="REST API for generating and consuming synthetic Portuguese hospital patient flow data (HL7 v2.5 ADT + FHIR R4).",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ui_router)


class LiveFlowEngine:
    """Continuous stateful real-time hospital patient flow simulator.

    Maintains the live state of hospital beds and admitted episodes so that
    `next_message()` continuously generates a realistic stream of:
    - A01 (Admission: patient occupies an available bed)
    - A02 (Transfer: admitted patient moves to another available bed/room/ward)
    - A03 (Discharge: admitted patient leaves the hospital, freeing their bed)
    """

    def __init__(self, output_dir: Path) -> None:
        import yaml

        self.output_dir = output_dir
        with open(DEFAULT_HOSPITAL_CONFIG, "r", encoding="utf-8") as f:
            self.hosp_cfg = yaml.safe_load(f)
        with open(DEFAULT_SIMULATION_CONFIG, "r", encoding="utf-8") as f:
            self.sim_cfg = yaml.safe_load(f)

        self.rng = random.Random()
        self.hospital = Hospital(self.hosp_cfg)
        self.all_beds: list[Bed] = [
            b for w in self.hospital.wards for r in w.rooms for b in r.beds
        ]
        self.admitted: list[Episode] = []
        self.registry_path = self.output_dir / "identity-registry.json"
        self.registry = self._load_registry()

        self.doctors = {
            w.code: [
                self.registry.create_staff(w.code, doctor=True)
                for _ in range(4)
            ]
            for w in self.hospital.wards
        }
        self.operators = [
            self.registry.create_staff(None, doctor=False) for _ in range(6)
        ]
        self.builder = HL7Builder(self.hospital, self.sim_cfg["hl7"], self.rng)
        self.now = max(
            datetime.now().replace(microsecond=0),
            datetime(2026, 10, 15, 8, 0, 0),
        )
        self.pool: list[PoolPatient] = []
        self._last_trigger: str | None = None

    def _load_registry(self) -> IdentityRegistry:
        return IdentityRegistry.load(
            self.registry_path,
            rng=self.rng,
            ns_start=int(self.sim_cfg["identity"].get("ns_start", 1200000)),
            processo_start=int(
                self.sim_cfg["identity"].get("processo_start", 15000000)
            ),
            homonym_rate=float(
                self.sim_cfg["identity"].get("homonym_rate", 0.03)
            ),
            homonym_same_birthdate_rate=float(
                self.sim_cfg["identity"].get(
                    "homonym_same_birthdate_rate", 0.25
                )
            ),
            email_rate=float(self.sim_cfg["identity"].get("email_rate", 0.4)),
        )

    def _sync_registry_from_disk(self) -> None:
        if self.registry_path.exists():
            try:
                disk_data = json.loads(
                    self.registry_path.read_text(encoding="utf-8")
                )
                self.registry.used_ns.update(disk_data.get("ns", []))
                self.registry.used_sns.update(disk_data.get("sns", []))
                self.registry.used_nif.update(disk_data.get("nif", []))
                self.registry.used_processo.update(
                    disk_data.get("processo", [])
                )
                for yy, seq in disk_data.get("episode_seq", {}).items():
                    self.registry.episode_seq[yy] = max(
                        self.registry.episode_seq.get(yy, 0), int(seq)
                    )
                if self.registry.used_ns:
                    self.registry._next_ns = max(
                        self.registry._next_ns,
                        max(int(v) for v in self.registry.used_ns) + 1,
                    )
                if self.registry.used_processo:
                    self.registry._next_processo = max(
                        self.registry._next_processo,
                        max(int(v) for v in self.registry.used_processo) + 1,
                    )
            except Exception as e:
                logger.debug("Could not sync identity registry: %s", e)

    def _next_pool_patient(self) -> PoolPatient:
        if not self.pool:
            self.pool = synthetic_pool(
                size=40,
                rng=self.rng,
                reference=self.now,
                min_age=int(self.sim_cfg["synthea"].get("min_age", 18)),
                max_age=int(self.sim_cfg["synthea"].get("max_age", 95)),
            )
        p = self.pool.pop()
        p.key = f"{p.key}_{uuid.uuid4().hex[:8]}"
        return p

    def _create_admission_episode(self, bed: Bed, admit_time: datetime) -> Episode:
        self._sync_registry_from_disk()
        ward = bed.ward
        p = self._next_pool_patient()
        identity = self.registry.create(
            p.key, p.sex, p.birth_date, admit_time.date()
        )
        ep_num = self.registry.next_episode(admit_time.year)
        self.registry.save(self.registry_path)

        spec_cfg = self.sim_cfg["specialties"].get(
            ward.specialty, self.sim_cfg["specialties"]["MED"]
        )
        fb = self.rng.choice(spec_cfg["fallback_diagnoses"])
        diag = Diagnosis(fb["icd10"], fb["text"], "ICD10", source="config")
        attending = self.rng.choice(self.doctors[ward.code])
        urgent = self.rng.random() < 0.75
        ep = Episode(
            patient=identity,
            pool=p,
            specialty=ward.specialty,
            admitting_specialty=ward.specialty,
            diagnosis=diag,
            urgent=urgent,
            arrival=admit_time - timedelta(minutes=self.rng.randint(10, 60)),
            number=ep_num,
            state="admitted",
            admit_time=admit_time,
            bed=bed,
            service=ward,
            attending=attending,
        )
        bed.occupant = ep
        ep.movements.append(Movement(admit_time, bed, ward))
        self.admitted.append(ep)
        return ep

    def next_message(
        self,
        trigger_filter: str | None = None,
        highest_batch_time: datetime | None = None,
    ) -> RenderedMessage:
        # Advance clinical clock monotonically so A01 < A02 < A03 for every episode
        step_delta = timedelta(
            minutes=self.rng.randint(15, 40), seconds=self.rng.randint(1, 59)
        )
        candidate_now = max(
            datetime.now().replace(microsecond=0),
            self.now + step_delta,
        )
        if highest_batch_time and candidate_now <= highest_batch_time:
            candidate_now = highest_batch_time + step_delta
        self.now = candidate_now

        free_beds = [b for b in self.all_beds if b.occupant is None]
        occ = len(self.admitted)
        cap = len(self.all_beds)

        if trigger_filter == "A01":
            if not free_beds and self.admitted:
                oldest = self.admitted.pop(0)
                if oldest.bed is not None:
                    oldest.bed.occupant = None
                free_beds = [b for b in self.all_beds if b.occupant is None]
            action = "A01"
        elif trigger_filter == "A02":
            if not self.admitted:
                target_bed = self.rng.choice(free_beds or self.all_beds)
                self._create_admission_episode(
                    target_bed, self.now - timedelta(hours=2)
                )
                free_beds = [b for b in self.all_beds if b.occupant is None]
            if not free_beds and len(self.admitted) > 1:
                released = self.admitted.pop(0)
                if released.bed is not None:
                    released.bed.occupant = None
                free_beds = [b for b in self.all_beds if b.occupant is None]
            action = "A02"
        elif trigger_filter == "A03":
            if not self.admitted:
                target_bed = self.rng.choice(free_beds or self.all_beds)
                self._create_admission_episode(
                    target_bed, self.now - timedelta(hours=6)
                )
            action = "A03"
        else:
            # Continuous balanced patient flow: beds fill up (A01), patients move (A02), and patients discharge (A03)
            if occ == 0:
                action = "A01"
            elif not free_beds or occ >= cap:
                action = "A03"
            elif occ <= 2:
                action = self.rng.choices(
                    ["A01", "A02", "A03"], weights=[0.70, 0.15, 0.15]
                )[0]
            elif occ <= 6:
                # Encourage variety so A01, A02, and A03 all occur regularly
                if self._last_trigger == "A01":
                    weights = [0.25, 0.35, 0.40]
                elif self._last_trigger == "A02":
                    weights = [0.40, 0.15, 0.45]
                else:
                    weights = [0.50, 0.30, 0.20]
                action = self.rng.choices(["A01", "A02", "A03"], weights=weights)[0]
            else:
                action = self.rng.choices(
                    ["A01", "A02", "A03"], weights=[0.20, 0.30, 0.50]
                )[0]

        self._last_trigger = action

        if action == "A01":
            bed = self.rng.choice(free_beds)
            ep = self._create_admission_episode(bed, self.now)
            ev = AdtEvent(
                "A01", self.now, ep, bed, bed.ward, ep.attending, R_ADMISSION
            )

        elif action == "A02":
            ep = self.rng.choice(self.admitted)
            prior_bed = ep.bed
            prior_service = ep.service
            candidates = [
                b
                for b in self.all_beds
                if b.occupant is None and b is not prior_bed
            ]
            if not candidates:
                candidates = [b for b in self.all_beds if b is not prior_bed]
            new_bed = self.rng.choice(candidates)
            new_ward = new_bed.ward

            if prior_bed is not None:
                prior_bed.occupant = None
            if ep.movements:
                ep.movements[-1].end = self.now

            new_bed.occupant = ep
            ep.bed = new_bed
            ep.service = new_ward
            ep.specialty = new_ward.specialty

            if new_ward is prior_service:
                reason = (
                    R_BED
                    if (prior_bed and new_bed.room is prior_bed.room)
                    else R_ROOM
                )
            elif new_ward.specialty == "UCI":
                reason = R_ICU
                ep.attending = self.rng.choice(self.doctors[new_ward.code])
            elif prior_service and prior_service.specialty == "UCI":
                reason = R_STEPDOWN
                ep.attending = self.rng.choice(self.doctors[new_ward.code])
            else:
                reason = R_SERVICE
                ep.attending = self.rng.choice(self.doctors[new_ward.code])

            ep.movements.append(Movement(self.now, new_bed, new_ward))
            ev = AdtEvent(
                "A02",
                self.now,
                ep,
                new_bed,
                new_ward,
                ep.attending,
                reason,
                prior_bed=prior_bed,
                prior_service=prior_service,
            )

        else:  # A03 Discharge
            # Pick from the longest-staying half of admitted patients
            idx = self.rng.randint(0, max(0, (len(self.admitted) - 1) // 2))
            ep = self.admitted.pop(idx)
            bed = ep.bed or self.all_beds[0]
            service = ep.service or bed.ward
            if ep.bed is not None:
                ep.bed.occupant = None
            ep.bed = None
            ep.state = "discharged"
            ep.discharge_time = self.now
            if ep.movements:
                ep.movements[-1].end = self.now

            dests = self.sim_cfg["flow"]["discharge_destinations"]
            ep.disposition = self.rng.choices(
                dests, weights=[d["weight"] for d in dests]
            )[0]
            conditions = self.sim_cfg["flow"]["discharge_conditions"]
            ep.condition = self.rng.choices(
                list(conditions), weights=list(conditions.values())
            )[0]
            ev = AdtEvent(
                "A03",
                self.now,
                ep,
                bed,
                service,
                ep.attending or self.rng.choice(self.doctors[service.code]),
                R_DISCHARGE,
            )

        recorded = self.now + timedelta(seconds=self.rng.randint(2, 15))
        msh_time = recorded + timedelta(seconds=self.rng.randint(1, 5))
        self.now = msh_time
        return self.builder.build(
            ev, msh_time, recorded, self.rng.choice(self.operators)
        )


# In-memory store for active simulation state and subscriptions
class State:
    def __init__(self) -> None:
        self.messages: list[RenderedMessage] = []
        self.by_id: dict[str, RenderedMessage] = {}
        self.summary: dict[str, Any] = {}
        self.subscribers: dict[str, dict[str, Any]] = {}
        self.output_dir: Path = OUTPUT_DIR
        self.generation_version: int = 0
        self.live_engine: LiveFlowEngine = LiveFlowEngine(OUTPUT_DIR)
        self.live_stream_active: bool = False
        self.passive_queues: set[asyncio.Queue[RenderedMessage]] = set()

    def broadcast_to_passive(self, messages: list[RenderedMessage]) -> None:
        for q in list(self.passive_queues):
            for m in messages:
                try:
                    q.put_nowait(m)
                except Exception:
                    pass

    def load_from_disk(self) -> None:
        summary_file = self.output_dir / "summary.json"
        if summary_file.exists():
            try:
                self.summary = json.loads(summary_file.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning("Could not read summary.json: %s", e)


state = State()


# -----------------------------------------------------------------------------
# Request/Response Models
# -----------------------------------------------------------------------------
class GenerateRequest(BaseModel):
    days: int = Field(default=7, ge=1, le=365, description="Number of simulation days")
    warmup_days: int = Field(
        default=3, ge=0, le=60, description="Warmup days prior to start"
    )
    seed: int = Field(default=42, description="Random seed")
    population: str = Field(
        default="20", description="Synthea population size ('auto' or integer)"
    )
    no_synthea: bool = Field(
        default=True, description="Fast lightweight mode (bypass Synthea)"
    )
    warmup_output: str = Field(default="census", description="'census' or 'full'")
    run_validation: bool = Field(
        default=True, alias="validate", description="Run HL7 integrity validator"
    )
    run_validation: bool = Field(default=True, alias="validate", description="Run HL7 integrity validator")
    push_to_hapi: bool = Field(default=True, description="Push generated FHIR bundles to HAPI FHIR server")


class SubscriptionCreate(BaseModel):
    url: str = Field(
        ...,
        description="Callback webhook URL (e.g. http://localhost:8080/api/hl7/events)",
    )
    triggers: list[str] | None = Field(
        default=None, description="Optional trigger filter (e.g. ['A01', 'A02', 'A03'])"
    )
    format: str = Field(default="json", description="Payload format: 'json' or 'hl7'")
    auto_stream: bool = Field(
        default=False,
        description="Immediately start streaming lightweight HL7 events in the background to this subscriber",
    )
    delay_ms: int = Field(
        default=250,
        ge=0,
        le=10000,
        description="Inter-message delay in ms when auto_stream=True",
    )


class SubscriptionResponse(BaseModel):
    id: str
    url: str
    triggers: list[str] | None
    format: str
    auto_stream: bool = False
    delay_ms: int = 250
    created_at: str


class DispatchRequest(BaseModel):
    delay_ms: int = Field(
        default=0,
        ge=0,
        le=10000,
        description="Inter-message delay in ms for simulated live replay",
    )
    triggers: list[str] | None = Field(
        default=None, description="Filter specific triggers to dispatch"
    )


# -----------------------------------------------------------------------------
# Core generation helper
# -----------------------------------------------------------------------------
def run_generator(
    days: int,
    warmup_days: int,
    seed: int,
    population_arg: str,
    no_synthea: bool,
    warmup_output: str,
    validate: bool,
    push_to_hapi: bool = True,
    write_files: bool = True,
) -> dict[str, Any]:
    import yaml

    with open(DEFAULT_HOSPITAL_CONFIG, "r", encoding="utf-8") as f:
        hosp_cfg = yaml.safe_load(f)
    with open(DEFAULT_SIMULATION_CONFIG, "r", encoding="utf-8") as f:
        sim_cfg = yaml.safe_load(f)

    sim_cfg["simulation"]["days"] = days
    sim_cfg["simulation"]["warmup_days"] = warmup_days
    sim_cfg["simulation"]["seed"] = seed
    sim_cfg["simulation"]["warmup_output"] = warmup_output

    rng = random.Random(seed)
    hospital = Hospital(hosp_cfg)

    registry_path = state.output_dir / "identity-registry.json"
    registry = IdentityRegistry.load(
        registry_path,
        rng=rng,
        ns_start=int(sim_cfg["identity"].get("ns_start", 1200000)),
        processo_start=int(sim_cfg["identity"].get("processo_start", 15000000)),
        homonym_rate=float(sim_cfg["identity"].get("homonym_rate", 0.03)),
        homonym_same_birthdate_rate=float(
            sim_cfg["identity"].get("homonym_same_birthdate_rate", 0.25)
        ),
        email_rate=float(sim_cfg["identity"].get("email_rate", 0.4)),
    )

    sim_start = datetime.fromisoformat(sim_cfg["simulation"]["start"])
    total_days = float(days) + float(warmup_days)

    if population_arg == "auto":
        expected_adm = 0.0
        for s in hospital.specialties:
            spec_cfg = sim_cfg["specialties"].get(s, sim_cfg["specialties"]["MED"])
            if "admissions_per_day" in spec_cfg:
                rate = float(spec_cfg["admissions_per_day"])
            else:
                cap = hospital.capacity_of(s)
                rate = (
                    cap
                    * float(spec_cfg.get("target_occupancy", 0.85))
                    / float(spec_cfg["los"]["mean"])
                )
            expected_adm += rate * total_days
        population_size = max(20, int(expected_adm * 1.35))
    else:
        population_size = int(population_arg)

    if no_synthea:
        pool = synthetic_pool(
            size=population_size,
            rng=rng,
            reference=sim_start,
            min_age=int(sim_cfg["synthea"].get("min_age", 18)),
            max_age=int(sim_cfg["synthea"].get("max_age", 95)),
        )
    else:
        try:
            fhir_dir = run_synthea(
                cache_dir=CACHE_DIR,
                jar_url=sim_cfg["synthea"]["jar_url"],
                population=population_size,
                seed=seed,
                min_age=int(sim_cfg["synthea"].get("min_age", 18)),
                max_age=int(sim_cfg["synthea"].get("max_age", 95)),
                years_of_history=int(sim_cfg["synthea"].get("years_of_history", 2)),
                reference_date=sim_start.date(),
                state=sim_cfg["synthea"].get("state", "Massachusetts"),
            )
            pool = load_pool(fhir_dir, hospital.specialties)
        except Exception as e:
            logger.warning("Synthea failed (%s), falling back to synthetic pool", e)
            pool = synthetic_pool(
                size=population_size,
                rng=rng,
                reference=sim_start,
                min_age=int(sim_cfg["synthea"].get("min_age", 18)),
                max_age=int(sim_cfg["synthea"].get("max_age", 95)),
            )

    sim = Simulation(hospital, sim_cfg, pool, registry, rng)
    sim_result = sim.run()
    active_events = output_events(sim_result, warmup_output)

    builder = HL7Builder(hospital, sim_cfg["hl7"], rng)
    max_clean = int(sim_cfg["flow"].get("bed_turnaround_minutes", [45, 120])[0])
    delay_range = tuple(sim_cfg["flow"].get("registration_delay_minutes", [0, 20]))

    messages = render_all(
        events=active_events,
        builder=builder,
        operators=sim_result.operators,
        delay_range=delay_range,
        max_delay_minutes=max_clean - 5,
        rng=rng,
    )

    validation_report = None
    if validate and write_files:
        raw_texts = [m.text for m in messages]
        validation_report = validate_messages(raw_texts, check_converter=False)

    summary = {}
    if write_files:
        summary = write_file_outputs(
            output_dir=state.output_dir,
            rendered_messages=messages,
            sim_result=sim_result,
            hospital=hospital,
            registry=registry,
            pool_patients=pool,
            drop_fhir_types=set(sim_cfg["fhir"].get("drop_resource_types", [])),
            pretty_fhir=bool(sim_cfg["fhir"].get("pretty", False)),
            validation_report=validation_report,
            push_to_hapi=push_to_hapi,
        )
    else:
        summary = {
            "simulation": {
                "start": sim_result.start.isoformat(),
                "end": sim_result.end.isoformat(),
                "total_episodes": len(sim_result.episodes),
                "total_messages": len(messages),
            }
        }

    state.episodes = sim_result.episodes
    state.messages = messages
    state.by_id = {m.control_id: m for m in messages}
    state.summary = summary
    state.generation_version += 1
    if push_to_hapi and write_files:
        state.broadcast_to_passive(messages)
    return summary


def ensure_light_stream(seed: int | None = None) -> list[RenderedMessage]:
    """Ensure lightweight patient flow messages (20 patients, 10 beds, no Synthea) are ready in memory."""
    if state.messages and seed is None:
        return state.messages

    import yaml

    with open(DEFAULT_SIMULATION_CONFIG, "r", encoding="utf-8") as f:
        sim_cfg = yaml.safe_load(f)

    run_generator(
        days=int(sim_cfg["simulation"].get("days", 7)),
        warmup_days=int(sim_cfg["simulation"].get("warmup_days", 3)),
        seed=seed if seed is not None else int(sim_cfg["simulation"].get("seed", 42)),
        population_arg=str(sim_cfg["synthea"].get("population", "20")),
        no_synthea=True,
        warmup_output=str(sim_cfg["simulation"].get("warmup_output", "census")),
        validate=True,
        push_to_hapi=True,
    )
    return state.messages


# -----------------------------------------------------------------------------
# Endpoints: System & Health
# -----------------------------------------------------------------------------
@app.on_event("startup")
def startup_event() -> None:
    """Start in idle mode without auto-generating data; wait for explicit POST /api/generate."""
    logger.info("Data Generator started in idle mode (waiting for POST /api/generate)")


@app.get("/", tags=["Info"])
def get_root():
    return {
        "service": "PatientFlow Synthetic Data REST API",
        "version": "1.0.0",
        "ui": "/ui",
        "docs": "/docs",
        "total_messages_loaded": len(state.messages),
        "endpoints": {
            "generate": "POST /api/generate",
            "summary": "GET /api/simulation/summary",
            "messages": "GET /api/hl7/messages",
            "message_by_id": "GET /api/hl7/messages/{control_id}",
            "stream": "GET /api/hl7/stream",
            "live_stream": "GET /api/hl7/live (SSE)",
            "hospital_fhir": "GET /api/fhir/hospital-locations",
            "patients_fhir": "GET /api/fhir/patients/{ns}",
            "subscriptions": "POST /api/subscriptions",
            "dataset_csv": "GET /api/csv",
            "generate_csv": "POST /api/csv/generate",
        },
    }


@app.get("/health", tags=["Info"])
def get_health():
    return {
        "status": "ok",
        "messages_in_memory": len(state.messages),
        "subscriptions_count": len(state.subscribers),
        "has_summary": bool(state.summary),
    }


# -----------------------------------------------------------------------------
# Endpoints: Data Generation
# -----------------------------------------------------------------------------
@app.post("/api/generate", tags=["Generation"])
def generate_data(req: GenerateRequest = Body(...)):
    """Trigger a synthetic data generation run."""
    try:
        summary = run_generator(
            days=req.days,
            warmup_days=req.warmup_days,
            seed=req.seed,
            population_arg=req.population,
            no_synthea=req.no_synthea,
            warmup_output=req.warmup_output,
            validate=req.run_validation,
            push_to_hapi=req.push_to_hapi,
        )
        return summary
    except Exception as e:
        logger.exception("Generation error")
        raise HTTPException(status_code=500, detail=f"Generation failed: {e}") from e


@app.post("/api/csv/generate", tags=["Dataset"])
def generate_csv_file(
    days: int = Query(default=180, ge=1, le=1000, description="Dias por simulação"),
    population: str = Query(default="auto", description="Tamanho da população ou 'auto'"),
    runs: int = Query(default=1, ge=1, le=80, description="Número de vezes a rodar a simulação para acumular dados"),
    base_seed: int = Query(default=42, description="Seed inicial de aleatoriedade"),
    push_to_hapi: bool = Query(default=False, description="Enviar bundles FHIR para o servidor HAPI durante a geração do CSV"),
):
    """Gera o dataset CSV rodando a simulação N vezes com seeds diferentes e acumula os dados."""
    all_episodes = []

    for i in range(runs):
        current_seed = base_seed + i  
        
        # CHAMA O GERADOR MAS DIZ-LHE PARA NÃO ESCREVER OS FICHEIROS HL7/FHIR (write_files=False)
        run_generator(
            days=days,
            warmup_days=7,
            seed=current_seed,
            population_arg=population,
            no_synthea=True,
            warmup_output="census",
            validate=False,
            push_to_hapi=push_to_hapi,
            write_files=False, 
        )
        
        # Acumula os episódios gerados nesta iteração
        if hasattr(state, "episodes") and state.episodes:
            all_episodes.extend(state.episodes)

    # Usa o publisher para construir a string CSV com todos os episódios acumulados
    csv_content = build_dataset_csv(all_episodes)
    
    # Guarda o ficheiro final dataset.csv na pasta output/
    csv_file = state.output_dir / "dataset.csv"
    csv_file.parent.mkdir(parents=True, exist_ok=True)
    csv_file.write_text(csv_content, encoding="utf-8")
    
    lines = [line for line in csv_content.strip().splitlines() if line]
    lines_count = max(0, len(lines) - 1)
    
    logger.info("Dataset CSV escrito em %s (%d linhas totais em %d execuções)", csv_file, lines_count, runs)

    return {
        "status": "ok",
        "message": f"Dataset CSV gerado com sucesso em {csv_file.name} ({runs} execuções)",
        "file": str(csv_file),
        "relative_path": "output/dataset.csv",
        "runs": runs,
        "rows": lines_count,
        "columns": ["gender", "specialty", "diagnosis code", "birthdate", "admission date", "discharge date"],
    }


@app.get("/api/csv", tags=["Dataset"])
@app.get("/api/dataset/csv", tags=["Dataset"])
def get_dataset_csv():
    """Retrieve the generated dataset.csv from output directory."""
    csv_file = state.output_dir / "dataset.csv"
    if not csv_file.exists():
        raise HTTPException(
            status_code=404,
            detail="Dataset CSV not found. Call POST /api/csv/generate first.",
        )
    return Response(
        content=csv_file.read_text(encoding="utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="dataset.csv"'},
    )



@app.get("/api/simulation/summary", tags=["Simulation"])
def get_simulation_summary():
    """Retrieve summary of the generated simulation."""
    if not state.summary:
        state.load_from_disk()
    if not state.summary:
        raise HTTPException(
            status_code=404,
            detail="No simulation run found. Call POST /api/generate first.",
        )
    return state.summary


# -----------------------------------------------------------------------------
# Endpoints: HL7 Messages (REST Pull)
# -----------------------------------------------------------------------------
@app.get("/api/hl7/messages", tags=["HL7"])
def list_hl7_messages(
    limit: int = Query(default=50, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    trigger: str | None = Query(default=None, pattern="^(A01|A02|A03)$"),
    episode: str | None = None,
    ns: str | None = None,
    since: str | None = None,
):
    """Query and paginate generated HL7 v2.5 messages."""
    items = ensure_light_stream()

    filtered = items
    if trigger:
        filtered = [m for m in filtered if m.trigger == trigger]
    if episode:
        filtered = [m for m in filtered if m.episode == episode]
    if ns:
        filtered = [m for m in filtered if m.ns == ns]
    if since:
        try:
            since_dt = datetime.fromisoformat(since)
            filtered = [m for m in filtered if m.msh_time >= since_dt]
        except ValueError:
            raise HTTPException(
                status_code=400, detail="Invalid ISO datetime format for 'since'"
            )

    total = len(filtered)
    page = filtered[offset : offset + limit]

    result = [
        {
            "control_id": m.control_id,
            "trigger": m.trigger,
            "episode": m.episode,
            "ns": m.ns,
            "processo": m.processo,
            "occurred": m.occurred.isoformat(),
            "msh_time": m.msh_time.isoformat(),
            "hl7": m.text,
        }
        for m in page
    ]
    return {"total": total, "limit": limit, "offset": offset, "messages": result}


@app.get("/api/hl7/messages/{control_id}", tags=["HL7"])
def get_hl7_message(control_id: str, request: Request):
    """Retrieve a single HL7 message by MSH-10 UUID."""
    msg = state.by_id.get(control_id)
    if not msg:
        # Check files on disk
        matches = list((state.output_dir / "hl7").glob(f"*_{control_id[:8]}*.hl7"))
        if matches:
            text = matches[0].read_text(encoding="utf-8")
            if "text/plain" in request.headers.get("accept", ""):
                return PlainTextResponse(text)
            return {
                "control_id": control_id,
                "hl7": text,
            }
        raise HTTPException(
            status_code=404, detail=f"Message with control_id {control_id} not found"
        )

    if "text/plain" in request.headers.get("accept", ""):
        return PlainTextResponse(msg.text)

    return {
        "control_id": msg.control_id,
        "trigger": msg.trigger,
        "episode": msg.episode,
        "ns": msg.ns,
        "processo": msg.processo,
        "occurred": msg.occurred.isoformat(),
        "msh_time": msg.msh_time.isoformat(),
        "hl7": msg.text,
    }


@app.get("/api/hl7/stream", tags=["HL7"])
def get_hl7_stream():
    """Download the full sequential HL7 v2.5 stream."""
    stream_file = state.output_dir / "stream.hl7"
    if not stream_file.exists():
        messages = ensure_light_stream()
        content = "".join(m.text for m in messages)
        return PlainTextResponse(content)
    return PlainTextResponse(stream_file.read_text(encoding="utf-8"))


def _serialize_message_sse(msg: RenderedMessage) -> str:
    event_data = json.dumps(
        {
            "control_id": msg.control_id,
            "trigger": msg.trigger,
            "episode": msg.episode,
            "ns": msg.ns,
            "processo": msg.processo,
            "occurred": msg.occurred.isoformat(),
            "msh_time": msg.msh_time.isoformat(),
            "hl7": msg.text,
        }
    )
    return f"event: hl7_{msg.trigger.lower()}\ndata: {event_data}\n\n"


@app.post("/api/hl7/live/stop", tags=["HL7"])
def stop_live_hl7_stream():
    """Stop the active continuous real-time HL7 stream loop."""
    state.live_stream_active = False
    for q in list(state.passive_queues):
        while not q.empty():
            try:
                q.get_nowait()
            except Exception:
                break
    return {"status": "stopped"}


@app.get("/api/hl7/live", tags=["HL7"])
async def live_hl7_stream(
    request: Request,
    delay_ms: int = Query(
        default=1000, ge=10, le=10000, description="Delay between events in ms"
    ),
    trigger: str | None = Query(default=None, pattern="^(A01|A02|A03)$"),
    loop: bool = Query(
        default=True,
        description="Continuously generate real-time patient flow events (A01, A02, A03) until stopped",
    ),
    limit: int | None = Query(
        default=None,
        ge=1,
        le=500,
        description="Optional maximum number of events to stream (None = unlimited in loop mode)",
    ),
    auto_generate: bool = Query(
        default=False,
        description="Actively drive the real-time patient flow generator",
    ),
):
    """Server-Sent Events (SSE) stream of real-time HL7 patient flow messages.

    - Passive backend subscribers (e.g. Spring Boot `ApiStreamSubscriber` connecting at startup
      with `loop=true` and `auto_generate=false`) listen on a shared broadcast queue and receive
      every event generated by the live stream or batch generator.
    - Active stream callers (UI `EventSource`, `curl`, or `auto_generate=true`) drive the
      continuous stateful `LiveFlowEngine`, generating real-time admissions (`A01`), transfers (`A02`),
      and discharges (`A03`) forever (when `loop=true` and `limit=None`) until stopped, while
      simultaneously broadcasting each event to all passive backend subscribers.
    """
    user_agent = request.headers.get("user-agent", "").lower()
    is_passive_subscriber = (
        not auto_generate and "java-http-client" in user_agent
    )

    sse_headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }

    if is_passive_subscriber:
        queue: asyncio.Queue[RenderedMessage] = asyncio.Queue()
        state.passive_queues.add(queue)

        async def passive_event_generator() -> AsyncGenerator[str, None]:
            sent = 0
            try:
                yield ": connected\n\n"
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        msg = await asyncio.wait_for(queue.get(), timeout=15.0)
                    except asyncio.TimeoutError:
                        yield ": keepalive\n\n"
                        continue

                    if trigger and msg.trigger != trigger:
                        continue

                    yield _serialize_message_sse(msg)
                    sent += 1
                    if limit is not None and sent >= limit:
                        return
            finally:
                state.passive_queues.discard(queue)

        return StreamingResponse(
            passive_event_generator(),
            media_type="text/event-stream",
            headers=sse_headers,
        )

    # Active stream (UI Control Panel or direct CLI stream): drive continuous real-time hospital flow
    state.live_stream_active = True

    async def active_event_generator() -> AsyncGenerator[str, None]:
        sent = 0
        highest_batch_time = max(
            (m.msh_time for m in state.messages), default=None
        )
        max_events = limit if limit is not None else (None if loop else 10)

        try:
            yield ": connected\n\n"
            while state.live_stream_active:
                if await request.is_disconnected():
                    break

                msg = state.live_engine.next_message(
                    trigger_filter=trigger,
                    highest_batch_time=highest_batch_time,
                )
                state.by_id[msg.control_id] = msg
                state.messages.append(msg)
                if len(state.messages) > 500:
                    state.messages = state.messages[-500:]

                # Broadcast to the backend subscriber so HAPI FHIR & PostgreSQL update in real time
                state.broadcast_to_passive([msg])

                yield _serialize_message_sse(msg)
                sent += 1

                if max_events is not None and sent >= max_events:
                    break

                # Sleep in short slices so Stop Stream responds immediately
                remaining = delay_ms / 1000.0
                while remaining > 0 and state.live_stream_active:
                    if await request.is_disconnected():
                        return
                    step_sleep = min(0.1, remaining)
                    await asyncio.sleep(step_sleep)
                    remaining -= step_sleep
        finally:
            state.live_stream_active = False

    return StreamingResponse(
        active_event_generator(),
        media_type="text/event-stream",
        headers=sse_headers,
    )


# -----------------------------------------------------------------------------
# Endpoints: FHIR Resources (REST Pull)
# -----------------------------------------------------------------------------
@app.get("/api/fhir/hospital-locations", tags=["FHIR"])
def get_hospital_locations():
    """Retrieve FHIR R4 Bundle for Hospital Locations, Wards, Rooms, Beds & Practitioners."""
    hosp_file = state.output_dir / "fhir" / "hospital-locations.json"
    if not hosp_file.exists():
        ensure_light_stream()
    if not hosp_file.exists():
        raise HTTPException(
            status_code=404, detail="hospital-locations.json not found."
        )
    return JSONResponse(content=json.loads(hosp_file.read_text(encoding="utf-8")))


@app.get("/api/fhir/patients", tags=["FHIR"])
def list_fhir_patients():
    """List available patient NS identifiers."""
    patients_dir = state.output_dir / "fhir" / "patients"
    if not patients_dir.exists():
        ensure_light_stream()
    if not patients_dir.exists():
        return {"patients": []}
    files = sorted(p.stem for p in patients_dir.glob("*.json"))
    return {"total": len(files), "patient_ns": files}


@app.get("/api/fhir/patients/{ns}", tags=["FHIR"])
def get_patient_fhir_bundle(ns: str):
    """Retrieve the full FHIR R4 transaction bundle for patient NS."""
    patient_file = state.output_dir / "fhir" / "patients" / f"{ns}.json"
    if not patient_file.exists():
        raise HTTPException(
            status_code=404, detail=f"FHIR bundle for patient NS {ns} not found"
        )
    return JSONResponse(content=json.loads(patient_file.read_text(encoding="utf-8")))


# -----------------------------------------------------------------------------
# Endpoints: Subscriptions / Webhooks (REST Push)
# -----------------------------------------------------------------------------
@app.post(
    "/api/subscriptions", response_model=SubscriptionResponse, tags=["Subscriptions"]
)
def register_subscription(sub: SubscriptionCreate, background_tasks: BackgroundTasks):
    """Register a backend webhook URL to receive HL7 events.

    When `auto_stream=True`, a lightweight background stream immediately starts pushing
    HL7 events to the registered URL at `delay_ms` intervals.
    """
    sub_id = f"sub_{uuid.uuid4().hex[:8]}"
    record = {
        "id": sub_id,
        "url": str(sub.url),
        "triggers": sub.triggers,
        "format": sub.format,
        "auto_stream": sub.auto_stream,
        "delay_ms": sub.delay_ms,
        "created_at": datetime.now().isoformat(),
    }
    state.subscribers[sub_id] = record
    logger.info(
        "Registered subscription %s for URL: %s (auto_stream=%s)",
        sub_id,
        sub.url,
        sub.auto_stream,
    )

    if sub.auto_stream:
        messages = ensure_light_stream()
        if sub.triggers:
            messages = [m for m in messages if m.trigger in sub.triggers]
        background_tasks.add_task(
            dispatch_to_subscribers, messages, [record], sub.delay_ms
        )

    return record


@app.get(
    "/api/subscriptions",
    response_model=list[SubscriptionResponse],
    tags=["Subscriptions"],
)
def list_subscriptions():
    """List all registered webhook subscriptions."""
    return list(state.subscribers.values())


@app.delete("/api/subscriptions/{subscription_id}", tags=["Subscriptions"])
def delete_subscription(subscription_id: str):
    """Remove a registered subscription."""
    if subscription_id not in state.subscribers:
        raise HTTPException(status_code=404, detail="Subscription not found")
    del state.subscribers[subscription_id]
    return {"status": "deleted", "id": subscription_id}


@app.post("/api/subscriptions/dispatch", tags=["Subscriptions"])
def dispatch_events(req: DispatchRequest = Body(...)):
    """Dispatch generated HL7 messages to all registered webhook subscribers.

    The backend will receive HTTP POST requests at its registered callback URL for each event.
    """
    if not state.subscribers:
        raise HTTPException(
            status_code=400,
            detail="No active subscriptions registered. Call POST /api/subscriptions first.",
        )

    messages = ensure_light_stream()
    if req.triggers:
        messages = [m for m in messages if m.trigger in req.triggers]

    sub_list = list(state.subscribers.values())
    results = dispatch_to_subscribers(messages, sub_list, delay_ms=req.delay_ms)
    return {
        "status": "completed",
        "total_messages_considered": len(messages),
        "delivered_per_subscriber": results,
    }