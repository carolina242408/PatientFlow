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
    coding: Optional[list[Coding]] = None  # noqa: UP045
    text: Optional[str] = None  # noqa: UP045


class Identifier(FHIRModel):
    value: Optional[str] = None  # noqa: UP045
    system: Optional[str] = None  # noqa: UP045
    type: Optional[CodeableConcept] = None  # noqa: UP045
    use: Optional[str] = None  # noqa: UP045
    period: Optional["Period"] = None  # noqa: UP045
    assigner: Optional["Reference"] = None  # noqa: UP045


class Reference(FHIRModel):
    reference: Optional[str] = None  # noqa: UP045
    type: Optional[str] = None  # noqa: UP045
    identifier: Optional[Identifier] = None  # noqa: UP045
    display: Optional[str] = None  # noqa: UP045


class HumanName(FHIRModel):
    use: Optional[str] = None  # noqa: UP045
    family: Optional[str] = None  # noqa: UP045
    given: Optional[list[str]] = None  # noqa: UP045
    text: Optional[str] = None  # noqa: UP045
    prefix: Optional[list[str]] = None  # noqa: UP045
    suffix: Optional[list[str]] = None  # noqa: UP045


class Address(FHIRModel):
    line: Optional[list[str]] = None  # noqa: UP045
    city: Optional[str] = None  # noqa: UP045
    state: Optional[str] = None  # noqa: UP045
    postal_code: Optional[str] = Field(default=None, alias="postalCode")
    country: Optional[str] = None  # noqa: UP045
    district: Optional[str] = None  # noqa: UP045
    use: Optional[str] = None  # noqa: UP045
    type: Optional[str] = None  # noqa: UP045
    text: Optional[str] = None  # noqa: UP045


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
    start: Optional[str | datetime] = None  # noqa: UP045
    end: Optional[str | datetime] = None  # noqa: UP045


class Quantity(FHIRModel):
    value: Optional[float] = None  # noqa: UP045
    unit: Optional[str] = None  # noqa: UP045
    system: Optional[str] = None  # noqa: UP045
    code: Optional[str] = None  # noqa: UP045


