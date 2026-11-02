"""Synthea integration: download, run (with caching) and load the FHIR output.

Synthea gives each simulated patient a coherent clinical history (chronic
conditions, past inpatient/emergency encounters, observations, medication...).
We use it as the clinical backbone:

* sex + birth date + conditions decide *which* specialty can admit the patient
  and with which diagnosis;
* the Synthea FHIR bundle is later rewritten with the Portuguese identity and
  enriched with the simulated hospital episodes (see ``fhir_out.py``).

Synthea's timeline (years of history) does not model bed management, so
admission/transfer/discharge timing is produced by ``simulation.py``.
"""

from __future__ import annotations

import json
import random
import shutil
import subprocess
import sys
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

from .clinical import Diagnosis, classify, comorbidity


@dataclass
class PoolPatient:
    key: str                         # Synthea Patient.id (UUID)
    sex: str                         # M | F
    birth_date: date
    bundle_path: Path | None
    cases: dict[str, list[tuple[Diagnosis, float]]] = field(default_factory=dict)
    comorbidities: list[Diagnosis] = field(default_factory=list)
    deceased: bool = False           # died during our simulation

    def age_on(self, day: date) -> int:
        years = day.year - self.birth_date.year
        if (day.month, day.day) < (self.birth_date.month, self.birth_date.day):
            years -= 1
        return years


# ---------------------------------------------------------------------- runner
def ensure_java() -> str:
    java = shutil.which("java")
    if not java:
        raise RuntimeError("Java 11+ is required to run Synthea (java not found on PATH).")
    return java


def ensure_jar(cache_dir: Path, url: str) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    jar = cache_dir / "synthea-with-dependencies.jar"
    if jar.exists() and jar.stat().st_size > 1_000_000:
        return jar
    tmp = jar.with_suffix(".part")
    print(f"[synthea] downloading {url}")

    def progress(blocks: int, block_size: int, total: int) -> None:
        if total > 0:
            pct = min(100, blocks * block_size * 100 // total)
            sys.stdout.write(f"\r[synthea] {pct:3d}% of {total // 1_000_000} MB")
            sys.stdout.flush()

    urllib.request.urlretrieve(url, tmp, reporthook=progress)
    print()
    tmp.replace(jar)
    return jar


def run_synthea(
    cache_dir: Path,
    jar_url: str,
    population: int,
    seed: int,
    min_age: int,
    max_age: int,
    years_of_history: int,
    reference_date: date,
    state: str,
    force: bool = False,
) -> Path:
    """Run Synthea once per parameter set and return the FHIR output folder."""
    run_dir = cache_dir / "runs" / (
        f"p{population}_s{seed}_a{min_age}-{max_age}_y{years_of_history}_r{reference_date:%Y%m%d}"
    )
    fhir_dir = run_dir / "fhir"
    if fhir_dir.exists() and any(fhir_dir.glob("*.json")) and not force:
        print(f"[synthea] reusing cached output {run_dir}")
        return fhir_dir
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True)

    java = ensure_java()
    jar = ensure_jar(cache_dir, jar_url)
    settings = {
        "exporter.baseDirectory": str(run_dir),
        "exporter.fhir.export": "true",
        "exporter.fhir.transaction_bundle": "true",
        "exporter.fhir.use_us_core_ig": "false",
        "exporter.fhir.bulk_data": "false",
        "exporter.hospital.fhir.export": "false",
        "exporter.practitioner.fhir.export": "false",
        "exporter.csv.export": "false",
        "exporter.ccda.export": "false",
        "exporter.text.export": "false",
        "exporter.metadata.export": "false",
        "exporter.years_of_history": str(years_of_history),
        "generate.only_alive_patients": "true",
    }
    cmd = [
        java, "-jar", str(jar),
        "-p", str(population),
        "-s", str(seed),
        "-cs", str(seed),
        "-a", f"{min_age}-{max_age}",
        "-r", reference_date.strftime("%Y%m%d"),
        *[f"--{k}={v}" for k, v in settings.items()],
        state,
    ]
    print(f"[synthea] generating {population} patients (this can take a few minutes)...")
    log_path = run_dir / "synthea.log"
    with log_path.open("w", encoding="utf-8", errors="replace") as log:
        result = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, cwd=run_dir)
    if result.returncode != 0 or not any(fhir_dir.glob("*.json")):
        raise RuntimeError(f"Synthea failed (exit {result.returncode}); see {log_path}")
    print(f"[synthea] done -> {fhir_dir}")
    return fhir_dir


