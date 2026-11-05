from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType
from typing import Any

BASE_DIR = Path(__file__).resolve().parent


def _load_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


hl7 = _load_module("hl7_segments", BASE_DIR / "models" / "hl7-segments.py")
fhir = _load_module("fhir_resources", BASE_DIR / "models" / "fhir-resources.py")


SEGMENT_PARSERS = {
    "MSH": hl7.parse_msh,
    "PID": hl7.parse_pid,
    "EVN": hl7.parse_evn,
    "PV1": hl7.parse_pv1,
    "PV2": hl7.parse_pv2,
    "ROL": hl7.parse_rol,
    "NK1": hl7.parse_nk1,
    "AL1": hl7.parse_al1,
    "OBX": hl7.parse_obx,
    "DG1": hl7.parse_dg1,
    "PR1": hl7.parse_pr1,
    "GT1": hl7.parse_gt1,
    "IN1": hl7.parse_in1,
    "IN2": hl7.parse_in2,
    "ACC": hl7.parse_acc,
}


def _decode(value: str | None) -> str | None:
    if not value:
        return None
    replacements = {
        "\\F\\": "|",
        "\\S\\": "^",
        "\\T\\": "&",
        "\\R\\": "~",
        "\\E\\": "\\",
    }
    for source, target in replacements.items():
        value = value.replace(source, target)

    def decode_hex(match: re.Match[str]) -> str:
        try:
            return bytes.fromhex(match.group(1)).decode("latin-1")
        except (ValueError, UnicodeDecodeError):
            return match.group(0)

    return re.sub(r"\\X([0-9A-Fa-f]+)\\", decode_hex, value)


def _timestamp(value: str | None) -> str | None:
    if not value:
        return None
    value = value.split(".", 1)[0]
    for length, fmt in ((14, "%Y%m%d%H%M%S"), (12, "%Y%m%d%H%M"), (8, "%Y%m%d")):
        if len(value) >= length:
            try:
                parsed = datetime.strptime(value[:length], fmt)
                if length == 8:
                    return parsed.date().isoformat()
                return parsed.isoformat() + "Z"
            except ValueError:
                continue
    return value


def _components(value: str | None) -> list[str]:
    return [_decode(part) or "" for part in (value or "").split("^")]


def _component(parts: list[str], index: int) -> str:
    return parts[index] if index < len(parts) else ""


def _repetitions(value: str | None) -> list[str]:
    return [_decode(part) or "" for part in (value or "").split("~") if part]


def _codeable(value: str | None, system: str | None = None) -> fhir.CodeableConcept:
    parts = _components(value)
    code = _component(parts, 0) or None
    text = _component(parts, 1) or None
    coding_system = system or (_component(parts, 2) or None)
    coding = (
        [fhir.Coding(system=coding_system, code=code, display=text)] if code else []
    )
    return fhir.CodeableConcept(coding=coding, text=text)


def _reference(
    resource_type: str, resource_id: str, display: str | None = None
) -> fhir.Reference:
    return fhir.Reference(reference=f"{resource_type}/{resource_id}", display=display)


def _safe_id(value: str | None, fallback: str) -> str:
    value = re.sub(r"[^A-Za-z0-9.-]+", "-", value or "").strip("-")
    return value or fallback


def normalize_message(message: str) -> list[str]:
    """Normalize CR/LF input and join source-code-wrapped continuation lines."""
    normalized: list[str] = []
    for line in re.split(r"\r\n|\r|\n", message):
        line = line.strip()
        if not line:
            continue
        if re.match(r"^[A-Z0-9]{3}\|", line):
            normalized.append(line)
        elif normalized:
            normalized[-1] += line
        else:
            raise ValueError("HL7 message must start with an MSH segment")
    return normalized


