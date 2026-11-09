"""Output publisher for generated HL7 messages and FHIR bundles.

Outputs supported:
1. File output:
   - Individual HL7 files: ``output/hl7/{seq:05d}_{trigger}_{episode}_{control_id}.hl7``
   - Sequential HL7 stream: ``output/stream.hl7`` (ordered by registration timestamp)
   - FHIR bundles: ``output/fhir/hospital-locations.json`` and ``output/fhir/patients/{ns}.json``
   - CSV dataset: ``output/dataset.csv`` (gender, diagnosis code, birthdate, admission date, discharge date)
   - Registry state: ``output/identity-registry.json`` for ID continuity across runs
   - Execution summary & validation: ``output/summary.json``

2. REST Webhook / Subscription Dispatcher:
   - Dispatches generated HL7 messages directly to subscriber webhook URLs registered by the backend.
   - Includes message payload and headers (MSH-10, trigger, NS, processo, episode, timestamps).
"""

from __future__ import annotations

import csv
import math
import random
import io
import json
import logging
import time
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any

import httpx

from .fhir_out import hospital_bundle, patient_bundle, write_json
from .hl7 import RenderedMessage
from .hospital import Hospital
from .identity import IdentityRegistry, PatientIdentity
from .simulation import Episode, SimulationResult

logger = logging.getLogger("pfgen.publisher")


SPECIALTY_PROFILES = [
    ("MED", 64, 0.95, 9.5, 7.0, 77, 11, 0.02, ["J18.9", "N39.0", "I50.9", "E86.0", "D64.9", "N17.9"]),
    ("CIR", 24, 0.85, 5.5, 4.5, 62, 16, 0.55, ["K80.20", "K40.90", "K35.80", "K56.60", "C18.9"]),
    ("ORT", 24, 0.88, 7.0, 5.0, 72, 15, 0.40, ["S72.009A", "M17.9", "M16.9", "S82.899A"]),
    ("CAR", 20, 0.88, 5.5, 4.0, 70, 12, 0.15, ["I21.4", "I50.9", "I48.91", "I44.2"]),
    ("PNE", 20, 0.90, 8.5, 6.0, 72, 13, 0.08, ["J44.1", "J18.9", "J96.00", "C34.90"]),
    ("NEU", 20, 0.88, 8.0, 6.0, 72, 13, 0.05, ["I63.9", "I61.9", "G40.909", "G45.9"]),
]
URGENT_HOURS = [3, 2, 2, 1, 1, 1, 1, 2, 3, 4, 5, 6, 6, 7, 8, 8, 8, 8, 7, 7, 6, 5, 4, 3]


