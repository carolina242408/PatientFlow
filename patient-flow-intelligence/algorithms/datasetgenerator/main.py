"""Generate 1,000 LOS examples from Synthea demographics, without clinical exports."""

from __future__ import annotations

import argparse
import csv
import math
import random
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_JAR = (
    BASE_DIR.parents[2] / "tools/data-generation/.cache/synthea/synthea-with-dependencies.jar"
)
DATASET_SIZE = 1000
MIN_AGE = 18
MAX_AGE = 100
CSV_COLUMNS = (
    "Idade", "Sexo", "Diagnóstico", "DataAdmissão", "DuraçãoInternamento(target)",
)


@dataclass(frozen=True)
class Patient:
    identifier: str
    birth_date: date
    sex: str

    def age_on(self, day: date) -> int:
        return day.year - self.birth_date.year - (
            (day.month, day.day) < (self.birth_date.month, self.birth_date.day)
        )


@dataclass(frozen=True)
class Specialty:
    code: str
    capacity: int
    occupancy: float
    los_mean: float
    los_sd: float
    age_mean: float
    age_sd: float
    elective_share: float
    diagnoses: tuple[str, ...]


# Snapshot of the ward profiles and fallback ICD-10 diagnoses in
# tools/data-generation/config/{hospital,simulation}.yaml. ICU is excluded:
# its configured LOS describes an ICU segment, rather than a full admission.
SPECIALTIES = (
    Specialty("MED", 64, 0.95, 9.5, 7.0, 77, 11, 0.02,
              ("J18.9", "N39.0", "I50.9", "E86.0", "D64.9", "N17.9")),
    Specialty("CIR", 24, 0.85, 5.5, 4.5, 62, 16, 0.55,
              ("K80.20", "K40.90", "K35.80", "K56.60", "C18.9")),
    Specialty("ORT", 24, 0.88, 7.0, 5.0, 72, 15, 0.40,
              ("S72.009A", "M17.9", "M16.9", "S82.899A")),
    Specialty("CAR", 20, 0.88, 5.5, 4.0, 70, 12, 0.15,
              ("I21.4", "I50.9", "I48.91", "I44.2")),
    Specialty("PNE", 20, 0.90, 8.5, 6.0, 72, 13, 0.08,
              ("J44.1", "J18.9", "J96.00", "C34.90")),
    Specialty("NEU", 20, 0.88, 8.0, 6.0, 72, 13, 0.05,
              ("I63.9", "I61.9", "G40.909", "G45.9")),
)
URGENT_HOUR_PROFILE = (
    3, 2, 2, 1, 1, 1, 1, 2, 3, 4, 5, 6, 6, 7, 8, 8, 8, 8, 7, 7, 6, 5, 4, 3,
)


@dataclass(frozen=True)
class Admission:
    patient: Patient
    diagnosis: str
    admitted_at: datetime
    discharged_at: datetime

    @property
    def los_days(self) -> int:
        return (self.discharged_at - self.admitted_at).days


def load_patients(path: Path, reference: date) -> list[Patient]:
    """Read only demographics; reject malformed data and select living adults."""
    patients: list[Patient] = []
    seen: set[str] = set()
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        required = {"Id", "BIRTHDATE", "DEATHDATE", "GENDER"}
        missing = required.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Colunas em falta em patients.csv: {', '.join(sorted(missing))}.")
        if len(reader.fieldnames or []) != len(set(reader.fieldnames or [])):
            raise ValueError("patients.csv contém nomes de colunas duplicados.")
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"Linha CSV incompleta ou com campos extra: {reader.line_num}.")
            identifier = row["Id"].strip()
            if not identifier or identifier in seen:
                raise ValueError(f"Id vazio ou duplicado na linha {reader.line_num}.")
            seen.add(identifier)
            try:
                birth = date.fromisoformat(row["BIRTHDATE"].strip())
                death_text = row["DEATHDATE"].strip()
                death = date.fromisoformat(death_text) if death_text else None
            except ValueError as exc:
                raise ValueError(f"Data inválida na linha {reader.line_num}.") from exc
            sex = row["GENDER"].strip()
            if sex not in {"M", "F"}:
                raise ValueError(f"GENDER deve ser M ou F na linha {reader.line_num}.")
            if birth > reference or (death is not None and death < birth):
                raise ValueError(f"Datas demográficas inconsistentes na linha {reader.line_num}.")
            patient = Patient(identifier, birth, sex)
            if death is None and MIN_AGE <= patient.age_on(reference) <= MAX_AGE:
                patients.append(patient)
    if len(patients) < DATASET_SIZE:
        raise ValueError(
            f"São necessários pelo menos {DATASET_SIZE} pacientes vivos com "
            f"{MIN_AGE}–{MAX_AGE} anos na data inicial; encontrados {len(patients)}."
        )
    # Synthea's CSV ordering may depend on worker scheduling.
    return sorted(patients, key=lambda patient: patient.identifier)


