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
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncGenerator

from fastapi import Body, FastAPI, HTTPException, Header, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field

from .hl7 import HL7Builder, RenderedMessage, render_all
from .hospital import Hospital
from .identity import IdentityRegistry
from .publisher import dispatch_to_subscribers, write_file_outputs
from .simulation import Simulation, output_events
from .synthea import load_pool, run_synthea, synthetic_pool
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


# In-memory store for active simulation state and subscriptions
class State:
    def __init__(self) -> None:
        self.messages: list[RenderedMessage] = []
        self.by_id: dict[str, RenderedMessage] = {}
        self.summary: dict[str, Any] = {}
        self.subscribers: dict[str, dict[str, Any]] = {}
        self.output_dir: Path = OUTPUT_DIR

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
    warmup_days: int = Field(default=3, ge=0, le=60, description="Warmup days prior to start")
    seed: int = Field(default=42, description="Random seed")
    population: str = Field(default="auto", description="Synthea population size ('auto' or integer)")
    no_synthea: bool = Field(default=False, description="Fast offline mode (bypass Synthea)")
    warmup_output: str = Field(default="census", description="'census' or 'full'")
    run_validation: bool = Field(default=True, alias="validate", description="Run HL7 integrity validator")


class SubscriptionCreate(BaseModel):
    url: str = Field(..., description="Callback webhook URL (e.g. http://localhost:8080/api/hl7/events)")
    triggers: list[str] | None = Field(default=None, description="Optional trigger filter (e.g. ['A01', 'A02', 'A03'])")
    format: str = Field(default="json", description="Payload format: 'json' or 'hl7'")


class SubscriptionResponse(BaseModel):
    id: str
    url: str
    triggers: list[str] | None
    format: str
    created_at: str


class DispatchRequest(BaseModel):
    delay_ms: int = Field(default=0, ge=0, le=10000, description="Inter-message delay in ms for simulated live replay")
    triggers: list[str] | None = Field(default=None, description="Filter specific triggers to dispatch")


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
        homonym_same_birthdate_rate=float(sim_cfg["identity"].get("homonym_same_birthdate_rate", 0.25)),
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
                rate = cap * float(spec_cfg.get("target_occupancy", 0.85)) / float(spec_cfg["los"]["mean"])
            expected_adm += rate * total_days
        population_size = max(50, int(expected_adm * 1.35))
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
    if validate:
        raw_texts = [m.text for m in messages]
        validation_report = validate_messages(raw_texts, check_converter=False)

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
    )

    state.messages = messages
    state.by_id = {m.control_id: m for m in messages}
    state.summary = summary
    return summary


# -----------------------------------------------------------------------------
# Endpoints: System & Health
# -----------------------------------------------------------------------------
@app.on_event("startup")
def startup_event() -> None:
    state.load_from_disk()


@app.get("/", tags=["Info"])
def get_root():
    return {
        "service": "PatientFlow Synthetic Data REST API",
        "version": "1.0.0",
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
        )
        return summary
    except Exception as e:
        logger.exception("Generation error")
        raise HTTPException(status_code=500, detail=f"Generation failed: {e}") from e


@app.get("/api/simulation/summary", tags=["Simulation"])
def get_simulation_summary():
    """Retrieve summary of the generated simulation."""
    if not state.summary:
        state.load_from_disk()
    if not state.summary:
        raise HTTPException(status_code=404, detail="No simulation run found. Call POST /api/generate first.")
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
    items = state.messages
    if not items:
        # Try loading stream from disk
        stream_file = state.output_dir / "stream.hl7"
        if stream_file.exists():
            return JSONResponse(
                content={
                    "total": 0,
                    "message": "Messages are saved in output/ directory. Run POST /api/generate or reload to populate memory.",
                }
            )
        raise HTTPException(status_code=404, detail="No messages generated. Call POST /api/generate first.")

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
            raise HTTPException(status_code=400, detail="Invalid ISO datetime format for 'since'")

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
        raise HTTPException(status_code=404, detail=f"Message with control_id {control_id} not found")

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
        if state.messages:
            content = "".join(m.text for m in state.messages)
            return PlainTextResponse(content)
        raise HTTPException(status_code=404, detail="No stream.hl7 found. Call POST /api/generate first.")
    return PlainTextResponse(stream_file.read_text(encoding="utf-8"))