class Patient(FHIRModel):
    resource_type: str = Field(default="Patient", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    text: Optional[dict] = None  # noqa: UP045
    identifier: Optional[list[Identifier]] = None  # noqa: UP045
    name: Optional[list[HumanName]] = None  # noqa: UP045
    birth_date: Optional[str] = Field(default=None, alias="birthDate")
    gender: Optional[str] = None  # noqa: UP045
    address: Optional[list[Address]] = None  # noqa: UP045
    telecom: Optional[list[ContactPoint]] = None  # noqa: UP045
    marital_status: Optional[CodeableConcept] = Field(
        default=None, alias="maritalStatus"
    )
    active: Optional[bool] = None  # noqa: UP045
    deceased_boolean: Optional[bool] = Field(default=None, alias="deceasedBoolean")
    communication: Optional[list[Communication]] = None  # noqa: UP045


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
    operational_status: Optional[Coding] = Field( #noqa: UP045
        default=None, alias="operationalStatus"
    )
    name: Optional[str] = None  # noqa: UP045
    description: Optional[str] = None  # noqa: UP045
    mode: Optional[str] = None  # noqa: UP045
    type: list[CodeableConcept] = Field(default_factory=list)
    telecom: list[ContactPoint] = Field(default_factory=list)
    address: Optional[Address] = None  # noqa: UP045
    physical_type: Optional[CodeableConcept] = Field( #noqa: UP045
        default=None, alias="physicalType"
    )
    managing_organization: Optional[Reference] = Field( #noqa: UP045
        default=None, alias="managingOrganization"
    )
    part_of: Optional[Reference] = Field(default=None, alias="partOf") #noqa: UP045


class EncounterParticipant(FHIRModel):
    type: list[CodeableConcept] = Field(default_factory=list)
    period: Optional[Period] = None  # noqa: UP045
    individual: Optional[Reference] = None  # noqa: UP045


class EncounterLocation(FHIRModel):
    location: Reference
    status: Optional[str] = None  # noqa: UP045
    physical_type: Optional[CodeableConcept] = Field( #noqa: UP045
        default=None, alias="physicalType"
    )
    period: Optional[Period] = None  # noqa: UP045


class EncounterHospitalization(FHIRModel):
    pre_admission_identifier: Optional[Identifier] = Field( #noqa: UP045
        default=None, alias="preAdmissionIdentifier"
    )
    origin: Optional[Reference] = None  # noqa: UP045
    admit_source: Optional[CodeableConcept] = Field(default=None, alias="admitSource") #noqa: UP045
    re_admission: Optional[CodeableConcept] = Field( #noqa: UP045
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
    discharge_disposition: Optional[CodeableConcept] = Field( #noqa: UP045
        default=None, alias="dischargeDisposition"
    )


class Encounter(FHIRModel):
    resource_type: str = Field(default="Encounter", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    text: Optional[dict] = None  # noqa: UP045
    status: str
    class_: Optional[list[CodeableConcept]] = Field(default=None, alias="class")  # noqa: UP045
    identifier: Optional[list[Identifier]] = None  # noqa: UP045
    subject: Optional[Reference] = None  # noqa: UP045
    participant: Optional[list[EncounterParticipant]] = None  # noqa: UP045
    location: Optional[list[EncounterLocation]] = None  # noqa: UP045
    actual_period: Optional[Period] = Field(default=None, alias="actualPeriod")  # noqa: UP045
    period: Optional[Period] = None  # noqa: UP045
    status_history: Optional[list[dict]] = Field(default=None, alias="statusHistory")
    type: Optional[list[CodeableConcept]] = None  # noqa: UP045
    service_type: Optional[CodeableConcept] = Field(default=None, alias="serviceType")  # noqa: UP045
    priority: Optional[CodeableConcept] = None  # noqa: UP045
    episode_of_care: Optional[list[Reference]] = Field(default=None, alias="episodeOfCare")
    based_on: Optional[list[Reference]] = Field(default=None, alias="basedOn")
    appointment: Optional[list[Reference]] = None  # noqa: UP045
    length: Optional[Quantity] = None  # noqa: UP045
    reason_code: Optional[list[CodeableConcept]] = Field(default=None, alias="reasonCode")
    diagnosis: Optional[list[dict]] = None  # noqa: UP045
    account: Optional[list[Reference]] = None  # noqa: UP045
    hospitalization: Optional[EncounterHospitalization] = None  # noqa: UP045
    service_provider: Optional[Reference] = Field(default=None, alias="serviceProvider")  # noqa: UP045


class Condition(FHIRModel):
    resource_type: str = Field(default="Condition", alias="resourceType")
    id: Optional[str] = None  # noqa: UP045
    identifier: list[Identifier] = Field(default_factory=list)
    clinical_status: Optional[CodeableConcept] = Field( #noqa: UP045
        default=None, alias="clinicalStatus"
    )
    verification_status: Optional[CodeableConcept] = Field( #noqa: UP045
        default=None, alias="verificationStatus"
    )
    category: list[CodeableConcept] = Field(default_factory=list)
    severity: Optional[CodeableConcept] = None  # noqa: UP045
    code: CodeableConcept
    body_site: list[CodeableConcept] = Field(default_factory=list, alias="bodySite")
    subject: Reference
    encounter: Optional[Reference] = None  # noqa: UP045
    onset_date_time: Optional[str] = Field(default=None, alias="onsetDateTime") #noqa: UP045
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
    type: str
    timestamp: Optional[str | datetime] = None  # noqa: UP045
    id: Optional[str] = None  # noqa: UP045
    identifier: Optional[Identifier] = None  # noqa: UP045
    entry: list[BundleEntry] = Field(default_factory=list)


Identifier.model_rebuild()
Reference.model_rebuild()
ContactPoint.model_rebuild()
    