def parse_hl7(message: str) -> dict[str, list[Any]]:
    """Parse an HL7 v2 message into typed segment objects grouped by segment name."""
    parsed: dict[str, list[Any]] = {}
    for line in normalize_message(message):
        fields = line.split("|")
        segment_name = fields[0]
        parser = SEGMENT_PARSERS.get(segment_name)
        if parser is None:
            continue
        minimum_fields = {"MSH": 13, "PID": 17}.get(segment_name, len(fields))
        fields.extend([""] * (minimum_fields - len(fields)))
        parsed.setdefault(segment_name, []).append(parser(fields))
    if "MSH" not in parsed or "PID" not in parsed:
        raise ValueError("The message must contain MSH and PID segments")
    return parsed


IDENTIFIER_TYPE_MAP = {
    "NS": ("MR", "Medical record number"),
    "SNS": ("SB", "Social Beneficiary Identifier"),
}

MARITAL_STATUS_MAP = {
    "M": ("M", "Married"),
    "CASADO": ("M", "Married"),
    "CASADA": ("M", "Married"),
    "S": ("S", "Never Married"),
    "SOLTEIRO": ("S", "Never Married"),
    "SOLTEIRA": ("S", "Never Married"),
    "D": ("D", "Divorced"),
    "DIVORCIADO": ("D", "Divorced"),
    "DIVORCIADA": ("D", "Divorced"),
    "W": ("W", "Widowed"),
    "VIUVO": ("W", "Widowed"),
    "VIUVA": ("W", "Widowed"),
    "L": ("L", "Legally Separated"),
    "SEPARADO": ("L", "Legally Separated"),
    "SEPARADA": ("L", "Legally Separated"),
    "A": ("A", "Annulled"),
    "ANULADO": ("A", "Annulled"),
    "U": ("U", "unmarried"),
    "DESCONHECIDO": ("U", "unmarried"),
}

ENCOUNTER_CLASS_MAP = {
    "INT": ("IMP", "inpatient encounter"),
    "I": ("IMP", "inpatient encounter"),
    "IMP": ("IMP", "inpatient encounter"),
    "EMER": ("EMER", "emergency"),
    "E": ("EMER", "emergency"),
    "U": ("EMER", "emergency"),
    "AMB": ("AMB", "ambulatory"),
    "O": ("AMB", "ambulatory"),
    "A": ("AMB", "ambulatory"),
    "HH": ("HH", "home health"),
    "VR": ("VR", "virtual"),
    "OBSENC": ("OBSENC", "observation encounter"),
    "ACUTE": ("ACUTE", "inpatient acute"),
    "NONAC": ("NONAC", "inpatient non-acute"),
    "SS": ("SS", "short stay"),
}


def _deterministic_uuid(key: str) -> str:
    digest = bytearray(hashlib.md5(key.encode("utf-8")).digest())
    digest[6] = (digest[6] & 0x0F) | 0x30
    digest[8] = (digest[8] & 0x3F) | 0x80
    return str(uuid.UUID(bytes=bytes(digest)))