def build_dataset_csv(episodes: list[Episode], target_rows: int = 1000, seed: int = 42) -> str:
    """Generate CSV string containing: gender, diagnosis code, birthdate, admission date, discharge date."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["gender", "diagnosis code", "birthdate", "admission date", "discharge date"])

    rows_written = 0
    ref_start = date(2026, 10, 1)

    # 1. Output simulation episodes
    for ep in episodes:
        if ep.admit_time is None and ep.planned_discharge is None:
            continue
        gender = ep.patient.sex
        diag_code = ep.diagnosis.code if ep.diagnosis else ""
        birthdate = ep.patient.birth_date.isoformat() if ep.patient.birth_date else ""
        admit_val = ep.admit_time or ep.arrival
        admit_dt = admit_val.isoformat(timespec="seconds")
        ref_start = admit_val.date()
        discharge_val = ep.discharge_time or ep.planned_discharge
        if discharge_val is None:
            discharge_val = admit_val
        discharge_dt = discharge_val.isoformat(timespec="seconds")
        writer.writerow([gender, diag_code, birthdate, admit_dt, discharge_dt])
        rows_written += 1
        if target_rows and rows_written >= target_rows:
            return output.getvalue()

    # 2. Complete with additional realistic patient flow episodes if more rows requested
    if target_rows and rows_written < target_rows:
        rng = random.Random(seed)
        needed = target_rows - rows_written
        for _ in range(needed):
            gender = rng.choice(["M", "F"])
            age = int(rng.gauss(68, 14))
            age = max(18, min(95, age))
            birth_year = ref_start.year - age
            birth_month = rng.randint(1, 12)
            birth_day = rng.randint(1, 28)
            birthdate = date(birth_year, birth_month, birth_day).isoformat()

            weights = [
                (cap * occ / los_m) * (math.exp(-0.5 * ((age - a_mean) / a_sd) ** 2) + 0.01)
                for (_, cap, occ, los_m, _, a_mean, a_sd, _, _) in SPECIALTY_PROFILES
            ]
            spec = rng.choices(SPECIALTY_PROFILES, weights=weights)[0]
            _, _, _, los_mean, los_sd, _, _, elective_share, diagnoses = spec

            diag_code = rng.choice(diagnoses)
            adm_day = ref_start + timedelta(days=rng.randrange(365))
            elective = adm_day.weekday() < 5 and rng.random() < elective_share
            hour = rng.randint(8, 11) if elective else rng.choices(range(24), weights=URGENT_HOURS)[0]
            admitted_at = datetime.combine(adm_day, time(hour, rng.randint(0, 59), rng.randint(0, 59)))

            factor = 0.8 if elective else 1.0
            mean = los_mean * factor
            sd = los_sd * factor
            sigma2 = math.log(1 + (sd / mean) ** 2)
            mu = math.log(mean) - sigma2 / 2
            los_days = max(1, min(90, round(rng.lognormvariate(mu, math.sqrt(sigma2)))))
            discharged_at = admitted_at + timedelta(days=los_days, hours=rng.randint(-2, 4), minutes=rng.randint(0, 50))

            writer.writerow([
                gender,
                diag_code,
                birthdate,
                admitted_at.isoformat(timespec="seconds"),
                discharged_at.isoformat(timespec="seconds"),
            ])
            rows_written += 1

    return output.getvalue()


def write_file_outputs(
    output_dir: Path,
    rendered_messages: list[RenderedMessage],
    sim_result: SimulationResult,
    hospital: Hospital,
    registry: IdentityRegistry,
    pool_patients: list[Any],
    drop_fhir_types: set[str],
    pretty_fhir: bool = True,
    validation_report: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Write all generated HL7 messages, FHIR bundles, CSV dataset, and metadata to disk."""
    output_dir.mkdir(parents=True, exist_ok=True)
    hl7_dir = output_dir / "hl7"
    fhir_dir = output_dir / "fhir"
    patients_dir = fhir_dir / "patients"

    hl7_dir.mkdir(parents=True, exist_ok=True)
    patients_dir.mkdir(parents=True, exist_ok=True)

    # 1. Write individual HL7 messages
    stream_path = output_dir / "stream.hl7"
    stream_content: list[str] = []

    for idx, msg in enumerate(rendered_messages, 1):
        filename = f"{idx:05d}_{msg.trigger}_{msg.episode}_{msg.control_id[:8]}.hl7"
        msg_file = hl7_dir / filename
        msg_file.write_text(msg.text, encoding="utf-8")
        stream_content.append(msg.text)

    # 2. Write unified stream file
    stream_path.write_text("".join(stream_content), encoding="utf-8")

    # 3. Write hospital locations & practitioners FHIR bundle
    hosp_bundle = hospital_bundle(hospital, sim_result.doctors, sim_result.end)
    write_json(fhir_dir / "hospital-locations.json", hosp_bundle, pretty=pretty_fhir)

    # 4. Write FHIR bundles per patient
    episodes_by_patient: dict[str, list[Episode]] = {}
    for ep in sim_result.episodes:
        episodes_by_patient.setdefault(ep.patient.ns, []).append(ep)

    pool_by_key = {p.key: p for p in pool_patients}

    patients_written = 0
    for ns, p_episodes in episodes_by_patient.items():
        identity = p_episodes[0].patient
        pool_p = pool_by_key.get(identity.key, p_episodes[0].pool)
        bundle_data = patient_bundle(pool_p, identity, p_episodes, drop_fhir_types)
        write_json(patients_dir / f"{ns}.json", bundle_data, pretty=pretty_fhir)
        patients_written += 1

    # 5. Persist registry state for subsequent runs
    registry.save(output_dir / "identity-registry.json")

    # 5b. Write CSV dataset containing: gender, diagnosis code, birthdate, admission date, discharge date
    csv_path = output_dir / "dataset.csv"
    csv_content = build_dataset_csv(sim_result.episodes, target_rows=1000)
    csv_path.write_text(csv_content, encoding="utf-8")

    # 6. Write summary report
    summary = {
        "generated_at": datetime.now().isoformat(),
        "simulation": {
            "start": sim_result.start.isoformat(),
            "end": sim_result.end.isoformat(),
            "total_episodes": len(sim_result.episodes),
            "total_messages": len(rendered_messages),
            "by_trigger": {
                "A01": sum(1 for m in rendered_messages if m.trigger == "A01"),
                "A02": sum(1 for m in rendered_messages if m.trigger == "A02"),
                "A03": sum(1 for m in rendered_messages if m.trigger == "A03"),
            },
            "stats": sim_result.stats,
        },
        "patients": {
            "total_simulated": len(episodes_by_patient),
            "homonym_groups": validation_report.get("homonym_groups", 0) if validation_report else 0,
        },
        "files": {
            "hl7_dir": str(hl7_dir.relative_to(output_dir)),
            "stream_file": str(stream_path.relative_to(output_dir)),
            "fhir_hospital": str((fhir_dir / "hospital-locations.json").relative_to(output_dir)),
            "fhir_patients_dir": str(patients_dir.relative_to(output_dir)),
            "csv_dataset": str(csv_path.relative_to(output_dir)),
        },
        "validation": validation_report or {},
    }

    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    return summary


