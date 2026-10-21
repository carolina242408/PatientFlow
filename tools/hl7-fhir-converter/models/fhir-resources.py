from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class FHIRModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class Coding(FHIRModel):
    system: Optional[str] = None  # noqa: UP045
    version: Optional[str] = None  # noqa: UP045
    code: Optional[str] = None  # noqa: UP045
    display: Optional[str] = None  # noqa: UP045
    user_selected: Optional[bool] = Field(default=None, alias="userSelected")


class CodeableConcept(FHIRModel):
    coding: list[Coding] = Field(default_factory=list)
    text: Optional[str] = None  # noqa: UP045


class Identifier(FHIRModel):
    use: Optional[str] = None  # noqa: UP045
    type: Optional[CodeableConcept] = None  # noqa: UP045
    system: Optional[str] = None  # noqa: UP045
    value: Optional[str] = None  # noqa: UP045
    period: Optional["Period"] = None  # noqa: UP045
    assigner: Optional["Reference"] = None  # noqa: UP045


class Reference(FHIRModel):
    reference: Optional[str] = None  # noqa: UP045
    type: Optional[str] = None  # noqa: UP045
    identifier: Optional[Identifier] = None  # noqa: UP045
    display: Optional[str] = None  # noqa: UP045


class HumanName(FHIRModel):
    use: Optional[str] = None  # noqa: UP045
    text: Optional[str] = None  # noqa: UP045
    family: Optional[str] = None  # noqa: UP045
    given: list[str] = Field(default_factory=list)
    prefix: list[str] = Field(default_factory=list)
    suffix: list[str] = Field(default_factory=list)


class Address(FHIRModel):
    use: Optional[str] = None  # noqa: UP045
    type: Optional[str] = None  # noqa: UP045
    text: Optional[str] = None  # noqa: UP045
    line: list[str] = Field(default_factory=list)
    city: Optional[str] = None  # noqa: UP045
    district: Optional[str] = None  # noqa: UP045
    state: Optional[str] = None  # noqa: UP045
    postal_code: Optional[str] = Field(default=None, alias="postalCode")
    country: Optional[str] = None  # noqa: UP045


class ContactPoint(FHIRModel):
    system: Optional[str] = None  # noqa: UP045
    value: Optional[str] = None  # noqa: UP045
    use: Optional[str] = None  # noqa: UP045
    rank: Optional[int] = None  # noqa: UP045
    period: Optional["Period"] = None  # noqa: UP045


class Communication(FHIRModel):
    language: CodeableConcept
    preferred: Optional[bool] = None  # noqa: UP045


class Period(FHIRModel):
    start: Optional[datetime] = None  # noqa: UP045
    end: Optional[datetime] = None  # noqa: UP045


class Quantity(FHIRModel):
    value: Optional[float] = None  # noqa: UP045
    unit: Optional[str] = None  # noqa: UP045
    system: Optional[str] = None  # noqa: UP045
    code: Optional[str] = None  # noqa: UP045


