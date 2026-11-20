#!/usr/bin/env python3
"""PatientFlow Synthetic Data Generator & REST API Service.

Generates realistic Portuguese hospital patient flow data:
- Uses Synthea for FHIR clinical data and realistic health conditions
- Generates compliant HL7 v2.5 ADT messages (A01 Admission, A02 Bed/Room/Service Transfer, A03 Discharge)
- Enforces Portuguese identifier standards and HL7 field integrity:
  * MSH-10: unique UUIDv4 per message
  * PID-3: distinct patient IDs (NS) and SNS numbers
  * PID-5: patient name strictly mapped to PID-3
  * PID-18.1: Nº de processo clínico (stable across all episodes of a patient)
  * PV1-19: episode number
- Simulates realistic patient flow:
  * Admission with bed assignment (wards, rooms, beds, emergency stretchers)
  * Room & bed transfers, service transfers, ICU escalation and step-down
  * Discharges (home, RNCCI, care homes, transfer, deceased)
  * Deliberate edge cases: homonyms, 30-day readmissions, bed cleaning turnaround

REST API Capabilities:
- Start the server with: ``python main.py --serve --port 8001`` (or ``uvicorn pfgen.server:app``)
- Backend can consume data via REST:
  * POST /api/generate (trigger generation)
  * GET /api/hl7/messages (paginated query by trigger, episode, NS, since)
  * GET /api/hl7/stream (full stream download)
  * GET /api/hl7/live (SSE live stream)
  * GET /api/fhir/hospital-locations
  * GET /api/fhir/patients/{ns}
- Backend can subscribe to receive data via Webhook:
  * POST /api/subscriptions (register callback URL)
  * POST /api/subscriptions/dispatch (push events to registered backend callback)
"""

from __future__ import annotations

import argparse
import logging
import random
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from pfgen.hl7 import HL7Builder, render_all
from pfgen.hospital import Hospital
from pfgen.identity import IdentityRegistry
from pfgen.publisher import write_file_outputs
from pfgen.server import app, state
from pfgen.simulation import Simulation, output_events
from pfgen.synthea import load_pool, run_synthea, synthetic_pool
from pfgen.validate import validate_messages

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s: %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("pfgen")

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_HOSPITAL_CONFIG = BASE_DIR / "config" / "hospital.yaml"
DEFAULT_SIMULATION_CONFIG = BASE_DIR / "config" / "simulation.yaml"
CACHE_DIR = BASE_DIR / ".cache" / "synthea"


def load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Configuration file not found: {path}")
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="PatientFlow: Synthetic Data Generator (Synthea FHIR + HL7 v2.5 ADT REST API)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    # Server mode
    parser.add_argument("--serve", action="store_true", help="Start the FastAPI REST server for backend consumption")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="REST server bind host")
    parser.add_argument("--port", type=int, default=8001, help="REST server bind port")

    # Simulation parameters
    parser.add_argument("--hospital-config", type=Path, default=DEFAULT_HOSPITAL_CONFIG, help="Hospital structure YAML")
    parser.add_argument("--simulation-config", type=Path, default=DEFAULT_SIMULATION_CONFIG, help="Simulation parameters YAML")
    parser.add_argument("-o", "--output", type=Path, default=BASE_DIR / "output", help="Output directory for generated files")
    parser.add_argument("--start", type=str, help="Simulation start date (YYYY-MM-DDTHH:MM:SS)")
    parser.add_argument("--days", type=int, help="Number of simulation days")
    parser.add_argument("--warmup-days", type=int, help="Warmup days prior to start")
    parser.add_argument("--warmup-output", choices=["census", "full"], help="Warmup event emission mode")
    parser.add_argument("--seed", type=int, help="Random number generator seed")
    parser.add_argument("--population", type=str, help="Synthea patient population size (or 'auto')")
    parser.add_argument("--no-synthea", action="store_true", help="Generate synthetic patients without running Synthea")
    parser.add_argument("--force-synthea", action="store_true", help="Force re-running Synthea even if cached")
    parser.add_argument("--registry", type=Path, help="Path to identity registry JSON for ID continuity across runs")
    parser.add_argument("--validate", action="store_true", default=True, help="Run HL7 stream integrity validation")
    parser.add_argument("--no-validate", dest="validate", action="store_false", help="Skip HL7 validation")
    parser.add_argument("--check-converter", action="store_true", help="Validate messages against tools/hl7-fhir-converter")
    parser.add_argument("--push-to-hapi", action="store_true", default=True, help="Push FHIR bundles to HAPI server")
    parser.add_argument("--no-push-to-hapi", dest="push_to_hapi", action="store_false", help="Skip pushing FHIR bundles to HAPI server")
    parser.add_argument(
        "--print-hl7",
        "--print-events",
        "-p",
        dest="print_events",
        action="store_true",
        help="Print raw HL7 v2.5 pipe messages to terminal",
    )
    parser.add_argument("--delay-ms", type=int, default=0, help="Delay in ms between printed messages (for real-time watching)")
    return parser


