from typing import Optional

from pydantic import BaseModel


class PIDSegment(BaseModel):
    set_id: str
    patient_id_external: Optional[str] = None  # noqa: UP045
    patient_id: str
    patient_alternate_id: Optional[str] = None  # noqa: UP045
    patient_name: str
    mothers_maiden: Optional[str] = None  # noqa: UP045
    date_of_birth: str
    gender: str
    patient_alias: Optional[str] = None  # noqa: UP045
    race: Optional[str] = None  # noqa: UP045
    address: str
    county_code: Optional[str] = None  # noqa: UP045
    home_phone: Optional[str] = None  # noqa: UP045
    business_phone: Optional[str] = None  # noqa: UP045
    language: Optional[str] = None  # noqa: UP045
    marital_status: Optional[str] = None  # noqa: UP045
    
class MSHSegment(BaseModel):
    field_separator: str
    encoding_characters: str
    sending_application: Optional[str] = None  # noqa: UP045
    sending_facility: Optional[str] = None  # noqa: UP045
    receiving_application: Optional[str] = None  # noqa: UP045
    receiving_facility: Optional[str] = None  # noqa: UP045
    message_datetime: str
    security: Optional[str] = None  # noqa: UP045
    message_type: str
    message_control_id: str
    processing_id: str
    version_id: str


class EVNSegment(BaseModel):
    event_type_code: Optional[str] = None  # noqa: UP045
    recorded_datetime: Optional[str] = None  # noqa: UP045
    date_planned_event: Optional[str] = None  # noqa: UP045
    event_reason_code: Optional[str] = None  # noqa: UP045
    operator_id: Optional[str] = None  # noqa: UP045
    event_occurred: Optional[str] = None  # noqa: UP045
    event_facility: Optional[str] = None  # noqa: UP045


class PV1Segment(BaseModel):
    set_id: Optional[str] = None  # noqa: UP045
    patient_class: Optional[str] = None  # noqa: UP045
    assigned_patient_location: Optional[str] = None  # noqa: UP045
    admission_type: Optional[str] = None  # noqa: UP045
    preadmit_number: Optional[str] = None  # noqa: UP045
    prior_patient_location: Optional[str] = None  # noqa: UP045
    attending_doctor: Optional[str] = None  # noqa: UP045
    referring_doctor: Optional[str] = None  # noqa: UP045
    consulting_doctor: Optional[str] = None  # noqa: UP045
    hospital_service: Optional[str] = None  # noqa: UP045
    temporary_location: Optional[str] = None  # noqa: UP045
    preadmit_test_indicator: Optional[str] = None  # noqa: UP045
    readmission_indicator: Optional[str] = None  # noqa: UP045
    admit_source: Optional[str] = None  # noqa: UP045
    ambulatory_status: Optional[str] = None  # noqa: UP045
    vip_indicator: Optional[str] = None  # noqa: UP045
    admitting_doctor: Optional[str] = None  # noqa: UP045
    patient_type: Optional[str] = None  # noqa: UP045
    visit_number: Optional[str] = None  # noqa: UP045
    financial_class: Optional[str] = None  # noqa: UP045
    discharge_disposition: Optional[str] = None  # noqa: UP045
    admit_datetime: Optional[str] = None  # noqa: UP045
    discharge_datetime: Optional[str] = None  # noqa: UP045


class PV2Segment(BaseModel):
    prior_pending_location: Optional[str] = None  # noqa: UP045
    accommodation_code: Optional[str] = None  # noqa: UP045
    admit_reason: Optional[str] = None  # noqa: UP045
    transfer_reason: Optional[str] = None  # noqa: UP045
    patient_valuables: Optional[str] = None  # noqa: UP045
    patient_valuables_location: Optional[str] = None  # noqa: UP045
    visit_user_code: Optional[str] = None  # noqa: UP045
    expected_admit_date: Optional[str] = None  # noqa: UP045
    expected_discharge_date: Optional[str] = None  # noqa: UP045
    estimated_length_of_inpatient_stay: Optional[str] = None  # noqa: UP045
    actual_length_of_inpatient_stay: Optional[str] = None  # noqa: UP045
    visit_description: Optional[str] = None  # noqa: UP045