def _patient(pid: Any) -> fhir.Patient:
    sns_val: str | None = None
    ns_val: str | None = None
    first_val: str | None = None
    patient_id = str(uuid.uuid4())
    identifiers = []
    for raw_identifier in _repetitions(pid.patient_id):
        parts = _components(raw_identifier)
        val = _component(parts, 0) or None
        sys_val = _component(parts, 3)
        type_code = _component(parts, 4)
        if val:
            if not first_val:
                first_val = val
            upper_type = (type_code or "").upper()
            upper_sys = (sys_val or "").upper()
            if upper_type in ("SNS", "SB") or upper_sys == "HAS":
                sns_val = val
            elif upper_type in ("NS", "MR") or upper_sys == "HOS":
                ns_val = val
        if type_code:
            if type_code in IDENTIFIER_TYPE_MAP:
                mapped_code, display = IDENTIFIER_TYPE_MAP[type_code]
                type_concept = fhir.CodeableConcept(
                    coding=[
                        fhir.Coding(
                            system="http://terminology.hl7.org/CodeSystem/v2-0203",
                            code=mapped_code,
                            display=display,
                        )
                    ],
                    text=type_code,
                )
            else:
                type_concept = fhir.CodeableConcept(
                    coding=[
                        fhir.Coding(
                            system="http://terminology.hl7.org/CodeSystem/v2-0203",
                            code=type_code,
                        )
                    ],
                    text=type_code,
                )
        else:
            type_concept = None

        identifiers.append(
            fhir.Identifier(
                value=val,
                system=f"urn:id:{sys_val}" if sys_val else None,
                type=type_concept,
            )
        )

    primary_patient_key = sns_val or ns_val or first_val
    patient_id = (
        _deterministic_uuid(f"Patient:{primary_patient_key}")
        if primary_patient_key
        else str(uuid.uuid4())
    )

    names = []
    for raw_name in _repetitions(pid.patient_name):
        parts = _components(raw_name)
        given = [p for p in parts[1:3] if p]
        names.append(
            fhir.HumanName(
                use="official",
                family=_component(parts, 0) or None,
                given=given if given else None,
            )
        )

    address = _components(pid.address)
    addresses = (
        [
            fhir.Address(
                line=[_component(address, 0)] if _component(address, 0) else None,
                city=_component(address, 2) or None,
                state=_component(address, 3) or None,
                postalCode=_component(address, 4) or None,
                country=_component(address, 5) or None,
            )
        ]
        if pid.address
        else None
    )

    telecom = []
    if pid.home_phone:
        telecom.append(
            fhir.ContactPoint(system="phone", value=_decode(pid.home_phone), use="home")
        )

    gender = {"M": "male", "F": "female", "O": "other", "U": "unknown"}.get(
        pid.gender, "unknown"
    )

    marital_status_val = pid.marital_status.strip() if pid.marital_status else None
    if marital_status_val:
        ms_key = marital_status_val.upper()
        if ms_key in MARITAL_STATUS_MAP:
            ms_code, ms_display = MARITAL_STATUS_MAP[ms_key]
            marital_status_concept = fhir.CodeableConcept(
                coding=[
                    fhir.Coding(
                        system="http://terminology.hl7.org/CodeSystem/v3-MaritalStatus",
                        code=ms_code,
                        display=ms_display,
                    )
                ],
                text=marital_status_val,
            )
        else:
            marital_status_concept = fhir.CodeableConcept(
                coding=[
                    fhir.Coding(
                        system="http://terminology.hl7.org/CodeSystem/v3-NullFlavor",
                        code="UNK",
                        display="unknown",
                    )
                ],
                text=marital_status_val,
            )
    else:
        marital_status_concept = None

    given_names = (names[0].given or []) if names else []
    family_name = [names[0].family] if (names and names[0].family) else []
    patient_name_str = " ".join([*given_names, *family_name]).strip() or "Patient"
    patient_text = {
        "status": "generated",
        "div": f'<div xmlns="http://www.w3.org/1999/xhtml"><p>{patient_name_str}</p></div>',
    }

    return fhir.Patient(
        id=patient_id,
        text=patient_text,
        identifier=identifiers if identifiers else None,
        name=names if names else None,
        birthDate=(_timestamp(pid.date_of_birth) or "").split("T", 1)[0] or None,
        gender=gender,
        address=addresses,
        telecom=telecom if telecom else None,
        maritalStatus=marital_status_concept,
    )


def _location(pv1: Any) -> fhir.Location | None:
    if not pv1.assigned_patient_location:
        return None
    parts = _components(pv1.assigned_patient_location)
    name = "-".join(part for part in parts[:3] if part) or _decode(
        pv1.assigned_patient_location
    )
    return fhir.Location(
        id=_safe_id(name, "location"),
        name=name,
        status="active",
        mode="instance",
        type=[_codeable(parts[0] if parts else None)],
        physicalType=_codeable(
            "bd", "http://terminology.hl7.org/CodeSystem/location-physical-type"
        ),
    )


