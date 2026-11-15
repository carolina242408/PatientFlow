from datetime import datetime, timezone
import logging
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from bed_allocation.db import get_session
from bed_allocation.config import settings
from bed_allocation.models.allocation import AllocationSuggestionRecord
from bed_allocation.models.hierarchy import ClinicalService
from bed_allocation.models.patient import Encounter, Patient
from bed_allocation.models.enums import SuggestionStatus
from bed_allocation.repositories.bed_repo import (
    get_available_beds,
    get_beds_with_imminent_discharge,
    get_displaceable_allocations,
)
from bed_allocation.repositories.patient_repo import get_patients_waiting
from bed_allocation.repositories.suggestion_repo import list_suggestions, update_status
from bed_allocation.schemas.allocation import (
    AllocationResult,
    ImminentBed,
    ManualAdmissionRequest,
    ManualAdmissionResult,
    ServiceResponse,
    SuggestionResponse,
    SuggestionStatusUpdate,
)
from bed_allocation.schemas.patient_waiting import PatientWaiting
from bed_allocation.services.allocation_service import suggest_allocations
from bed_allocation.solver.optimizer import optimize, reallocation_suggestions

router = APIRouter(prefix="/api/v1")
logger = logging.getLogger(__name__)


class AllocationRequest(BaseModel):
    encounter_ids: list[UUID] | None = None


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/pacientes-a-aguardar", response_model=list[PatientWaiting])
async def waiting_patients(
    session: AsyncSession = Depends(get_session),
) -> list[PatientWaiting]:
    return await get_patients_waiting(session)


@router.post("/sugerir-alocacao", response_model=AllocationResult)
async def suggest(
    payload: AllocationRequest | None = None,
    session: AsyncSession = Depends(get_session),
) -> AllocationResult:
    return await suggest_allocations(session, payload.encounter_ids if payload else None)


@router.get("/sugestoes", response_model=list[SuggestionResponse])
async def suggestions(
    status: SuggestionStatus | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> list:
    return await list_suggestions(session, status)


@router.patch("/sugestoes/{suggestion_id}", response_model=SuggestionResponse)
async def change_status(
    suggestion_id: UUID,
    payload: SuggestionStatusUpdate,
    session: AsyncSession = Depends(get_session),
) -> object:
    if payload.status == SuggestionStatus.PENDING:
        raise HTTPException(status_code=422, detail="Only ACCEPTED or REJECTED are valid updates")
    if payload.status not in {SuggestionStatus.ACCEPTED, SuggestionStatus.REJECTED}:
        raise HTTPException(status_code=422, detail="Only ACCEPTED or REJECTED are valid updates")
    suggestion = await update_status(session, suggestion_id, SuggestionStatus(payload.status))
    if suggestion is None:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return suggestion


@router.get("/servicos", response_model=list[ServiceResponse])
async def services(session: AsyncSession = Depends(get_session)) -> list[ClinicalService]:
    result = await session.execute(select(ClinicalService).order_by(ClinicalService.code))
    return list(result.scalars().all())


@router.get("/camas-disponiveis")
async def available_beds(session: AsyncSession = Depends(get_session)):
    return await get_available_beds(session)


@router.get("/camas-em-libertacao-breve", response_model=list[ImminentBed])
async def imminent_beds(
    within_hours: int = Query(default=24, ge=1, le=168),
    session: AsyncSession = Depends(get_session),
) -> list[ImminentBed]:
    result = await get_beds_with_imminent_discharge(session, within_hours)
    return [
        ImminentBed(
            bed_id=bed.bed_id,
            bed_label=f"{bed.ward_name} · {bed.room_code} · Cama {bed.bed_code}",
            current_patient_name=patient_name,
            expected_discharge_at=(
                await session.scalar(
                    text("SELECT expected_discharge_at FROM encounters e "
                         "JOIN location_allocations la ON la.encounter_id=e.id "
                         "WHERE la.bed_id=:bed_id AND la.discharged_at IS NULL"),
                    {"bed_id": bed.bed_id},
                )
            ),
            hours_until_free=hours,
        )
        for bed, hours, patient_name in result
    ]


@router.post(
    "/manual-admissions", response_model=ManualAdmissionResult, status_code=201
)
async def manual_admission(
    payload: ManualAdmissionRequest,
    debug: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
) -> ManualAdmissionResult:
    patient_id = uuid4()
    encounter_id = uuid4()
    session.add(
        Patient(
            id=patient_id,
            full_name=payload.full_name,
            birth_date=payload.birth_date,
            gender=payload.gender,
            isolation=payload.isolation,
            sns_number=payload.sns_number,
            hospital_number=payload.hospital_number,
            version=0,
        )
    )
    await session.flush()
    session.add(
        Encounter(
            id=encounter_id,
            visit_number=f"MAN-{datetime.now(timezone.utc):%Y%m%d%H%M%S%f}",
            patient_id=patient_id,
            status="IN_PROGRESS",
            start_period=datetime.now(timezone.utc),
            service_id=payload.service_id,
            expected_discharge_at=payload.expected_discharge_at,
            version=0,
        )
    )
    settings.priority_by_encounter[encounter_id] = payload.priority
    try:
        await session.flush()
        waiting = [
            PatientWaiting(
                encounter_id=encounter_id,
                service_id=payload.service_id,
                patient_id=patient_id,
                full_name=payload.full_name,
                birth_date=payload.birth_date,
                gender=payload.gender,
                isolation=payload.isolation,
                expected_discharge_at=payload.expected_discharge_at,
            )
        ]
        beds = await get_available_beds(session)
        imminent = await get_beds_with_imminent_discharge(
            session, settings.imminent_discharge_hours
        )
        waiting_patients = await get_patients_waiting(session)
        allocations = await get_displaceable_allocations(session)
        result = optimize(
            [waiting[0]],
            beds,
            {bed.bed_id: hours for bed, hours, _ in imminent},
            comparison_patients=waiting_patients,
            debug=debug,
            allocations=allocations,
        )
        reallocations = reallocation_suggestions(
            waiting[0],
            beds,
            allocations,
            {bed.bed_id: hours for bed, hours, _ in imminent},
            max((suggestion.score for suggestion in result.suggestions), default=None),
        )
        await session.commit()
        return ManualAdmissionResult(
            encounter_id=encounter_id,
            patient_id=patient_id,
            suggestions=result.suggestions,
            reallocations=reallocations,
            comparisons=result.comparisons,
            room_eviction_ranking=result.room_eviction_ranking,
            solver_status=result.solver_status,
            debug_enabled=debug,
        )
    except IntegrityError as error:
        await session.rollback()
        logger.exception("Manual admission transaction failed", exc_info=error)
        raise HTTPException(status_code=409, detail="Bed is no longer available") from error