class ROLSegment(BaseModel):
    role_instance_id: Optional[str] = None  # noqa: UP045
    action_code: Optional[str] = None  # noqa: UP045
    role: Optional[str] = None  # noqa: UP045
    person: Optional[str] = None  # noqa: UP045
    role_begin_datetime: Optional[str] = None  # noqa: UP045
    role_end_datetime: Optional[str] = None  # noqa: UP045
    role_duration: Optional[str] = None  # noqa: UP045
    role_action_reason: Optional[str] = None  # noqa: UP045


class DG1Segment(BaseModel):
    set_id: Optional[str] = None  # noqa: UP045
    diagnosis_coding_method: Optional[str] = None  # noqa: UP045
    diagnosis_code: Optional[str] = None  # noqa: UP045
    diagnosis_description: Optional[str] = None  # noqa: UP045
    diagnosis_datetime: Optional[str] = None  # noqa: UP045
    diagnosis_type: Optional[str] = None  # noqa: UP045
    major_diagnostic_category: Optional[str] = None  # noqa: UP045
    diagnostic_related_group: Optional[str] = None  # noqa: UP045
    diagnosis_priority: Optional[str] = None  # noqa: UP045
    diagnosing_clinician: Optional[str] = None  # noqa: UP045
    diagnosis_action_code: Optional[str] = None  # noqa: UP045


class PR1Segment(BaseModel):
    set_id: Optional[str] = None  # noqa: UP045
    procedure_coding_method: Optional[str] = None  # noqa: UP045
    procedure_code: Optional[str] = None  # noqa: UP045
    procedure_description: Optional[str] = None  # noqa: UP045
    procedure_datetime: Optional[str] = None  # noqa: UP045
    procedure_provider: Optional[str] = None  # noqa: UP045
    anesthesia_code: Optional[str] = None  # noqa: UP045
    anesthesia_minutes: Optional[str] = None  # noqa: UP045
    surgeon: Optional[str] = None  # noqa: UP045
    procedure_practitioner: Optional[str] = None  # noqa: UP045


class IN1Segment(BaseModel):
    set_id: Optional[str] = None  # noqa: UP045
    insurance_plan_id: Optional[str] = None  # noqa: UP045
    insurance_company_id: Optional[str] = None  # noqa: UP045
    insurance_company_name: Optional[str] = None  # noqa: UP045
    insurance_company_address: Optional[str] = None  # noqa: UP045
    insurance_company_phone: Optional[str] = None  # noqa: UP045
    group_number: Optional[str] = None  # noqa: UP045
    group_name: Optional[str] = None  # noqa: UP045
    insured_group_employer: Optional[str] = None  # noqa: UP045
    plan_effective_date: Optional[str] = None  # noqa: UP045
    plan_expiration_date: Optional[str] = None  # noqa: UP045
    plan_type: Optional[str] = None  # noqa: UP045
    name_of_insured: Optional[str] = None  # noqa: UP045
    insured_relationship: Optional[str] = None  # noqa: UP045
    insured_date_of_birth: Optional[str] = None  # noqa: UP045
    insured_address: Optional[str] = None  # noqa: UP045
    assignment_of_benefits: Optional[str] = None  # noqa: UP045
    policy_number: Optional[str] = None  # noqa: UP045
    insured_id_number: Optional[str] = None  # noqa: UP045
    coverage_type: Optional[str] = None  # noqa: UP045
    
    

    
def parse_msh(msh_list: list) -> MSHSegment:
    return MSHSegment(
        field_separator=msh_list[1],
        encoding_characters=msh_list[2],
        sending_application=msh_list[3] or None,
        sending_facility=msh_list[4] or None,
        receiving_application=msh_list[5] or None,
        receiving_facility=msh_list[6] or None,
        message_datetime=msh_list[7],
        security=msh_list[8] or None,
        message_type=msh_list[9],
        message_control_id=msh_list[10],
        processing_id=msh_list[11],
        version_id=msh_list[12]
    )


def parse_pid(pid_list: list) -> PIDSegment:
    return PIDSegment(
        set_id=pid_list[1],
        patient_id_external=pid_list[2] or None,
        patient_id=pid_list[3],
        patient_alternate_id=pid_list[4] or None,
        patient_name=pid_list[5],
        mothers_maiden=pid_list[6] or None,
        date_of_birth=pid_list[7],
        gender=pid_list[8],
        patient_alias=pid_list[9] or None,
        race=pid_list[10] or None,
        address=pid_list[11],
        county_code=pid_list[12] or None,
        home_phone=pid_list[13] or None,
        business_phone=pid_list[14] or None,
        language=pid_list[15] or None,
        marital_status=pid_list[16] or None
    )
    
    