def _encounter(
    msh: Any, evn: Any, pv1: Any, patient: fhir.Patient, location: Any = None
) -> fhir.Encounter:
    encounter_id = str(uuid.uuid4())
    event = _components(msh.message_type)
    event_code = event[1] if len(event) > 1 else (evn.event_type_code if evn else None)
    status = "finished" if event_code == "A03" else "in-progress"

    location_parts = _components(pv1.assigned_patient_location)
    encounter_location = None
    if pv1.assigned_patient_location:
        if len(location_parts) >= 3 and all(location_parts[:3]):
            location_display = f"Ward {location_parts[0]}, Room {location_parts[1]}, Bed {location_parts[2]}"
        else:
            location_display = "-".join(part for part in location_parts if part)
        encounter_location = [
            fhir.EncounterLocation(
                location=fhir.Reference(
                    display=location_display,
                )
            )
        ]

    participants = None
    if pv1.attending_doctor:
        raw_doctor = _repetitions(pv1.attending_doctor)[0]
        parts = _components(raw_doctor)
        display = f"{_component(parts, 2)} {_component(parts, 1)}".strip()
        participants = [
            fhir.EncounterParticipant(
                type=[
                    fhir.CodeableConcept(
                        coding=[
                            fhir.Coding(
                                system="http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                                code="ATND",
                                display="attender",
                            )
                        ]
                    )
                ],
                individual=fhir.Reference(display=display),
            )
        ]

    identifiers = None
    if pv1.visit_number:
        visit_val = _component(_components(pv1.visit_number), 0)
        identifiers = [
            fhir.Identifier(
                value=visit_val,
                type=fhir.CodeableConcept(
                    coding=[
                        fhir.Coding(
                            system="http://terminology.hl7.org/CodeSystem/v2-0203",
                            code="VN",
                            display="Visit number",
                        )
                    ]
                ),
            )
        ]

    period = None
    if pv1.admit_datetime or pv1.discharge_datetime:
        period = fhir.Period(
            start=_timestamp(pv1.admit_datetime) if pv1.admit_datetime else None,
            end=_timestamp(pv1.discharge_datetime) if pv1.discharge_datetime else None,
        )

    encounter_class = None
    if pv1.patient_class:
        raw_class = pv1.patient_class.strip()
        class_key = raw_class.upper()
        if class_key in ENCOUNTER_CLASS_MAP:
            cls_code, cls_display = ENCOUNTER_CLASS_MAP[class_key]
            encounter_class = [
                fhir.CodeableConcept(
                    coding=[
                        fhir.Coding(
                            system="http://terminology.hl7.org/CodeSystem/v3-ActCode",
                            code=cls_code,
                            display=cls_display,
                        )
                    ]
                )
            ]
        else:
            encounter_class = [
                fhir.CodeableConcept(
                    coding=[
                        fhir.Coding(
                            system="http://terminology.hl7.org/CodeSystem/v3-ActCode",
                            code=raw_class,
                        )
                    ],
                    text=raw_class,
                )
            ]

    encounter_text = {
        "status": "generated",
        "div": f'<div xmlns="http://www.w3.org/1999/xhtml"><p>Encounter: {status}</p></div>',
    }

    return fhir.Encounter(
        id=encounter_id,
        text=encounter_text,
        status=status,
        class_=encounter_class[0].coding[0]
        if encounter_class and encounter_class[0].coding
        else None,
        identifier=identifiers,
        subject=fhir.Reference(reference=f"Patient/{patient.id}"),
        participant=participants,
        location=encounter_location,
        period=period,
    )