def dispatch_to_subscribers(
    rendered_messages: list[RenderedMessage],
    subscribers: list[dict[str, Any]],
    delay_ms: int = 0,
) -> dict[str, int]:
    """Dispatch HL7 messages to registered HTTP webhook subscribers.

    Each subscriber is a dict:
      {
        "id": "sub_1",
        "url": "http://localhost:8080/api/hl7/events",
        "triggers": ["A01", "A02", "A03"], # optional filter
        "format": "json" | "hl7"           # default "json"
      }
    """
    results: dict[str, int] = {sub["id"]: 0 for sub in subscribers}

    with httpx.Client(timeout=10.0) as client:
        for msg in rendered_messages:
            for sub in subscribers:
                allowed_triggers = sub.get("triggers")
                if allowed_triggers and msg.trigger not in allowed_triggers:
                    continue

                url = sub["url"]
                msg_format = sub.get("format", "json")

                headers = {
                    "X-HL7-Trigger": msg.trigger,
                    "X-HL7-Control-Id": msg.control_id,
                    "X-HL7-NS": msg.ns,
                    "X-HL7-Processo": msg.processo,
                    "X-HL7-Episode": msg.episode,
                    "X-HL7-Occurred": msg.occurred.isoformat(),
                    "X-HL7-Registered": msg.msh_time.isoformat(),
                }

                try:
                    if msg_format == "hl7":
                        headers["Content-Type"] = "text/plain; charset=utf-8"
                        resp = client.post(url, content=msg.text.encode("utf-8"), headers=headers)
                    else:
                        payload = {
                            "control_id": msg.control_id,
                            "trigger": msg.trigger,
                            "episode": msg.episode,
                            "ns": msg.ns,
                            "processo": msg.processo,
                            "occurred": msg.occurred.isoformat(),
                            "msh_time": msg.msh_time.isoformat(),
                            "hl7": msg.text,
                        }
                        resp = client.post(url, json=payload, headers=headers)

                    if 200 <= resp.status_code < 300:
                        results[sub["id"]] += 1
                    else:
                        logger.warning("Subscriber %s returned HTTP %d", sub["id"], resp.status_code)
                except Exception as exc:
                    logger.error("Failed to dispatch to subscriber %s (%s): %s", sub["id"], url, exc)

            if delay_ms > 0:
                time.sleep(delay_ms / 1000.0)

    return results