# ---------------------------------------------------------------------- loader
def _snomed(concept: dict | None) -> tuple[str | None, str | None]:
    for coding in (concept or {}).get("coding", []):
        if "snomed" in (coding.get("system") or ""):
            return coding.get("code"), coding.get("display") or concept.get("text")
    return None, None


def load_pool(fhir_dir: Path, specialties: list[str]) -> list[PoolPatient]:
    pool: list[PoolPatient] = []
    for path in sorted(fhir_dir.glob("*.json")):
        if path.name.startswith(("hospitalInformation", "practitionerInformation")):
            continue
        bundle = json.loads(path.read_text(encoding="utf-8"))
        resources = [e.get("resource", {}) for e in bundle.get("entry", [])]
        patient = next((r for r in resources if r.get("resourceType") == "Patient"), None)
        if not patient or patient.get("deceasedDateTime") or patient.get("deceasedBoolean"):
            continue

        cases: dict[str, dict[str, tuple[Diagnosis, float]]] = {}
        comorb: dict[str, Diagnosis] = {}

        def add_case(code: str | None, display: str | None, from_encounter: bool) -> None:
            if not code:
                return
            specialty, diagnosis = classify(code, display, from_encounter)
            if specialty and diagnosis and specialty in specialties:
                weight = 3.0 if from_encounter else 1.0
                bucket = cases.setdefault(specialty, {})
                previous = bucket.get(code)
                bucket[code] = (diagnosis, weight + (previous[1] if previous else 0))

        for res in resources:
            rtype = res.get("resourceType")
            if rtype == "Encounter":
                enc_class = (res.get("class") or {}).get("code")
                if enc_class in ("IMP", "EMER", "ACUTE"):
                    for reason in res.get("reasonCode", []):
                        add_case(*_snomed(reason), from_encounter=True)
            elif rtype == "Condition":
                code, display = _snomed(res.get("code"))
                if not code:
                    continue
                active = not res.get("abatementDateTime")
                add_case(code, display, from_encounter=False)
                if active:
                    diag = comorbidity(code, display)
                    if diag:
                        comorb[diag.code] = diag

        pool.append(
            PoolPatient(
                key=patient["id"],
                sex="M" if patient.get("gender") == "male" else "F",
                birth_date=date.fromisoformat(patient["birthDate"]),
                bundle_path=path,
                cases={s: list(v.values()) for s, v in cases.items()},
                comorbidities=list(comorb.values()),
            )
        )
    return pool


def synthetic_pool(size: int, rng: random.Random, reference: datetime, min_age: int, max_age: int) -> list[PoolPatient]:
    """Offline fallback (``--no-synthea``): demographics only, config diagnoses."""
    import uuid

    from .clinical import SNOMED_MAP

    chronic = [(code, v) for code, v in SNOMED_MAP.items() if v[0] is None]
    pool = []
    for _ in range(size):
        age = int(min(max_age, max(min_age, rng.triangular(min_age, max_age + 5, 82))))
        birth = date(reference.year - age, rng.randint(1, 12), rng.randint(1, 28))
        comorb = [
            Diagnosis(icd, text, "ICD10", code, None, source="config")
            for code, (_, icd, text) in rng.sample(chronic, k=rng.randint(0, 3))
        ]
        pool.append(
            PoolPatient(
                key=str(uuid.UUID(int=rng.getrandbits(128), version=4)),
                sex=rng.choice("MF"),
                birth_date=birth,
                bundle_path=None,
                comorbidities=comorb,
            )
        )
    return pool