def run_cli_generation(args: argparse.Namespace) -> int:
    hosp_cfg = load_yaml(args.hospital_config)
    sim_cfg = load_yaml(args.simulation_config)

    # CLI overrides
    if args.start:
        sim_cfg["simulation"]["start"] = args.start
    if args.days is not None:
        sim_cfg["simulation"]["days"] = args.days
    if args.warmup_days is not None:
        sim_cfg["simulation"]["warmup_days"] = args.warmup_days
    if args.warmup_output:
        sim_cfg["simulation"]["warmup_output"] = args.warmup_output
    if args.seed is not None:
        sim_cfg["simulation"]["seed"] = args.seed

    seed = int(sim_cfg["simulation"].get("seed", 42))
    rng = random.Random(seed)
    logger.info("Initializing simulation with seed %d", seed)

    hospital = Hospital(hosp_cfg)
    logger.info(
        "Loaded hospital '%s' with %d wards, %d total bed capacity across %d specialties",
        hospital.name,
        len(hospital.wards),
        sum(w.capacity for w in hospital.wards),
        len(hospital.specialties),
    )

    registry_path = args.registry or (args.output / "identity-registry.json")
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
    total_days = float(sim_cfg["simulation"]["days"]) + float(sim_cfg["simulation"].get("warmup_days", 14))

    pop_arg = args.population or sim_cfg["synthea"].get("population", "auto")
    if pop_arg == "auto":
        expected_adm = 0.0
        for s in hospital.specialties:
            spec_cfg = sim_cfg["specialties"].get(s, sim_cfg["specialties"]["MED"])
            if "admissions_per_day" in spec_cfg:
                rate = float(spec_cfg["admissions_per_day"])
            else:
                cap = hospital.capacity_of(s)
                rate = cap * float(spec_cfg.get("target_occupancy", 0.85)) / float(spec_cfg["los"]["mean"])
            expected_adm += rate * total_days
        population_size = max(20, int(expected_adm * 1.35))
    else:
        population_size = int(pop_arg)

    logger.info("Required patient population size: %d", population_size)

    if args.no_synthea:
        logger.info("Generating synthetic patient pool (--no-synthea requested)...")
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
                force=args.force_synthea,
            )
            pool = load_pool(fhir_dir, hospital.specialties)
            logger.info("Loaded %d eligible patients from Synthea FHIR bundles", len(pool))
        except Exception as e:
            logger.warning("Synthea execution/loading failed: %s. Falling back to synthetic demographics.", e)
            pool = synthetic_pool(
                size=population_size,
                rng=rng,
                reference=sim_start,
                min_age=int(sim_cfg["synthea"].get("min_age", 18)),
                max_age=int(sim_cfg["synthea"].get("max_age", 95)),
            )

    if not pool:
        logger.error("No patients available in pool. Exiting.")
        return 1

    logger.info("Running patient flow simulation (%s, %s warmup days)...", sim_start.date(), sim_cfg["simulation"].get("warmup_days", 14))
    sim = Simulation(hospital, sim_cfg, pool, registry, rng)
    sim_result = sim.run()

    warmup_mode = sim_cfg["simulation"].get("warmup_output", "census")
    active_events = output_events(sim_result, warmup_mode)
    logger.info("Simulation completed: %d episodes, %d ADT events to output", len(sim_result.episodes), len(active_events))

    builder = HL7Builder(hospital, sim_cfg["hl7"], rng)
    max_clean_minutes = int(sim_cfg["flow"].get("bed_turnaround_minutes", [45, 120])[0])
    delay_range = tuple(sim_cfg["flow"].get("registration_delay_minutes", [0, 20]))

    rendered_messages = render_all(
        events=active_events,
        builder=builder,
        operators=sim_result.operators,
        delay_range=delay_range,
        max_delay_minutes=max_clean_minutes - 5,
        rng=rng,
    )
    logger.info("Rendered %d HL7 v2.5 messages", len(rendered_messages))

    validation_report = None
    if args.validate:
        logger.info("Validating HL7 messages integrity (MSH-10, PID-3, PID-5, PID-18, bed replay)...")
        raw_texts = [m.text for m in rendered_messages]
        validation_report = validate_messages(raw_texts, check_converter=args.check_converter)

        if validation_report["passed"]:
            logger.info("Validation PASSED! All integrity constraints satisfied.")
        else:
            logger.error("Validation FAILED: %s", validation_report["errors"])

    drop_fhir_types = set(sim_cfg["fhir"].get("drop_resource_types", []))
    pretty_fhir = bool(sim_cfg["fhir"].get("pretty", False))
    push_to_hapi = True
    summary = write_file_outputs(
        output_dir=args.output,
        rendered_messages=rendered_messages,
        sim_result=sim_result,
        hospital=hospital,
        registry=registry,
        pool_patients=pool,
        drop_fhir_types=drop_fhir_types,
        pretty_fhir=pretty_fhir,
        push_to_hapi=push_to_hapi,
        validation_report=validation_report,
        
    )

    state.messages = rendered_messages
    state.by_id = {m.control_id: m for m in rendered_messages}
    state.summary = summary

    logger.info("Outputs written to '%s'", args.output.resolve())
    logger.info("  -> HL7 stream: %s", args.output / "stream.hl7")
    logger.info("  -> HL7 files: %s (%d files)", args.output / "hl7", len(rendered_messages))
    logger.info("  -> FHIR hospital: %s", args.output / "fhir" / "hospital-locations.json")
    logger.info("  -> FHIR patients: %s", args.output / "fhir" / "patients")

    if args.print_events:
        import time

        total_msgs = len(rendered_messages)
        print(f"\n{'=' * 80}")
        print(f"MENSAGENS HL7 v2.5 ADT ({total_msgs} mensagens geradas)")
        print(f"{'=' * 80}\n")
        for idx, msg in enumerate(rendered_messages, 1):
            formatted_hl7 = msg.text.replace("\r\n", "\n").replace("\r", "\n").strip()
            print(f"--- [Mensagem {idx}/{total_msgs} | ADT^{msg.trigger} | MSH-10: {msg.control_id} | Episódio: {msg.episode}] ---")
            print(formatted_hl7)
            print()
            sys.stdout.flush()
            if args.delay_ms > 0 and idx < total_msgs:
                time.sleep(args.delay_ms / 1000.0)

    return 0 if (not args.validate or (validation_report and validation_report["passed"])) else 1


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.serve:
        import uvicorn

        logger.info("Starting PatientFlow Synthetic Data REST API on %s:%d...", args.host, args.port)
        uvicorn.run(app, host=args.host, port=args.port)
        return 0

    return run_cli_generation(args)


if __name__ == "__main__":
    sys.exit(main())