def run_synthea(jar: Path, work_dir: Path, reference: date, seed: int, state: str) -> Path:
    """Export patients.csv only; no Synthea diagnosis or encounter is consumed."""
    jar = jar.resolve()
    if not jar.is_file():
        raise ValueError(
            f"JAR do Synthea não encontrado: {jar}. "
            "Indique --synthea-jar ou reutilize um --patients-csv do Synthea."
        )
    java = shutil.which("java")
    if java is None:
        raise ValueError("Java não encontrado no PATH; utilize o JDK 21 do projeto.")
    work_dir.mkdir(parents=True, exist_ok=True)
    # A fresh directory prevents clinical CSVs left by earlier runs being reused.
    run_dir = Path(tempfile.mkdtemp(prefix="population-", dir=work_dir.resolve()))
    settings = {
        "exporter.baseDirectory": str(run_dir),
        "exporter.csv.export": "true",
        "exporter.csv.included_files": "patients.csv",
        "exporter.csv.excluded_files": "",
        "exporter.csv.append_mode": "false",
        "exporter.csv.folder_per_run": "false",
        "exporter.fhir.export": "false",
        "exporter.fhir_stu3.export": "false",
        "exporter.fhir_dstu2.export": "false",
        "exporter.hospital.fhir.export": "false",
        "exporter.practitioner.fhir.export": "false",
        "exporter.ccda.export": "false",
        "exporter.json.export": "false",
        "exporter.text.export": "false",
        "exporter.metadata.export": "false",
        "generate.only_alive_patients": "true",
        "generate.only_dead_patients": "false",
        "generate.thread_pool_size": "1",
    }
    command = [
        java, "-jar", str(jar), "-p", str(DATASET_SIZE),
        "-s", str(seed), "-cs", str(seed),
        "-a", f"{MIN_AGE}-{MAX_AGE}",
        "-r", reference.strftime("%Y%m%d"),
        "-e", reference.strftime("%Y%m%d"),
        *[f"--{key}={value}" for key, value in settings.items()], state,
    ]
    log_path = run_dir / "synthea.log"
    print(f"Synthea: a gerar a população; log em {log_path}", flush=True)
    with log_path.open("w", encoding="utf-8") as log:
        result = subprocess.run(command, cwd=run_dir, stdout=log, stderr=subprocess.STDOUT)
    patients_csv = run_dir / "csv" / "patients.csv"
    if result.returncode != 0 or not patients_csv.is_file():
        raise RuntimeError(f"Synthea falhou (código {result.returncode}); consulte {log_path}.")
    return patients_csv


def generate_admissions(patients: list[Patient], start: date, days: int, seed: int) -> list[Admission]:
    """Associate one complete, independently simulated admission with each patient."""
    if days < 1:
        raise ValueError("O período de admissões deve ter pelo menos um dia.")
    if len(patients) < DATASET_SIZE:
        raise ValueError(f"A população deve conter pelo menos {DATASET_SIZE} pacientes.")
    # Reserve room for the maximum generated stay before starting any simulation.
    start + timedelta(days=days - 1 + 90)
    rng = random.Random(seed)
    admissions: list[Admission] = []
    for patient in rng.sample(patients, DATASET_SIZE):
        day = start + timedelta(days=rng.randrange(days))
        age = patient.age_on(day)
        weights = [
            (specialty.capacity * specialty.occupancy / specialty.los_mean)
            * (math.exp(-0.5 * ((age - specialty.age_mean) / specialty.age_sd) ** 2) + 0.01)
            for specialty in SPECIALTIES
        ]
        specialty = rng.choices(SPECIALTIES, weights=weights)[0]
        elective = day.weekday() < 5 and rng.random() < specialty.elective_share
        hour = rng.randint(8, 11) if elective else rng.choices(range(24), weights=URGENT_HOUR_PROFILE)[0]
        admitted_at = datetime.combine(day, time(hour, rng.randrange(60)))
        # Same lognormal formula and elective factor as pfgen.simulation.draw_los.
        factor = 0.8 if elective else 1.0
        mean, sd = specialty.los_mean * factor, specialty.los_sd * factor
        sigma2 = math.log(1 + (sd / mean) ** 2)
        duration = rng.lognormvariate(math.log(mean) - sigma2 / 2, math.sqrt(sigma2))
        # Whole 24-hour days: discharge and target agree exactly, without fractions.
        los_days = min(90, max(1, round(duration)))
        admissions.append(Admission(
            patient=patient,
            diagnosis=rng.choice(specialty.diagnoses),
            admitted_at=admitted_at,
            discharged_at=admitted_at + timedelta(days=los_days),
        ))
    return sorted(admissions, key=lambda admission: (admission.admitted_at, admission.patient.identifier))