def _practitioners(pv1: Any, roles: list[Any]) -> list[fhir.Practitioner]:
    values = [pv1.admitting_doctor or pv1.attending_doctor]
    practitioners = []
    seen = set()
    for value in values:
        for raw_person in _repetitions(value):
            parts = _components(raw_person)
            identifier = _component(parts, 0)
            system = _component(parts, 8)
            key = (identifier, system)
            if not identifier or key in seen:
                continue
            seen.add(key)
            practitioners.append(
                fhir.Practitioner(
                    id=_safe_id(identifier, "practitioner"),
                    identifier=[
                        fhir.Identifier(
                            value=identifier,
                            system=f"urn:id:{system}" if system else None,
                        )
                    ],
                    name=[
                        fhir.HumanName(
                            text=f"{_component(parts, 2)} {_component(parts, 1)}".strip(),
                            family=_component(parts, 1) or None,
                            given=[_component(parts, 2)]
                            if _component(parts, 2)
                            else [],
                        )
                    ],
                    active=True,
                )
            )
    return practitioners


def _conditions(
    diagnoses: list[Any], patient: fhir.Patient, encounter: fhir.Encounter
) -> list[fhir.Condition]:
    conditions = []
    for index, diagnosis in enumerate(diagnoses, 1):
        parts = _components(diagnosis.diagnosis_code)
        code = _component(parts, 0)
        display = _component(parts, 1) or diagnosis.diagnosis_description
        visit_value = encounter.identifier[0].value if encounter.identifier else None
        system = {
            "ICD10": "http://hl7.org/fhir/sid/icd-10-cm",
        }.get(_component(parts, 2), "http://hl7.org/fhir/sid/icd-10-cm")
        conditions.append(
            fhir.Condition(
                id=_deterministic_uuid(
                    f"Condition:{patient.id}:{visit_value or encounter.id}:{code or index}"
                ),
                identifier=[
                    fhir.Identifier(
                        type=fhir.CodeableConcept(
                            coding=[
                                fhir.Coding(
                                    system="http://terminology.hl7.org/CodeSystem/v2-0203",
                                    code="VN",
                                    display="Visit number",
                                )
                            ]
                        ),
                        system="urn:id:HOS",
                        value=_component(_components(visit_value), 0)
                        if visit_value
                        else None,
                    ),
                    fhir.Identifier(
                        system="urn:id:extID",
                        value=f"{code}-{_component(parts, 2)}"
                        if _component(parts, 2)
                        else code,
                    ),
                ],
                clinicalStatus=_codeable(
                    "active", "http://terminology.hl7.org/CodeSystem/condition-clinical"
                ),
                verificationStatus=_codeable(
                    "confirmed",
                    "http://terminology.hl7.org/CodeSystem/condition-ver-status",
                ),
                category=[
                    fhir.CodeableConcept(
                        coding=[
                            fhir.Coding(
                                system="http://terminology.hl7.org/CodeSystem/condition-category",
                                code="encounter-diagnosis",
                                display="Encounter Diagnosis",
                            )
                        ],
                        text="Encounter Diagnosis",
                    )
                ],
                code=fhir.CodeableConcept(
                    coding=[
                        fhir.Coding(system=system, code=code, display=display),
                        fhir.Coding(code=_component(parts, 3))
                        if _component(parts, 3)
                        else fhir.Coding(),
                    ],
                    text=display,
                ),
                subject=_reference("Patient", patient.id or "patient"),
                encounter=_reference("Encounter", encounter.id or "encounter"),
                onsetDateTime=_timestamp(diagnosis.diagnosis_datetime),
            )
        )
    return conditions


def _allergies(
    allergies: list[Any], patient: fhir.Patient, encounter: fhir.Encounter
) -> list[fhir.AllergyIntolerance]:
    return [
        fhir.AllergyIntolerance(
            id=f"allergy-{allergy.set_id or index}",
            clinicalStatus=_codeable(
                "active",
                "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
            ),
            verificationStatus=_codeable(
                "confirmed",
                "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
            ),
            category=["medication" if allergy.set_id == "1" else "environment"],
            code=fhir.CodeableConcept(
                text=_component(_components(allergy.allergen_code), 1)
            ),
            patient=_reference("Patient", patient.id or "patient"),
            encounter=_reference("Encounter", encounter.id or "encounter"),
            reaction=[
                fhir.AllergyReaction(
                    manifestation=[
                        fhir.CodeableConcept(text=reaction)
                        for reaction in _repetitions(allergy.allergy_reaction)
                        if reaction
                    ]
                )
            ]
            if allergy.allergy_reaction
            else [],
        )
        for index, allergy in enumerate(allergies, 1)
        if allergy.allergen_code
    ]


