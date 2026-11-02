"""FHIR R4 output.

* ``hospital-locations.json``  Organization + Location hierarchy (ward ->
  room -> bed/stretcher, with the bed status at the end of the simulation)
  + Practitioners. Load this one first.
* ``patients/<NS>.json``       the patient's Synthea bundle, rewritten with the
  Portuguese identity (same NS/SNS/processo/NIF/name as the HL7 messages) and
  enriched with one inpatient Encounter per simulated episode (location
  history, service segments, admission diagnosis, discharge disposition).

All bundles are ``transaction`` bundles ready to POST to the HAPI FHIR server
of the main app (http://localhost:8081/fhir).
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from .hospital import Bed, Hospital
from .identity import PatientIdentity, Staff
from .simulation import Episode, Movement
from .synthea import PoolPatient

NS_UUID = uuid.UUID("6f0e4b9a-3c55-4f6e-9a54-0e5a0f1d2b10")
V2_0203 = "http://terminology.hl7.org/CodeSystem/v2-0203"
CONDITIONAL_PREFIXES = ("Organization?", "Practitioner?", "PractitionerRole?", "Location?")

DISCHARGE_FHIR = {
    "01": "home", "06": "home", "03": "snf", "04": "long", "02": "other-hcf", "07": "aadvice", "20": "exp",
}
MARITAL_FHIR = {"S": "S", "M": "M", "D": "D", "W": "W", "L": "L"}


def iso(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%S")


def put_entry(resource: dict) -> dict:
    rid = f"{resource['resourceType']}/{resource['id']}"
    return {
        "fullUrl": f"urn:uuid:{uuid.uuid5(NS_UUID, rid)}",
        "resource": resource,
        "request": {"method": "PUT", "url": rid},
    }


def _ident(system: str, value: str, code: str, display: str, text: str, use: str | None = None) -> dict:
    ident = {"system": system, "value": value,
             "type": {"coding": [{"system": V2_0203, "code": code, "display": display}], "text": text}}
    if use:
        ident["use"] = use
    return ident


# ---------------------------------------------------------------------- scrubbing
def _has_conditional_ref(obj: Any) -> bool:
    if isinstance(obj, dict):
        ref = obj.get("reference")
        if isinstance(ref, str) and ref.startswith(CONDITIONAL_PREFIXES):
            return True
        return any(_has_conditional_ref(v) for v in obj.values())
    if isinstance(obj, list):
        return any(_has_conditional_ref(v) for v in obj)
    return False


def _scrub(obj: dict) -> None:
    """Remove references to US organizations/practitioners that Synthea leaves as
    conditional references (we disabled their export)."""
    for key in list(obj):
        value = obj[key]
        if isinstance(value, dict):
            if "reference" in value and _has_conditional_ref(value):
                del obj[key]
            elif _has_conditional_ref(value):
                _scrub(value)
        elif isinstance(value, list):
            kept = [v for v in value if not _has_conditional_ref(v)]
            if kept:
                obj[key] = kept
            else:
                del obj[key]


# ---------------------------------------------------------------------- patient
def portuguese_patient(resource: dict, p: PatientIdentity, deceased_at: datetime | None) -> dict:
    a = p.address
    telecom = [{"system": "phone", "value": p.phone, "use": "mobile" if p.phone.startswith("9") else "home"}]
    if p.email:
        telecom.append({"system": "email", "value": p.email, "use": "home"})
    patient = {
        "resourceType": "Patient",
        "id": resource.get("id"),
        "meta": {"tag": [{"system": "urn:pfgen", "code": "synthetic"}]},
        "text": {"status": "generated", "div": f'<div xmlns="http://www.w3.org/1999/xhtml"><p>{p.full_name}</p></div>'},
        "identifier": [
            _ident("urn:id:HOS", p.ns, "MR", "Medical record number", "NS", "usual"),
            _ident("urn:id:HAS", p.sns, "SB", "Social Beneficiary Identifier", "SNS"),
            _ident("urn:id:HOS:processo", p.processo, "PI", "Patient internal identifier", "PROCESSO"),
            _ident("urn:id:AT", p.nif, "TAX", "Tax ID number", "NIF"),
        ],
        "active": True,
        "name": [{"use": "official", "text": p.full_name, "family": p.family, "given": list(p.given)}],
        "telecom": telecom,
        "gender": "male" if p.sex == "M" else "female",
        "birthDate": p.birth_date.isoformat(),
        "address": [{
            "use": "home", "line": [a.street], "city": a.locality, "district": a.concelho,
            "state": a.district, "postalCode": a.postal_code, "country": a.country,
        }],
        "maritalStatus": {
            "coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus",
                        "code": MARITAL_FHIR[p.marital_code]}],
            "text": p.marital_text,
        },
        "communication": [{"language": {"coding": [{"system": "urn:ietf:bcp:47", "code": "pt-PT",
                                                    "display": "Portuguese (Portugal)"}]}, "preferred": True}],
    }
    if deceased_at:
        patient["deceasedDateTime"] = iso(deceased_at)
    if not patient["id"]:
        del patient["id"]
    return patient


def _location_entry(m: Movement, end: datetime | None) -> dict:
    return {
        "location": {"reference": f"Location/{m.bed.fhir_id}", "display": m.bed.display()},
        "status": "completed" if m.end else "active",
        "physicalType": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/location-physical-type",
                                     "code": "bd", "display": "Bed"}]},
        "period": {"start": iso(m.start), **({"end": iso(m.end)} if m.end else {})},
    }


def _service(ward) -> dict:
    return {"coding": [{"system": "urn:id:HOS:servico", "code": ward.code, "display": ward.name}], "text": ward.name}


def episode_resources(ep: Episode, patient_ref: str) -> list[dict]:
    if not ep.number or not ep.admit_time:
        return []
    enc_id = f"ep-{ep.number}"
    d = ep.diagnosis
    codings = [{"system": "http://hl7.org/fhir/sid/icd-10" if d.system == "ICD10" else "http://snomed.info/sct",
                "code": d.code, "display": d.text}]
    if d.snomed and d.system == "ICD10":
        codings.append({"system": "http://snomed.info/sct", "code": d.snomed, "display": d.snomed_display})
    finished = ep.state == "discharged"

    condition = {
        "resourceType": "Condition",
        "id": f"{enc_id}-dx",
        "clinicalStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                                       "code": "resolved" if finished and not ep.dies else "active"}]},
        "verificationStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-ver-status",
                                           "code": "confirmed"}]},
        "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-category",
                                  "code": "encounter-diagnosis", "display": "Encounter Diagnosis"}]}],
        "code": {"coding": codings, "text": d.text},
        "subject": {"reference": patient_ref},
        "encounter": {"reference": f"Encounter/{enc_id}"},
        "recordedDate": iso(ep.admit_time),
    }

    first_service = ep.movements[0].service if ep.movements else ep.service
    encounter: dict[str, Any] = {
        "resourceType": "Encounter",
        "id": enc_id,
        "identifier": [{"use": "official", "system": "urn:id:HOS:episodio", "value": ep.number,
                        "type": {"coding": [{"system": V2_0203, "code": "VN", "display": "Visit number"}]}}],
        "status": "finished" if finished else "in-progress",
        "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "IMP",
                  "display": "inpatient encounter"},
        "type": [{"text": "INTERNAMENTO"}],
        "serviceType": _service(first_service),
        "priority": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ActPriority",
                                 "code": "EM" if ep.urgent else "EL"}]},
        "subject": {"reference": patient_ref},
        "period": {"start": iso(ep.admit_time), **({"end": iso(ep.discharge_time)} if ep.discharge_time else {})},
        "reasonCode": [{"coding": codings, "text": d.text}],
        "diagnosis": [{"condition": {"reference": f"Condition/{enc_id}-dx"},
                       "use": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/diagnosis-role",
                                           "code": "DD" if finished else "AD"}]}, "rank": 1}],
        "hospitalization": {
            "admitSource": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/admit-source",
                                        "code": "emd" if ep.urgent else "outp"}]},
        },
        "location": [_location_entry(m, ep.discharge_time) for m in ep.movements],
        "serviceProvider": {"reference": "Organization/inst"},
    }
    if ep.attending:
        encounter["participant"] = [{
            "type": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                                  "code": "ATND", "display": "attender"}]}],
            "individual": {"reference": f"Practitioner/pr-{ep.attending.hos_id}", "display": ep.attending.display},
        }]
    if ep.readmission_of:
        encounter["hospitalization"]["reAdmission"] = {"text": f"READMISSAO (episodio {ep.readmission_of})"}
    if finished and ep.disposition:
        encounter["hospitalization"]["dischargeDisposition"] = {
            "coding": [{"system": "http://terminology.hl7.org/CodeSystem/discharge-disposition",
                        "code": DISCHARGE_FHIR.get(ep.disposition["code"], "oth")}],
            "text": ep.disposition["text"],
        }

    # One sub-encounter per service segment (service transfers / ICU / outliers)
    segments: list[list[Movement]] = []
    for m in ep.movements:
        if segments and segments[-1][-1].service is m.service:
            segments[-1].append(m)
        else:
            segments.append([m])
    subs = []
    if len(segments) > 1:
        for i, seg in enumerate(segments, start=1):
            end = seg[-1].end
            subs.append({
                "resourceType": "Encounter",
                "id": f"{enc_id}-s{i}",
                "status": "finished" if end else "in-progress",
                "class": encounter["class"],
                "serviceType": _service(seg[0].service),
                "subject": {"reference": patient_ref},
                "partOf": {"reference": f"Encounter/{enc_id}"},
                "period": {"start": iso(seg[0].start), **({"end": iso(end)} if end else {})},
                "location": [_location_entry(m, end) for m in seg],
            })
    return [encounter, condition, *subs]


def patient_bundle(
    pool_patient: PoolPatient,
    identity: PatientIdentity,
    episodes: list[Episode],
    drop_types: set[str],
) -> dict:
    if pool_patient.bundle_path and pool_patient.bundle_path.exists():
        bundle = json.loads(pool_patient.bundle_path.read_text(encoding="utf-8"))
    else:
        bundle = {"resourceType": "Bundle", "type": "transaction", "entry": [
            {"fullUrl": f"urn:uuid:{pool_patient.key}", "resource": {"resourceType": "Patient", "id": pool_patient.key},
             "request": {"method": "POST", "url": "Patient"}},
        ]}
    bundle["type"] = "transaction"
    deceased_at = next((e.discharge_time for e in episodes if e.dies and e.state == "discharged"), None)

    entries = []
    patient_ref = f"urn:uuid:{pool_patient.key}"
    for entry in bundle.get("entry", []):
        res = entry.get("resource", {})
        rtype = res.get("resourceType")
        if rtype in drop_types:
            continue
        if rtype == "Patient":
            entry["resource"] = portuguese_patient(res, identity, deceased_at)
            entry["request"] = {"method": "PUT", "url": f"Patient?identifier=urn:id:HOS|{identity.ns}"}
            patient_ref = entry.get("fullUrl", patient_ref)
        else:
            _scrub(res)
        entries.append(entry)
    for ep in episodes:
        entries.extend(put_entry(r) for r in episode_resources(ep, patient_ref))
    bundle["entry"] = entries
    return bundle


# ---------------------------------------------------------------------- hospital
def _bed_status(bed: Bed, at: datetime) -> dict:
    if bed.occupant is not None:
        code, display = "O", "Occupied"
    elif bed.blocked_until and bed.blocked_until > at:
        code, display = "H", "Housekeeping"
    else:
        code, display = "U", "Unoccupied"
    return {"system": "http://terminology.hl7.org/CodeSystem/v2-0116", "code": code, "display": display}


def hospital_bundle(hospital: Hospital, doctors: dict[str, list[Staff]], at: datetime) -> dict:
    loc_type = "http://terminology.hl7.org/CodeSystem/location-physical-type"
    resources: list[dict] = [{
        "resourceType": "Organization",
        "id": "inst",
        "identifier": [{"system": "urn:id:HOS", "value": hospital.facility}],
        "active": True,
        "type": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/organization-type", "code": "prov"}]}],
        "name": hospital.name,
        "address": [{"country": "PRT"}],
    }]
    for ward in hospital.wards:
        resources.append({
            "resourceType": "Location", "id": ward.fhir_id, "status": "active", "mode": "instance",
            "identifier": [{"system": "urn:id:HOS:servico", "value": ward.code}],
            "name": ward.name, "description": f"Especialidade {ward.specialty}, piso {ward.floor}",
            "physicalType": {"coding": [{"system": loc_type, "code": "wa", "display": "Ward"}]},
            "managingOrganization": {"reference": "Organization/inst"},
        })
        rooms = list(ward.rooms) + ([ward.stretchers[0].room] if ward.stretchers else [])
        for room in rooms:
            resources.append({
                "resourceType": "Location", "id": room.fhir_id, "status": "active", "mode": "instance",
                "name": f"{ward.name} - {room.label}",
                "identifier": [{"system": "urn:id:HOS:quarto", "value": f"{ward.code}^{room.number}"}],
                "physicalType": {"coding": [{"system": loc_type, "code": "ro", "display": "Room"}]},
                "partOf": {"reference": f"Location/{ward.fhir_id}"},
                "managingOrganization": {"reference": "Organization/inst"},
            })
            for bed in room.beds:
                resources.append({
                    "resourceType": "Location", "id": bed.fhir_id, "status": "active", "mode": "instance",
                    "operationalStatus": _bed_status(bed, at),
                    "name": f"{ward.name} - {room.label} - {bed.kind} {bed.code}",
                    "identifier": [{"system": "urn:id:HOS:cama", "value": bed.key},
                                   {"system": "urn:id:HOS:cama-uid", "value": str(bed.uid)}],
                    "type": [{"text": bed.kind}],
                    "physicalType": {"coding": [{"system": loc_type, "code": "bd", "display": "Bed"}]},
                    "partOf": {"reference": f"Location/{room.fhir_id}"},
                    "managingOrganization": {"reference": "Organization/inst"},
                })
    for ward_code, staff in doctors.items():
        for doc in staff:
            resources.append({
                "resourceType": "Practitioner", "id": f"pr-{doc.hos_id}", "active": True,
                "identifier": [
                    {"system": "urn:id:HOS", "value": doc.hos_id},
                    {"system": "urn:id:OrdemMedicos", "value": doc.ordem},
                    {"system": "urn:id:HOS:mecanografico", "value": doc.mecanografico},
                ],
                "name": [{"use": "official", "family": doc.family, "given": [doc.given], "text": doc.display}],
                "extension": [{"url": "urn:pfgen:ward", "valueString": ward_code}],
            })
    return {"resourceType": "Bundle", "type": "transaction", "entry": [put_entry(r) for r in resources]}


def write_json(path: Path, data: dict, pretty: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2 if pretty else None), encoding="utf-8")
