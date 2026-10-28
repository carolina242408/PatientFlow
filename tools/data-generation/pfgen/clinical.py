"""Clinical mapping: Synthea SNOMED CT codes -> Portuguese hospital specialty.

Portuguese hospitals code inpatient episodes with ICD-10-CM/PCS (since 2017),
so each SNOMED code produced by Synthea is mapped to:

* the specialty that would admit the patient (``MED``, ``CIR``, ``ORT``,
  ``CAR``, ``PNE``, ``NEU``, ``UCI``) - or ``None`` when it is only a
  comorbidity,
* an ICD-10 code and an upper-case Portuguese description (as in the sample
  messages, e.g. ``0811^DOENCA DE BRILL^ICD10^HOS``).

Unknown SNOMED codes coming from Synthea inpatient/emergency encounters are
classified by keyword and sent with their SNOMED code (system ``SCT``).
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Diagnosis:
    code: str            # ICD-10 code (or SNOMED code when unmapped)
    text: str            # upper-case Portuguese description
    system: str          # "ICD10" | "SCT"
    snomed: str | None = None
    snomed_display: str | None = None
    source: str = "synthea"   # "synthea" | "config"


# snomed: (admitting specialty or None, ICD-10, PT description)
SNOMED_MAP: dict[str, tuple[str | None, str, str]] = {
    # ---- respiratory
    "233604007": ("PNE", "J18.9", "PNEUMONIA, NAO ESPECIFICADA"),
    "840539006": ("PNE", "U07.1", "COVID-19"),
    "10509002": ("MED", "J20.9", "BRONQUITE AGUDA, NAO ESPECIFICADA"),
    "185086009": ("PNE", "J44.1", "DPOC COM EXACERBACAO AGUDA"),
    "87433001": ("PNE", "J43.9", "ENFISEMA PULMONAR"),
    "195967001": ("PNE", "J45.901", "ASMA COM EXACERBACAO AGUDA"),
    "389087006": ("PNE", "R09.02", "HIPOXEMIA"),
    "271825005": ("PNE", "R06.03", "SINDROME DE DIFICULDADE RESPIRATORIA"),
    "67782005": ("UCI", "J80", "SINDROME DE DIFICULDADE RESPIRATORIA AGUDA (ARDS)"),
    "254637007": ("PNE", "C34.90", "NEOPLASIA MALIGNA DO PULMAO"),
    "424132000": ("PNE", "C34.90", "CARCINOMA PULMONAR DE NAO PEQUENAS CELULAS"),
    "162573006": ("PNE", "R91.8", "ALTERACAO IMAGIOLOGICA PULMONAR - SUSPEITA NEOPLASIA"),
    # ---- cardiology
    "22298006": ("CAR", "I21.9", "ENFARTE AGUDO DO MIOCARDIO"),
    "401303003": ("CAR", "I21.3", "ENFARTE AGUDO DO MIOCARDIO COM SUPRA ST"),
    "401314000": ("CAR", "I21.4", "ENFARTE AGUDO DO MIOCARDIO SEM SUPRA ST"),
    "88805009": ("CAR", "I50.9", "INSUFICIENCIA CARDIACA CONGESTIVA"),
    "84114007": ("CAR", "I50.9", "INSUFICIENCIA CARDIACA"),
    "49436004": ("CAR", "I48.91", "FIBRILHACAO AURICULAR"),
    "414545008": ("CAR", "I25.9", "DOENCA CARDIACA ISQUEMICA CRONICA"),
    "53741008": ("CAR", "I25.10", "DOENCA ATEROSCLEROTICA CORONARIA"),
    "399211009": (None, "I25.2", "ENFARTE DO MIOCARDIO ANTIGO"),
    "59621000": (None, "I10", "HIPERTENSAO ESSENCIAL"),
    "38341003": (None, "I10", "HIPERTENSAO ARTERIAL"),
    # ---- neurology
    "230690007": ("NEU", "I63.9", "ACIDENTE VASCULAR CEREBRAL ISQUEMICO"),
    "128613002": ("NEU", "G40.909", "EPILEPSIA, NAO ESPECIFICADA"),
    "84757009": ("NEU", "G40.909", "EPILEPSIA"),
    "703151001": ("NEU", "R56.9", "CONVULSAO, NAO ESPECIFICADA"),
    "24700007": ("NEU", "G35", "ESCLEROSE MULTIPLA"),
    "62106007": ("NEU", "S06.0X0A", "CONCUSSAO SEM PERDA DE CONSCIENCIA"),
    "26929004": (None, "G30.9", "DOENCA DE ALZHEIMER"),
    "230265002": (None, "G30.9", "DOENCA DE ALZHEIMER FAMILIAR"),
    # ---- orthopaedics
    "359817006": ("ORT", "S72.009A", "FRATURA DO COLO DO FEMUR"),
    "65966004": ("ORT", "S52.90XA", "FRATURA DO ANTEBRACO"),
    "263102004": ("ORT", "S62.109A", "FRATURA DO PUNHO"),
    "16114001": ("ORT", "S82.899A", "FRATURA DO TORNOZELO"),
    "58150001": ("ORT", "S42.009A", "FRATURA DA CLAVICULA"),
    "33737001": ("ORT", "S22.39XA", "FRATURA DE COSTELA"),
    "1734006": ("ORT", "S32.009A", "FRATURA DA COLUNA LOMBAR"),
    "239873007": ("ORT", "M17.9", "GONARTROSE"),
    "239872002": ("ORT", "M16.9", "COXARTROSE"),
    "444470001": ("ORT", "S83.509A", "LESAO DO LIGAMENTO CRUZADO ANTERIOR"),
    "39848009": ("ORT", "S13.4XXA", "ENTORSE CERVICAL (WHIPLASH)"),
    "64859006": (None, "M81.0", "OSTEOPOROSE"),
    # ---- general surgery
    "74400008": ("CIR", "K35.80", "APENDICITE AGUDA"),
    "68496003": ("CIR", "K63.5", "POLIPO DO COLON"),
    "363406005": ("CIR", "C18.9", "NEOPLASIA MALIGNA DO COLON"),
    "254837009": ("CIR", "C50.919", "NEOPLASIA MALIGNA DA MAMA"),
    "126906006": ("CIR", "C61", "NEOPLASIA MALIGNA DA PROSTATA"),
    "235919008": ("CIR", "K80.20", "LITIASE DA VESICULA BILIAR"),
    "396275006": (None, "M19.90", "OSTEOARTROSE"),
    # ---- intensive care
    "91302008": ("UCI", "A41.9", "SEPSIS, NAO ESPECIFICADA"),
    "770349000": ("UCI", "A41.89", "SEPSIS DE ORIGEM VIRAL"),
    "76571007": ("UCI", "R65.21", "CHOQUE SETICO"),
    "55680006": ("UCI", "T50.901A", "INTOXICACAO MEDICAMENTOSA"),
    # ---- internal medicine
    "45816000": ("MED", "N10", "PIELONEFRITE AGUDA"),
    "68566005": ("MED", "N39.0", "INFECAO DO TRATO URINARIO"),
    "197927001": ("MED", "N39.0", "INFECAO URINARIA RECORRENTE"),
    "307426000": ("MED", "N30.00", "CISTITE AGUDA"),
    "271737000": ("MED", "D64.9", "ANEMIA, NAO ESPECIFICADA"),
    "7200002": ("MED", "F10.20", "DEPENDENCIA ALCOOLICA"),
    "433144002": ("MED", "N18.3", "DOENCA RENAL CRONICA ESTADIO 3"),
    "431857002": ("MED", "N18.4", "DOENCA RENAL CRONICA ESTADIO 4"),
    "46177005": ("MED", "N18.6", "DOENCA RENAL CRONICA TERMINAL"),
    "431855005": (None, "N18.1", "DOENCA RENAL CRONICA ESTADIO 1"),
    "431856006": (None, "N18.2", "DOENCA RENAL CRONICA ESTADIO 2"),
    "44054006": (None, "E11.9", "DIABETES MELLITUS TIPO 2"),
    "15777000": (None, "R73.03", "PRE-DIABETES"),
    "162864005": (None, "E66.9", "OBESIDADE"),
    "408512008": (None, "E66.01", "OBESIDADE MORBIDA"),
    "55822004": (None, "E78.5", "HIPERLIPIDEMIA"),
    "40930008": (None, "E03.9", "HIPOTIROIDISMO"),
    "370143000": (None, "F32.9", "DEPRESSAO MAJOR"),
}

# Keyword classification for SNOMED codes not present in SNOMED_MAP.
KEYWORDS: list[tuple[str, str]] = [
    (r"sepsis|septic|shock|respiratory failure|ards", "UCI"),
    (r"fracture|sprain|dislocation|arthro|ligament|osteoarthritis", "ORT"),
    (r"myocard|heart|cardiac|atrial|coronary|angina|arrhythm", "CAR"),
    (r"stroke|cerebr|seizure|epilep|sclerosis|concussion|neuro", "NEU"),
    (r"pneumon|bronch|pulmon|lung|respir|asthma|emphysema|covid|hypox", "PNE"),
    (r"appendic|neoplasm|tumou?r|carcinoma|polyp|hernia|cholecyst|gallbladder|bowel", "CIR"),
]

_SEMANTIC_TAG = re.compile(r"\s*\((disorder|finding|situation|morphologic abnormality|event|procedure)\)\s*$")


def clean_display(display: str | None) -> str:
    return _SEMANTIC_TAG.sub("", display or "").strip()


def classify(snomed: str, display: str | None, from_encounter: bool) -> tuple[str | None, Diagnosis | None]:
    """Return (admitting specialty, diagnosis) for a SNOMED code.

    ``from_encounter`` marks reasons of Synthea inpatient/emergency encounters:
    those are admission-worthy even when not in the explicit table.
    """
    display = clean_display(display)
    if snomed in SNOMED_MAP:
        specialty, icd, text = SNOMED_MAP[snomed]
        return specialty, Diagnosis(icd, text, "ICD10", snomed, display)
    if not from_encounter:
        return None, None
    lowered = display.lower()
    for pattern, specialty in KEYWORDS:
        if re.search(pattern, lowered):
            return specialty, Diagnosis(snomed, display.upper(), "SCT", snomed, display)
    return "MED", Diagnosis(snomed, display.upper(), "SCT", snomed, display)


def comorbidity(snomed: str, display: str | None) -> Diagnosis | None:
    """Chronic conditions worth sending as secondary DG1 segments."""
    if snomed in SNOMED_MAP:
        _, icd, text = SNOMED_MAP[snomed]
        return Diagnosis(icd, text, "ICD10", snomed, clean_display(display))
    return None