def _related_people(
    nk1: list[Any], gt1: list[Any], patient: fhir.Patient
) -> list[fhir.RelatedPerson]:
    people = []
    for source, relationship in ((gt1, "GT"), (nk1, "SPS")):
        for index, person in enumerate(source, 1):
            parts = _components(
                person.guarantor_name
                if hasattr(person, "guarantor_name")
                else person.name
            )
            people.append(
                fhir.RelatedPerson(
                    id=f"related-person-{len(people) + 1}",
                    active=True,
                    patient=_reference("Patient", patient.id or "patient"),
                    relationship=[_codeable(relationship)],
                    name=[
                        fhir.HumanName(
                            use="official",
                            family=_component(parts, 0) or None,
                            given=[part for part in parts[1:3] if part],
                        )
                    ],
                )
            )
    return people


def _observations(
    observations: list[Any], patient: fhir.Patient, encounter: fhir.Encounter
) -> list[fhir.Observation]:
    return [
        fhir.Observation(
            id=f"observation-{observation.set_id or index}",
            status="final"
            if observation.observation_result_status == "F"
            else "unknown",
            code=_codeable(observation.observation_identifier),
            subject=_reference("Patient", patient.id or "patient"),
            encounter=_reference("Encounter", encounter.id or "encounter"),
            valueString=observation.observation_value,
            effectiveDateTime=_timestamp(observation.date_last_observed),
        )
        for index, observation in enumerate(observations, 1)
        if observation.observation_identifier
    ]


def _procedures(
    procedures: list[Any],
    patient: fhir.Patient,
    encounter: fhir.Encounter,
    message_datetime: str,
) -> list[fhir.Procedure]:
    return [
        fhir.Procedure(
            id=f"procedure-{procedure.set_id or index}",
            identifier=[
                fhir.Identifier(system="urn:id:extID", value=message_datetime),
                fhir.Identifier(
                    type=fhir.CodeableConcept(
                        coding=[
                            fhir.Coding(
                                system="http://terminology.hl7.org/CodeSystem/v2-0203",
                                code="VN",
                                display="Visit number",
                            )
                        ]
                    ),
                    system="urn:id:HOS",
                    value=encounter.identifier[0].value
                    if encounter.identifier
                    else None,
                ),
            ],
            status="unknown",
            code=_codeable(procedure.procedure_code),
            subject=_reference("Patient", patient.id or "patient"),
            encounter=_reference("Encounter", encounter.id or "encounter"),
            performedDateTime=_timestamp(procedure.procedure_datetime),
        )
        for index, procedure in enumerate(procedures, 1)
        if procedure.procedure_code
    ]