def write_dataset(path: Path, admissions: list[Admission]) -> None:
    """Publish only a complete dataset, preserving an existing file on failure."""
    if len(admissions) != DATASET_SIZE:
        raise ValueError(f"O dataset deve conter exatamente {DATASET_SIZE} episódios.")
    if len({admission.patient.identifier for admission in admissions}) != DATASET_SIZE:
        raise ValueError("Cada episódio deve pertencer a um paciente distinto.")
    for admission in admissions:
        if not 1 <= admission.los_days <= 90 or (
            admission.discharged_at - admission.admitted_at
        ) != timedelta(days=admission.los_days):
            raise ValueError("A duração deve corresponder a um número inteiro de dias entre admissão e alta.")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="", dir=path.parent, suffix=".tmp", delete=False,
        ) as output:
            temporary_path = Path(output.name)
            writer = csv.writer(output)
            writer.writerow(CSV_COLUMNS)
            for admission in admissions:
                writer.writerow((
                    admission.patient.age_on(admission.admitted_at.date()),
                    admission.patient.sex,
                    admission.diagnosis,
                    admission.admitted_at.isoformat(timespec="seconds"),
                    admission.los_days,
                ))
        temporary_path.replace(path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Gera 1000 episódios para previsão de LOS com demografia Synthea.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--patients-csv", type=Path, help="patients.csv previamente exportado pelo Synthea")
    source.add_argument("--synthea-jar", type=Path, help=f"JAR local; por omissão: {DEFAULT_JAR}")
    parser.add_argument("--output", type=Path, default=BASE_DIR / "output/los_dataset.csv")
    parser.add_argument("--work-dir", type=Path, default=BASE_DIR / ".cache/synthea")
    parser.add_argument("--start", type=date.fromisoformat, default=date(2026, 10, 1), help="Data inicial YYYY-MM-DD")
    parser.add_argument("--days", type=int, default=7, help="Número de dias do período de admissões")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--state", default="Massachusetts", help="Estado usado pelo Synthea")
    args = parser.parse_args()
    try:
        if args.days < 1:
            raise ValueError("--days deve ser um inteiro positivo.")
        args.start + timedelta(days=args.days - 1 + 90)
        if not -(2 ** 63) <= args.seed < 2 ** 63:
            raise ValueError("--seed deve caber num inteiro Java de 64 bits.")
        if not args.state.strip():
            raise ValueError("--state não pode estar vazio.")
        if args.patients_csv and args.output.resolve() == args.patients_csv.resolve():
            raise ValueError("O CSV final não pode substituir o patients.csv de entrada.")
        patients_csv = args.patients_csv or run_synthea(
            args.synthea_jar or DEFAULT_JAR, args.work_dir, args.start, args.seed, args.state,
        )
        patients = load_patients(patients_csv, args.start)
        admissions = generate_admissions(patients, args.start, args.days, args.seed)
        write_dataset(args.output, admissions)
    except (OSError, ValueError, RuntimeError, csv.Error, OverflowError) as exc:
        parser.exit(1, f"Erro: {exc}\n")
    print(f"Dataset: {args.output.resolve()} ({DATASET_SIZE} episódios; LOS em dias inteiros).")
    print(f"Demografia Synthea: {patients_csv.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
