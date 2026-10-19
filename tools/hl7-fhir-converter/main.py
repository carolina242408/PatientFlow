from __future__ import annotations

import argparse
import importlib.util
import json
import re
from datetime import datetime, timedelta, timezone
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
	replacements = {"\\F\\": "|", "\\S\\": "^", "\\T\\": "&", "\\R\\": "~", "\\E\\": "\\"}
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
				return parsed.replace(tzinfo=timezone(timedelta(hours=8))).isoformat()
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
	coding = [fhir.Coding(system=coding_system, code=code, display=text)] if code else []
	return fhir.CodeableConcept(coding=coding, text=text)


def _reference(resource_type: str, resource_id: str, display: str | None = None) -> fhir.Reference:
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


def _patient(pid: Any) -> fhir.Patient:
	identifiers = []
	for raw_identifier in _repetitions(pid.patient_id):
		parts = _components(raw_identifier)
		identifiers.append(
			fhir.Identifier(
				use="official" if _component(parts, 4) == "SNS" else "usual",
				system=f"urn:id:{_component(parts, 3)}" if _component(parts, 3) else None,
				value=_component(parts, 0) or None,
				type=fhir.CodeableConcept(text=_component(parts, 4)) if _component(parts, 4) else None,
			)
		)

	names = []
	for raw_name in _repetitions(pid.patient_name):
		parts = _components(raw_name)
		given = [p for p in parts[1:3] if p]
		names.append(fhir.HumanName(
			use="official",
			text=" ".join([*given, _component(parts, 0)]).strip(),
			family=_component(parts, 0) or None,
			given=given,
		))

	address = _components(pid.address)
	addresses = [
		fhir.Address(
			use="home",
			line=[_component(address, 0)] if _component(address, 0) else [],
			city=_component(address, 2) or None,
			district=_component(address, 8) or None,
			state=_component(address, 3) or None,
			postalCode=_component(address, 4) or None,
			country=_component(address, 5) or None,
		)
	] if pid.address else []

	telecom = []
	for raw_telecom in _repetitions(pid.home_phone):
		parts = _components(raw_telecom)
		value = _component(parts, 11) or _component(parts, 3) or _component(parts, 0)
		if value:
			telecom.append(fhir.ContactPoint(
				system="email" if _component(parts, 2) == "X.400" else "phone",
				value=value,
				use="home",
			))
	for raw_telecom in _repetitions(pid.business_phone):
		parts = _components(raw_telecom)
		value = _component(parts, 11) or _component(parts, 3) or _component(parts, 0)
		if value:
			telecom.append(fhir.ContactPoint(system="phone", value=value, use="work"))

	gender = {"M": "male", "F": "female", "O": "other", "U": "unknown"}.get(
		pid.gender, "unknown"
	)
	return fhir.Patient(
		id=_safe_id(_components(pid.patient_id)[0], "patient"),
		identifier=identifiers,
		active=True,
		name=names,
		telecom=telecom,
		gender=gender,
		birthDate=(_timestamp(pid.date_of_birth) or "").split("T", 1)[0] or None,
		address=addresses,
		communication=[fhir.Communication(language=_codeable(pid.language))] if pid.language else [],
		maritalStatus=fhir.CodeableConcept(coding=[fhir.Coding(
			system="http://terminology.hl7.org/CodeSystem/v3-MaritalStatus",
			display=(
				f"Invalid input: code '{pid.marital_status}' could not be mapped to values "
				"in system 'http://terminology.hl7.org/CodeSystem/v3-MaritalStatus' "
				"with original display 'null' and version 'null'."
			),
		)]) if pid.marital_status else None,
	)


def _location(pv1: Any) -> fhir.Location | None:
	if not pv1.assigned_patient_location:
		return None
	parts = _components(pv1.assigned_patient_location)
	name = "-".join(part for part in parts[:3] if part) or _decode(pv1.assigned_patient_location)
	return fhir.Location(
		id=_safe_id(name, "location"),
		name=name,
		status="active",
		mode="instance",
		type=[_codeable(parts[0] if parts else None)],
		physicalType=_codeable("bd", "http://terminology.hl7.org/CodeSystem/location-physical-type"),
	)