def _coverage(
    insurances: list[Any], patient: fhir.Patient
) -> tuple[list[fhir.Coverage], list[fhir.Organization]]:
    coverages = []
    organizations = []
    for index, insurance in enumerate(insurances, 1):
        company = (
            _components(insurance.insurance_company_id)
            if insurance.insurance_company_id
            else []
        )
        plan = (
            _components(insurance.insurance_plan_id)
            if insurance.insurance_plan_id
            else []
        )
        organization_id = _safe_id(company[0] if company else None, f"insurer-{index}")
        if company:
            organizations.append(
                fhir.Organization(
                    id=organization_id,
                    identifier=[fhir.Identifier(value=insurance.insurance_plan_id)],
                    active=True,
                    name=insurance.insurance_company_name
                    or _component(company, 1)
                    or None,
                )
            )
        coverages.append(
            fhir.Coverage(
                id=f"coverage-{insurance.set_id or index}",
                identifier=[
                    fhir.Identifier(
                        type=fhir.CodeableConcept(
                            coding=[
                                fhir.Coding(
                                    system="http://terminology.hl7.org/CodeSystem/v2-0203",
                                    code="XV",
                                    display="Health Plan Identifier",
                                )
                            ]
                        ),
                        system="urn:id:HOS",
                        value=_component(plan, 0),
                    )
                ]
                if plan
                else [],
                status="active",
                type=_codeable(insurance.plan_type) if insurance.plan_type else None,
                beneficiary=_reference("Patient", patient.id or "patient"),
                payor=[
                    _reference(
                        "Organization",
                        organization_id,
                        insurance.insurance_company_name,
                    )
                ]
                if company
                else [],
                subscriberId=insurance.insured_id_number,
                order=index,
                class_=[
                    fhir.CoverageClass(
                        type=_codeable("plan"), value=insurance.insurance_plan_id
                    )
                ]
                if insurance.insurance_plan_id
                else [],
            )
        )
    return coverages, organizations


def convert_hl7_to_fhir(message: str) -> fhir.Bundle:
    segments = parse_hl7(message)
    msh = segments["MSH"][0]
    pid = segments["PID"][0]
    evn = segments.get("EVN", [hl7.EVNSegment()])[0]
    pv1 = segments.get("PV1", [hl7.PV1Segment()])[0]
    patient = _patient(pid)
    encounter = _encounter(msh, evn, pv1, patient)

    conditions = _conditions(segments.get("DG1", []), patient, encounter)
    resources: list[fhir.FHIRModel] = [patient, encounter, *conditions]
    timestamp_str = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    return fhir.Bundle(
        type="collection",
        timestamp=timestamp_str,
        entry=[
            fhir.BundleEntry(
                fullUrl=f"http://example.org/fhir/{resource.resource_type}/{resource.id}",
                resource=resource,
            )
            for resource in resources
        ],
    )


def convert_file(path: str | Path) -> dict[str, Any]:
    bundle = convert_hl7_to_fhir(Path(path).read_text(encoding="utf-8"))
    return bundle.model_dump(by_alias=True, exclude_none=True, mode="json")


def _resolve_message_path(path: str | Path) -> Path:
    message_path = Path(path)
    if message_path.exists() or message_path.is_absolute():
        return message_path
    return BASE_DIR / message_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert an HL7 v2 ADT message to a FHIR R4 Bundle"
    )
    parser.add_argument(
        "message", nargs="?", help="HL7 file path; reads stdin when omitted"
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Write the FHIR Bundle to this JSON file instead of stdout",
    )
    parser.add_argument(
        "--worker",
        action="store_true",
        help="Run as a persistent JSON-lines stdin/stdout worker",
    )
    args = parser.parse_args()
    if args.worker:
        import sys

        for raw_line in sys.stdin:
            raw_line = raw_line.strip()
            if not raw_line:
                continue
            try:
                req = json.loads(raw_line)
                hl7_msg = req.get("hl7", "")
                bundle_dict = convert_hl7_to_fhir(hl7_msg).model_dump(
                    by_alias=True, exclude_none=True, mode="json"
                )
                sys.stdout.write(json.dumps({"ok": True, "bundle": bundle_dict}) + "\n")
                sys.stdout.flush()
            except Exception as exc:
                sys.stdout.write(json.dumps({"ok": False, "error": str(exc)}) + "\n")
                sys.stdout.flush()
        return
    message = (
        _resolve_message_path(args.message).read_text(encoding="utf-8")
        if args.message
        else __import__("sys").stdin.read()
    )
    output = json.dumps(
        convert_hl7_to_fhir(message).model_dump(
            by_alias=True, exclude_none=True, mode="json"
        ),
        indent=2,
    )
    if args.output:
        args.output.write_text(output + "\n", encoding="utf-8")
    else:
        print(output)


if __name__ == "__main__":
    main()