def _field(segment: list, number: int) -> Optional[str]:  # noqa: UP045
    """Return an HL7 field by number, preserving composite field contents."""
    if number >= len(segment) or not segment[number]:
        return None
    return segment[number]


def parse_evn(segment: list) -> EVNSegment:
    return EVNSegment(**{name: _field(segment, index) for index, name in {
        1: "event_type_code", 2: "recorded_datetime", 3: "date_planned_event",
        4: "event_reason_code", 5: "operator_id", 6: "event_occurred",
        7: "event_facility",
    }.items()})


def parse_pv1(segment: list) -> PV1Segment:
    return PV1Segment(**{name: _field(segment, index) for index, name in {
        1: "set_id", 2: "patient_class", 3: "assigned_patient_location",
        4: "admission_type", 5: "preadmit_number", 6: "prior_patient_location",
        7: "attending_doctor", 8: "referring_doctor", 9: "consulting_doctor",
        10: "hospital_service", 11: "temporary_location",
        12: "preadmit_test_indicator", 13: "readmission_indicator",
        14: "admit_source", 15: "ambulatory_status", 16: "vip_indicator",
        17: "admitting_doctor", 18: "patient_type", 19: "visit_number",
        20: "financial_class", 36: "discharge_disposition",
        44: "admit_datetime", 45: "discharge_datetime",
    }.items()})


def parse_pv2(segment: list) -> PV2Segment:
    return PV2Segment(**{name: _field(segment, index) for index, name in {
        1: "prior_pending_location", 2: "accommodation_code", 3: "admit_reason",
        4: "transfer_reason", 5: "patient_valuables",
        6: "patient_valuables_location", 7: "visit_user_code",
        8: "expected_admit_date", 9: "expected_discharge_date",
        10: "estimated_length_of_inpatient_stay",
        11: "actual_length_of_inpatient_stay", 12: "visit_description",
    }.items()})


def parse_rol(segment: list) -> ROLSegment:
    return ROLSegment(**{name: _field(segment, index) for index, name in {
        1: "role_instance_id", 2: "action_code", 3: "role", 4: "person",
        5: "role_begin_datetime", 6: "role_end_datetime", 7: "role_duration",
        8: "role_action_reason",
    }.items()})


def parse_dg1(segment: list) -> DG1Segment:
    return DG1Segment(**{name: _field(segment, index) for index, name in {
        1: "set_id", 2: "diagnosis_coding_method", 3: "diagnosis_code",
        4: "diagnosis_description", 5: "diagnosis_datetime", 6: "diagnosis_type",
        7: "major_diagnostic_category", 8: "diagnostic_related_group",
        15: "diagnosis_priority", 16: "diagnosing_clinician",
        21: "diagnosis_action_code",
    }.items()})


def parse_pr1(segment: list) -> PR1Segment:
    return PR1Segment(**{name: _field(segment, index) for index, name in {
        1: "set_id", 2: "procedure_coding_method", 3: "procedure_code",
        4: "procedure_description", 5: "procedure_datetime",
        6: "procedure_provider", 7: "anesthesia_code", 8: "anesthesia_minutes",
        9: "surgeon", 10: "procedure_practitioner",
    }.items()})


def parse_in1(segment: list) -> IN1Segment:
    return IN1Segment(**{name: _field(segment, index) for index, name in {
        1: "set_id", 2: "insurance_plan_id", 3: "insurance_company_id",
        4: "insurance_company_name", 5: "insurance_company_address",
        7: "insurance_company_phone", 8: "group_number", 9: "group_name",
        10: "insured_group_employer", 11: "plan_effective_date",
        12: "plan_expiration_date", 15: "plan_type", 16: "name_of_insured",
        17: "insured_relationship", 18: "insured_date_of_birth",
        19: "insured_address", 20: "assignment_of_benefits",
        36: "policy_number", 49: "insured_id_number", 50: "coverage_type",
    }.items()})