def _encounter(msh: Any, evn: Any, pv1: Any, patient: fhir.Patient, location: fhir.Location | None) -> fhir.Encounter:
	event = _components(msh.message_type)
	event_code = event[1] if len(event) > 1 else evn.event_type_code
	status = "arrived" if event_code == "A01" and pv1.patient_class == "INT" else (
		"finished" if event_code == "A03" else "in-progress"
	)
	period = fhir.Period(start=_timestamp(pv1.admit_datetime), end=_timestamp(pv1.discharge_datetime))
	encounter_location = []
	if location:
		encounter_location.append(
			fhir.EncounterLocation(
				location=_reference("Location", location.id or "location", location.name)
			)
		)
	participants = []
	doctor_field = pv1.admitting_doctor or pv1.attending_doctor
	for raw_doctor in _repetitions(doctor_field):
		parts = _components(raw_doctor)
		display = (
			f"{_component(parts, 1)}, {_component(parts, 2)} (ID: {_component(parts, 0)})"
			if not pv1.admitting_doctor
			else f"{_component(parts, 2)} {_component(parts, 1)}".strip()
		)
		participants.append(fhir.EncounterParticipant(
			type=[fhir.CodeableConcept(coding=[fhir.Coding(
				system="http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
				code="ADM",
				display="admitter",
			)])],
			individual=fhir.Reference(display=display),
		))
	location_parts = _components(pv1.assigned_patient_location)
	return fhir.Encounter(
		id=_safe_id(pv1.visit_number, "encounter"),
		identifier=[fhir.Identifier(
			type=fhir.CodeableConcept(coding=[fhir.Coding(
				system="http://terminology.hl7.org/CodeSystem/v2-0203",
				code="VN",
				display="Visit number",
			)]),
			system="urn:id:HOS",
			value=_component(_components(pv1.visit_number), 0),
		)] if pv1.visit_number else [],
		status=status,
		class_=fhir.Coding(code=pv1.patient_class),
		type=[fhir.CodeableConcept(coding=[fhir.Coding(
			system="http://terminology.hl7.org/CodeSystem/v2-0007",
			code=pv1.admission_type,
			display={"U": "Urgent"}.get(pv1.admission_type),
		)])],
		serviceType=_codeable(_component(location_parts, 0)),
		subject=_reference("Patient", patient.id or "patient"),
		period=period,
		participant=participants,
		reason_code=[_codeable(pv1.account_status)] if pv1.account_status else [],
		diagnosis=[{"condition": _reference("Condition", "condition-1"), "rank": 1}],
		location=encounter_location,
		hospitalization=fhir.EncounterHospitalization(
			admitSource=_codeable(pv1.admit_source),
			dischargeDisposition=_codeable(pv1.discharge_disposition),
		),
	)


def _practitioners(pv1: Any, roles: list[Any]) -> list[fhir.Practitioner]:
	values = [pv1.attending_doctor, pv1.referring_doctor, pv1.consulting_doctor, pv1.admitting_doctor]
	values.extend(role.person for role in roles)
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
					identifier=[fhir.Identifier(value=identifier, system=f"urn:id:{system}" if system else None)],
					name=[fhir.HumanName(
						text=f"{_component(parts, 2)} {_component(parts, 1)}".strip(),
						family=_component(parts, 1) or None,
						given=[_component(parts, 2)] if _component(parts, 2) else [],
					)],
					active=True,
				)
			)
	return practitioners


def _conditions(diagnoses: list[Any], patient: fhir.Patient, encounter: fhir.Encounter) -> list[fhir.Condition]:
	conditions = []
	for index, diagnosis in enumerate(diagnoses, 1):
		parts = _components(diagnosis.diagnosis_code)
		code = _component(parts, 0)
		display = _component(parts, 1) or diagnosis.diagnosis_description
		visit_value = encounter.identifier[0].value if encounter.identifier else None
		system = {
			"ICD10": "http://hl7.org/fhir/sid/icd-10-cm",
		}.get(_component(parts, 2))
		conditions.append(fhir.Condition(
			id=f"condition-{diagnosis.set_id or index}",
			identifier=[
				fhir.Identifier(
					type=fhir.CodeableConcept(coding=[fhir.Coding(
						system="http://terminology.hl7.org/CodeSystem/v2-0203",
						code="VN",
						display="Visit number",
					)]),
					system="urn:id:HOS",
					value=_component(_components(visit_value), 0) if visit_value else None,
				),
				fhir.Identifier(system="urn:id:extID", value=f"{code}-{_component(parts, 2)}"),
			],
			clinicalStatus=_codeable("active", "http://terminology.hl7.org/CodeSystem/condition-clinical"),
			verificationStatus=_codeable("confirmed", "http://terminology.hl7.org/CodeSystem/condition-ver-status"),
			category=[
				fhir.CodeableConcept(
					coding=[fhir.Coding(
						system="http://terminology.hl7.org/CodeSystem/condition-category",
						code="encounter-diagnosis",
						display="Encounter Diagnosis",
					)],
					text="Encounter Diagnosis",
				)
			],
			code=fhir.CodeableConcept(
				coding=[
					fhir.Coding(system=system, code=code, display=display),
					fhir.Coding(code=_component(parts, 3)) if _component(parts, 3) else fhir.Coding(),
				],
				text=display,
			),
			subject=_reference("Patient", patient.id or "patient"),
			encounter=_reference("Encounter", encounter.id or "encounter"),
			onsetDateTime=_timestamp(diagnosis.diagnosis_datetime),
		))
	return conditions