class Patient(FHIRModel):
    resource_type: str = Field(default="Patient", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    identifier: list[Identifier] = Field(default_factory=list)
    active: Optional[bool] = None  # noqa: UP045
    name: list[HumanName] = Field(default_factory=list)
    telecom: list[ContactPoint] = Field(default_factory=list)
    gender: Optional[str] = None  # noqa: UP045
    birth_date: Optional[str] = Field(default=None, alias="birthDate")
    deceased_boolean: Optional[bool] = Field(default=None, alias="deceasedBoolean")
    address: list[Address] = Field(default_factory=list)
    marital_status: Optional[CodeableConcept] = Field(
        default=None, alias="maritalStatus"
    )
    communication: list[Communication] = Field(default_factory=list)


class Organization(FHIRModel):
    resource_type: str = Field(default="Organization", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    identifier: list[Identifier] = Field(default_factory=list)
    active: Optional[bool] = None  # noqa: UP045
    name: Optional[str] = None  # noqa: UP045
    type: list[CodeableConcept] = Field(default_factory=list)
    telecom: list[ContactPoint] = Field(default_factory=list)
    address: list[Address] = Field(default_factory=list)
    part_of: Optional[Reference] = Field(default=None, alias="partOf")


class Practitioner(FHIRModel):
    resource_type: str = Field(default="Practitioner", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    identifier: list[Identifier] = Field(default_factory=list)
    active: Optional[bool] = None  # noqa: UP045
    name: list[HumanName] = Field(default_factory=list)
    telecom: list[ContactPoint] = Field(default_factory=list)
    address: list[Address] = Field(default_factory=list)
    qualification: list[CodeableConcept] = Field(default_factory=list)


class PractitionerRole(FHIRModel):
    resource_type: str = Field(default="PractitionerRole", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    identifier: list[Identifier] = Field(default_factory=list)
    active: Optional[bool] = None  # noqa: UP045
    period: Optional[Period] = None  # noqa: UP045
    practitioner: Optional[Reference] = None  # noqa: UP045
    organization: Optional[Reference] = None  # noqa: UP045
    code: list[CodeableConcept] = Field(default_factory=list)
    specialty: list[CodeableConcept] = Field(default_factory=list)
    location: list[Reference] = Field(default_factory=list)


class Location(FHIRModel):
    resource_type: str = Field(default="Location", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    identifier: list[Identifier] = Field(default_factory=list)
    status: Optional[str] = None  # noqa: UP045
    operational_status: Optional[Coding] = Field(
        default=None, alias="operationalStatus"
    )
    name: Optional[str] = None  # noqa: UP045
    description: Optional[str] = None  # noqa: UP045
    mode: Optional[str] = None  # noqa: UP045
    type: list[CodeableConcept] = Field(default_factory=list)
    telecom: list[ContactPoint] = Field(default_factory=list)
    address: Optional[Address] = None  # noqa: UP045
    physical_type: Optional[CodeableConcept] = Field(
        default=None, alias="physicalType"
    )
    managing_organization: Optional[Reference] = Field(
        default=None, alias="managingOrganization"
    )
    part_of: Optional[Reference] = Field(default=None, alias="partOf")


class EncounterParticipant(FHIRModel):
    type: list[CodeableConcept] = Field(default_factory=list)
    period: Optional[Period] = None  # noqa: UP045
    individual: Optional[Reference] = None  # noqa: UP045


class EncounterLocation(FHIRModel):
    location: Reference
    status: Optional[str] = None  # noqa: UP045
    physical_type: Optional[CodeableConcept] = Field(
        default=None, alias="physicalType"
    )
    period: Optional[Period] = None  # noqa: UP045


class EncounterHospitalization(FHIRModel):
    pre_admission_identifier: Optional[Identifier] = Field(
        default=None, alias="preAdmissionIdentifier"
    )
    origin: Optional[Reference] = None  # noqa: UP045
    admit_source: Optional[CodeableConcept] = Field(default=None, alias="admitSource")
    re_admission: Optional[CodeableConcept] = Field(
        default=None, alias="reAdmission"
    )
    diet_preference: list[CodeableConcept] = Field(
        default_factory=list, alias="dietPreference"
    )
    special_courtesy: list[CodeableConcept] = Field(
        default_factory=list, alias="specialCourtesy"
    )
    special_arrangement: list[CodeableConcept] = Field(
        default_factory=list, alias="specialArrangement"
    )
    destination: Optional[Reference] = None  # noqa: UP045
    discharge_disposition: Optional[CodeableConcept] = Field(
        default=None, alias="dischargeDisposition"
    )


class Encounter(FHIRModel):
    resource_type: str = Field(default="Encounter", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    text: Optional[dict] = None  # noqa: UP045
    identifier: list[Identifier] = Field(default_factory=list)
    status: str
    status_history: list[dict] = Field(default_factory=list, alias="statusHistory")
    class_: Optional[Coding] = Field(default=None, alias="class") 
    type: list[CodeableConcept] = Field(default_factory=list)
    service_type: Optional[CodeableConcept] = Field(default=None, alias="serviceType")
    priority: Optional[CodeableConcept] = None  # noqa: UP045
    subject: Optional[Reference] = None  # noqa: UP045
    episode_of_care: list[Reference] = Field(default_factory=list, alias="episodeOfCare")
    based_on: list[Reference] = Field(default_factory=list, alias="basedOn")
    participant: list[EncounterParticipant] = Field(default_factory=list)
    appointment: list[Reference] = Field(default_factory=list)
    period: Optional[Period] = None  # noqa: UP045
    length: Optional[Quantity] = None  # noqa: UP045
    reason_code: list[CodeableConcept] = Field(default_factory=list, alias="reasonCode")
    diagnosis: list[dict] = Field(default_factory=list)
    account: list[Reference] = Field(default_factory=list)
    hospitalization: Optional[EncounterHospitalization] = None  # noqa: UP045
    location: list[EncounterLocation] = Field(default_factory=list)
    service_provider: Optional[Reference] = Field(default=None, alias="serviceProvider")


class Condition(FHIRModel):
    resource_type: str = Field(default="Condition", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    identifier: list[Identifier] = Field(default_factory=list)
    clinical_status: Optional[CodeableConcept] = Field(
        default=None, alias="clinicalStatus"
    )
    verification_status: Optional[CodeableConcept] = Field(
        default=None, alias="verificationStatus"
    )
    category: list[CodeableConcept] = Field(default_factory=list)
    severity: Optional[CodeableConcept] = None  # noqa: UP045
    code: CodeableConcept
    body_site: list[CodeableConcept] = Field(default_factory=list, alias="bodySite")
    subject: Reference
    encounter: Optional[Reference] = None  # noqa: UP045
    onset_date_time: Optional[str] = Field(default=None, alias="onsetDateTime")
    recorded_date: Optional[str] = Field(default=None, alias="recordedDate")
    recorder: Optional[Reference] = None  # noqa: UP045
    note: list[dict] = Field(default_factory=list)


class ProcedurePerformer(FHIRModel):
    function: Optional[CodeableConcept] = None  # noqa: UP045
    actor: Reference
    on_behalf_of: Optional[Reference] = Field(default=None, alias="onBehalfOf")


class Procedure(FHIRModel):
    resource_type: str = Field(default="Procedure", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    identifier: list[Identifier] = Field(default_factory=list)
    instantiates_canonical: list[str] = Field(
        default_factory=list, alias="instantiatesCanonical"
    )
    status: str
    status_reason: Optional[CodeableConcept] = Field(
        default=None, alias="statusReason"
    )
    category: Optional[CodeableConcept] = None  # noqa: UP045
    code: CodeableConcept
    subject: Reference
    encounter: Optional[Reference] = None  # noqa: UP045
    performed_date_time: Optional[str] = Field(default=None, alias="performedDateTime")
    performer: list[ProcedurePerformer] = Field(default_factory=list)
    location: Optional[Reference] = None  # noqa: UP045
    reason_code: list[CodeableConcept] = Field(default_factory=list, alias="reasonCode")
    outcome: Optional[CodeableConcept] = None  # noqa: UP045
    note: list[dict] = Field(default_factory=list)


class CoverageClass(FHIRModel):
    type: CodeableConcept
    value: str
    name: Optional[str] = None  # noqa: UP045


class Coverage(FHIRModel):
    resource_type: str = Field(default="Coverage", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    identifier: list[Identifier] = Field(default_factory=list)
    status: str
    type: Optional[CodeableConcept] = None  # noqa: UP045
    policy_holder: Optional[Reference] = Field(default=None, alias="policyHolder")
    subscriber: Optional[Reference] = None  # noqa: UP045
    subscriber_id: Optional[str] = Field(default=None, alias="subscriberId")
    beneficiary: Reference
    dependent: Optional[str] = None  # noqa: UP045
    relationship: Optional[CodeableConcept] = None  # noqa: UP045
    period: Optional[Period] = None  # noqa: UP045
    payor: list[Reference] = Field(default_factory=list)
    class_: list[CoverageClass] = Field(default_factory=list, alias="class")
    order: Optional[int] = None  # noqa: UP045
    network: Optional[str] = None  # noqa: UP045


class AllergyReaction(FHIRModel):
    manifestation: list[CodeableConcept] = Field(default_factory=list)


class AllergyIntolerance(FHIRModel):
    resource_type: str = Field(default="AllergyIntolerance", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    clinical_status: Optional[CodeableConcept] = Field(
        default=None, alias="clinicalStatus"
    )
    verification_status: Optional[CodeableConcept] = Field(
        default=None, alias="verificationStatus"
    )
    category: list[str] = Field(default_factory=list)
    code: CodeableConcept
    patient: Reference
    encounter: Optional[Reference] = None  # noqa: UP045
    reaction: list[AllergyReaction] = Field(default_factory=list)


class RelatedPerson(FHIRModel):
    resource_type: str = Field(default="RelatedPerson", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    active: Optional[bool] = None  # noqa: UP045
    patient: Reference
    relationship: list[CodeableConcept] = Field(default_factory=list)
    name: list[HumanName] = Field(default_factory=list)
    telecom: list[ContactPoint] = Field(default_factory=list)
    address: list[Address] = Field(default_factory=list)


class Observation(FHIRModel):
    resource_type: str = Field(default="Observation", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    status: str
    code: CodeableConcept
    subject: Reference
    encounter: Optional[Reference] = None  # noqa: UP045
    value_string: Optional[str] = Field(default=None, alias="valueString")
    value_quantity: Optional[Quantity] = Field(default=None, alias="valueQuantity")
    effective_date_time: Optional[str] = Field(default=None, alias="effectiveDateTime")


class MessageHeaderSource(FHIRModel):
    name: Optional[str] = None  # noqa: UP045
    software: Optional[str] = None  # noqa: UP045
    version: Optional[str] = None  # noqa: UP045
    endpoint: Optional[str] = None  # noqa: UP045


class MessageHeaderDestination(FHIRModel):
    name: Optional[str] = None  # noqa: UP045
    target: Optional[Reference] = None  # noqa: UP045
    endpoint: Optional[str] = None  # noqa: UP045


class MessageHeader(FHIRModel):
    resource_type: str = Field(default="MessageHeader", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    event_coding: Coding = Field(alias="eventCoding")
    destination: list[MessageHeaderDestination] = Field(default_factory=list)
    sender: Optional[Reference] = None  # noqa: UP045
    enterer: Optional[Reference] = None  # noqa: UP045
    author: Optional[Reference] = None  # noqa: UP045
    source: MessageHeaderSource
    responsible: Optional[Reference] = None  # noqa: UP045
    reason: Optional[CodeableConcept] = None  # noqa: UP045
    focus: list[Reference] = Field(default_factory=list)
    response: Optional[dict] = None  # noqa: UP045


class BundleEntry(FHIRModel):
    full_url: Optional[str] = Field(default=None, alias="fullUrl")
    resource: Any


class Bundle(FHIRModel):
    resource_type: str = Field(default="Bundle", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    type: str
    timestamp: Optional[datetime] = None  # noqa: UP045
    identifier: Optional[Identifier] = None  # noqa: UP045
    entry: list[BundleEntry] = Field(default_factory=list)


Identifier.model_rebuild()
Reference.model_rebuild()
ContactPoint.model_rebuild()
    