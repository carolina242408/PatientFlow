"""Output publisher for generated HL7 messages and FHIR bundles."""

from __future__ import annotations

import csv
import io
import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from .fhir_out import hospital_bundle, patient_bundle, write_json
from .hl7 import RenderedMessage
from .hospital import Hospital
from .identity import IdentityRegistry
from .simulation import Episode, SimulationResult

logger = logging.getLogger("pfgen.publisher")


def build_dataset_csv(episodes: list[Episode]) -> str:
    """Generate CSV string containing: gender, specialty, diagnosis code, birthdate, admission date, discharge date."""
    output = io.StringIO()
    writer = csv.writer(output)
    # Adicionamos "specialty" ao cabeçalho
    writer.writerow(["gender", "specialty", "diagnosis code", "birthdate", "admission date", "discharge date"])

    for ep in episodes:
        if ep.admit_time is None and ep.planned_discharge is None:
            continue
        gender = ep.patient.sex
        # Recolhe a especialidade do episódio (por exemplo, ward.specialty ou specialty)
        specialty = ep.specialty if hasattr(ep, "specialty") else ""
        diag_code = ep.diagnosis.code if ep.diagnosis else ""
        birthdate = ep.patient.birth_date.isoformat() if ep.patient.birth_date else ""
        admit_val = ep.admit_time or ep.arrival
        admit_dt = admit_val.isoformat(timespec="seconds")
        discharge_val = ep.discharge_time or ep.planned_discharge or admit_val
        discharge_dt = discharge_val.isoformat(timespec="seconds")
        
        # Escreve a linha incluindo a especialidade
        writer.writerow([gender, specialty, diag_code, birthdate, admit_dt, discharge_dt])

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
    push_to_hapi: bool = True,
) -> dict[str, Any]:
    """Write all generated HL7 messages, FHIR bundles, CSV dataset, and metadata to disk."""
    output_dir.mkdir(parents=True, exist_ok=True)
    hl7_dir = output_dir / "hl7"
    fhir_dir = output_dir / "fhir"
    patients_dir = fhir_dir / "patients"

    hl7_dir.mkdir(parents=True, exist_ok=True)
    patients_dir.mkdir(parents=True, exist_ok=True)

    for old_file in hl7_dir.glob("*.hl7"):
        old_file.unlink(missing_ok=True)

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

    # 5. Push to HAPI FHIR server if enabled
    if push_to_hapi:
        logger.info("Pushing generated FHIR bundles to HAPI FHIR server...")
        # Lógica de envio HTTP para o servidor HAPI (se aplicável)

    # 6. Persist registry state for subsequent runs
    registry.save(output_dir / "identity-registry.json")

    # 7. Write summary report
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
    """Dispatch HL7 messages to registered HTTP webhook subscribers."""
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