def _allergies(allergies: list[Any], patient: fhir.Patient, encounter: fhir.Encounter) -> list[fhir.AllergyIntolerance]:
	return [
		fhir.AllergyIntolerance(
			id=f"allergy-{allergy.set_id or index}",
			clinicalStatus=_codeable("active", "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical"),
			verificationStatus=_codeable("confirmed", "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification"),
			category=["medication" if allergy.set_id == "1" else "environment"],
			code=fhir.CodeableConcept(text=_component(_components(allergy.allergen_code), 1)),
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
			] if allergy.allergy_reaction else [],
		)
		for index, allergy in enumerate(allergies, 1)
		if allergy.allergen_code
	]


def _related_people(nk1: list[Any], gt1: list[Any], patient: fhir.Patient) -> list[fhir.RelatedPerson]:
	people = []
	for source, relationship in ((gt1, "GT"), (nk1, "SPS")):
		for index, person in enumerate(source, 1):
			parts = _components(person.guarantor_name if hasattr(person, "guarantor_name") else person.name)
			people.append(
				fhir.RelatedPerson(
					id=f"related-person-{len(people) + 1}",
					active=True,
					patient=_reference("Patient", patient.id or "patient"),
					relationship=[_codeable(relationship)],
					name=[fhir.HumanName(
						use="official",
						family=_component(parts, 0) or None,
						given=[part for part in parts[1:3] if part],
					)],
				)
			)
	return people


def _observations(observations: list[Any], patient: fhir.Patient, encounter: fhir.Encounter) -> list[fhir.Observation]:
	return [
		fhir.Observation(
			id=f"observation-{observation.set_id or index}",
			status="final" if observation.observation_result_status == "F" else "unknown",
			code=_codeable(observation.observation_identifier),
			subject=_reference("Patient", patient.id or "patient"),
			encounter=_reference("Encounter", encounter.id or "encounter"),
			valueString=observation.observation_value,
			effectiveDateTime=_timestamp(observation.date_last_observed),
		)
		for index, observation in enumerate(observations, 1)
		if observation.observation_identifier
	]