@app.get("/api/hl7/live", tags=["HL7"])
async def live_hl7_stream(
    delay_ms: int = Query(default=100, ge=10, le=5000, description="Delay between events in ms"),
    trigger: str | None = None,
):
    """Server-Sent Events (SSE) live stream of HL7 messages.

    The backend can subscribe to this endpoint to receive events as a continuous stream.
    """
    messages = state.messages
    if not messages:
        raise HTTPException(status_code=404, detail="No messages available. Call POST /api/generate first.")

    async def event_generator() -> AsyncGenerator[str, None]:
        for msg in messages:
            if trigger and msg.trigger != trigger:
                continue

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
            yield f"event: hl7_{msg.trigger.lower()}\ndata: {event_data}\n\n"
            await asyncio.sleep(delay_ms / 1000.0)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# -----------------------------------------------------------------------------
# Endpoints: FHIR Resources (REST Pull)
# -----------------------------------------------------------------------------
@app.get("/api/fhir/hospital-locations", tags=["FHIR"])
def get_hospital_locations():
    """Retrieve FHIR R4 Bundle for Hospital Locations, Wards, Rooms, Beds & Practitioners."""
    hosp_file = state.output_dir / "fhir" / "hospital-locations.json"
    if not hosp_file.exists():
        raise HTTPException(status_code=404, detail="hospital-locations.json not found. Run POST /api/generate first.")
    return JSONResponse(content=json.loads(hosp_file.read_text(encoding="utf-8")))


@app.get("/api/fhir/patients", tags=["FHIR"])
def list_fhir_patients():
    """List available patient NS identifiers."""
    patients_dir = state.output_dir / "fhir" / "patients"
    if not patients_dir.exists():
        return {"patients": []}
    files = sorted(p.stem for p in patients_dir.glob("*.json"))
    return {"total": len(files), "patient_ns": files}


@app.get("/api/fhir/patients/{ns}", tags=["FHIR"])
def get_patient_fhir_bundle(ns: str):
    """Retrieve the full FHIR R4 transaction bundle for patient NS."""
    patient_file = state.output_dir / "fhir" / "patients" / f"{ns}.json"
    if not patient_file.exists():
        raise HTTPException(status_code=404, detail=f"FHIR bundle for patient NS {ns} not found")
    return JSONResponse(content=json.loads(patient_file.read_text(encoding="utf-8")))


# -----------------------------------------------------------------------------
# Endpoints: Subscriptions / Webhooks (REST Push)
# -----------------------------------------------------------------------------
@app.post("/api/subscriptions", response_model=SubscriptionResponse, tags=["Subscriptions"])
def register_subscription(sub: SubscriptionCreate):
    """Register a backend webhook URL to receive HL7 events."""
    sub_id = f"sub_{uuid.uuid4().hex[:8]}"
    record = {
        "id": sub_id,
        "url": str(sub.url),
        "triggers": sub.triggers,
        "format": sub.format,
        "created_at": datetime.now().isoformat(),
    }
    state.subscribers[sub_id] = record
    logger.info("Registered subscription %s for URL: %s", sub_id, sub.url)
    return record


@app.get("/api/subscriptions", response_model=list[SubscriptionResponse], tags=["Subscriptions"])
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
        raise HTTPException(status_code=400, detail="No active subscriptions registered. Call POST /api/subscriptions first.")
    if not state.messages:
        raise HTTPException(status_code=400, detail="No messages generated. Call POST /api/generate first.")

    messages = state.messages
    if req.triggers:
        messages = [m for m in messages if m.trigger in req.triggers]

    sub_list = list(state.subscribers.values())
    results = dispatch_to_subscribers(messages, sub_list, delay_ms=req.delay_ms)
    return {
        "status": "completed",
        "total_messages_considered": len(messages),
        "delivered_per_subscriber": results,
    }
