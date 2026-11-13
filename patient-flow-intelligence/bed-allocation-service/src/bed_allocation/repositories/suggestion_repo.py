from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bed_allocation.models.allocation import SugestaoAlocacao
from bed_allocation.models.enums import SuggestionStatus
from bed_allocation.schemas.allocation import AllocationResult


async def save_suggestions(session: AsyncSession, result: AllocationResult) -> None:
    if result.suggestions:
        session.add_all(
            [
                SugestaoAlocacao(
                    id=uuid4(),
                    encounter_id=item.encounter_id,
                    bed_id=item.bed_id,
                    score=item.score,
                    justification=item.justification,
                    status=SuggestionStatus.PENDENTE,
                )
                for item in result.suggestions
            ]
        )
        await session.commit()


async def list_suggestions(
    session: AsyncSession, status: SuggestionStatus | None = None
) -> list[SugestaoAlocacao]:
    query = select(SugestaoAlocacao).order_by(SugestaoAlocacao.created_at.desc())
    if status:
        query = query.where(SugestaoAlocacao.status == status)
    return list((await session.scalars(query)).all())


async def update_status(session: AsyncSession, suggestion_id: UUID, status: SuggestionStatus):
    suggestion = await session.get(SugestaoAlocacao, suggestion_id)
    if suggestion is None:
        return None
    suggestion.status = status
    await session.commit()
    await session.refresh(suggestion)
    return suggestion