def _procedures(procedures: list[Any], patient: fhir.Patient, encounter: fhir.Encounter, message_datetime: str) -> list[fhir.Procedure]:
	return [
		fhir.Procedure(
			id=f"procedure-{procedure.set_id or index}",
			identifier=[
				fhir.Identifier(system="urn:id:extID", value=message_datetime),
				fhir.Identifier(
					type=fhir.CodeableConcept(coding=[fhir.Coding(
						system="http://terminology.hl7.org/CodeSystem/v2-0203",
						code="VN",
						display="Visit number",
					)]),
					system="urn:id:HOS",
					value=encounter.identifier[0].value if encounter.identifier else None,
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


def _coverage(insurances: list[Any], patient: fhir.Patient) -> tuple[list[fhir.Coverage], list[fhir.Organization]]:
	coverages = []
	organizations = []
	for index, insurance in enumerate(insurances, 1):
		company = _components(insurance.insurance_company_id) if insurance.insurance_company_id else []
		plan = _components(insurance.insurance_plan_id) if insurance.insurance_plan_id else []
		organization_id = _safe_id(company[0] if company else None, f"insurer-{index}")
		if company:
			organizations.append(
				fhir.Organization(
					id=organization_id,
					identifier=[fhir.Identifier(value=insurance.insurance_plan_id)],
					active=True,
					name=insurance.insurance_company_name or _component(company, 1) or None,
				)
			)
		coverages.append(
			fhir.Coverage(
				id=f"coverage-{insurance.set_id or index}",
				identifier=[fhir.Identifier(
					type=fhir.CodeableConcept(coding=[fhir.Coding(
						system="http://terminology.hl7.org/CodeSystem/v2-0203",
						code="XV",
						display="Health Plan Identifier",
					)]),
					system="urn:id:HOS",
					value=_component(plan, 0),
				)] if plan else [],
				status="active",
				type=_codeable(insurance.plan_type) if insurance.plan_type else None,
				beneficiary=_reference("Patient", patient.id or "patient"),
				payor=[_reference("Organization", organization_id, insurance.insurance_company_name)] if company else [],
				subscriberId=insurance.insured_id_number,
				order=index,
				class_=[fhir.CoverageClass(type=_codeable("plan"), value=insurance.insurance_plan_id)]
				if insurance.insurance_plan_id else [],
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
	location = _location(pv1)
	encounter = _encounter(msh, evn, pv1, patient, location)
	location_parts = _components(pv1.assigned_patient_location)
	hospital_id = _component(location_parts, 3).split("&", 1)[0]
	organizations = [fhir.Organization(
		id=hospital_id,
		identifier=[fhir.Identifier(system="urn:id:extID", value=hospital_id)],
		name=hospital_id,
		active=True,
	)] if hospital_id else []
	if hospital_id:
		encounter.service_provider = _reference("Organization", hospital_id)
	practitioners = _practitioners(pv1, segments.get("ROL", []))
	conditions = _conditions(segments.get("DG1", []), patient, encounter)
	allergies = _allergies(segments.get("AL1", []), patient, encounter)
	related_people = _related_people(segments.get("NK1", []), segments.get("GT1", []), patient)
	observations = _observations(segments.get("OBX", []), patient, encounter)
	procedures = _procedures(segments.get("PR1", []), patient, encounter, msh.message_datetime)
	coverages, insurance_organizations = _coverage(segments.get("IN1", []), patient)
	organizations.extend(insurance_organizations)

	message_type = _components(msh.message_type)
	event_code = message_type[1] if len(message_type) > 1 else evn.event_type_code
	header = fhir.MessageHeader(
		id=_safe_id(msh.message_control_id, "message"),
		eventCoding=fhir.Coding(
			system="http://terminology.hl7.org/CodeSystem/v2-0003",
			code=event_code,
			display="ADT/ACK - Admit/visit notification" if event_code == "A01" else msh.message_type,
		),
		source=fhir.MessageHeaderSource(
			name=msh.sending_facility,
			endpoint=f"urn:redix:source:{msh.sending_application or 'unknown'}",
			version=msh.version_id,
		),
		destination=[fhir.MessageHeaderDestination(
			name=msh.receiving_facility,
			endpoint=f"urn:redix:destination:{msh.receiving_application or 'unknown'}",
		)],
		focus=[_reference("Patient", patient.id or "patient"), _reference("Encounter", encounter.id or "encounter")],
	)

	resources: list[fhir.FHIRModel] = [header, patient, encounter, *organizations, *practitioners]
	if location:
		resources.append(location)
	resources.extend([*allergies, *conditions, *observations, *procedures, *coverages, *related_people])
	return fhir.Bundle(
		id=_safe_id(msh.message_control_id, "bundle"),
		type="collection",
		timestamp=datetime.now(timezone.utc),
		identifier=fhir.Identifier(system="urn:hl7v2:message-control-id", value=msh.message_control_id),
		entry=[fhir.BundleEntry(fullUrl=f"urn:uuid:{resource.id}", resource=resource) for resource in resources],
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
	parser = argparse.ArgumentParser(description="Convert an HL7 v2 ADT message to a FHIR R4 Bundle")
	parser.add_argument("message", nargs="?", help="HL7 file path; reads stdin when omitted")
	parser.add_argument(
		"-o",
		"--output",
		type=Path,
		help="Write the FHIR Bundle to this JSON file instead of stdout",
	)
	args = parser.parse_args()
	message = (
		_resolve_message_path(args.message).read_text(encoding="utf-8")
		if args.message
		else __import__("sys").stdin.read()
	)
	output = json.dumps(
		convert_hl7_to_fhir(message).model_dump(by_alias=True, exclude_none=True, mode="json"),
		indent=2,
	)
	if args.output:
		args.output.write_text(output + "\n", encoding="utf-8")
	else:
		print(output)


if __name__ == "__main__":
	main()
