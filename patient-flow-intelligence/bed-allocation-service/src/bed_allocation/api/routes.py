from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from bed_allocation.db import get_session
from bed_allocation.models.enums import SuggestionStatus
from bed_allocation.repositories.patient_repo import get_patients_waiting
from bed_allocation.repositories.suggestion_repo import list_suggestions, update_status
from bed_allocation.schemas.allocation import (
    AllocationResult,
    SuggestionResponse,
    SuggestionStatusUpdate,
)
from bed_allocation.schemas.patient_waiting import PatientWaiting
from bed_allocation.services.allocation_service import suggest_allocations

router = APIRouter(prefix="/api/v1")


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
    if payload.status == SuggestionStatus.PENDENTE:
        raise HTTPException(status_code=422, detail="Only ACEITE or REJEITADA are valid updates")
    suggestion = await update_status(session, suggestion_id, payload.status)
    if suggestion is None:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return suggestion
