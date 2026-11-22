from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bed_allocation.models.allocation import AllocationSuggestionRecord
from bed_allocation.models.enums import SuggestionStatus
from bed_allocation.schemas.allocation import AllocationResult
from bed_allocation.services.allocation_service import materialize_allocation

# Naming: English identifiers throughout. Legacy Portuguese names were renamed
# in 0002_anglicize_allocation_suggestions. See CHANGELOG for details.

async def save_suggestions(session: AsyncSession, result: AllocationResult) -> None:
    if result.suggestions:
        session.add_all(
            [
                AllocationSuggestionRecord(
                    id=uuid4(),
                    encounter_id=item.encounter_id,
                    bed_id=item.bed_id,
                    score=item.score,
                    justification=item.justification,
                    status=SuggestionStatus.PENDING,
                )
                for item in result.suggestions
            ]
        )


async def list_suggestions(
    session: AsyncSession, status: SuggestionStatus | None = None
) -> list[AllocationSuggestionRecord]:
    query = select(AllocationSuggestionRecord).order_by(AllocationSuggestionRecord.created_at.desc())
    if status:
        query = query.where(AllocationSuggestionRecord.status == status)
    return list((await session.scalars(query)).all())


async def update_status(session: AsyncSession, suggestion_id: UUID, status: SuggestionStatus):
    suggestion = await session.get(AllocationSuggestionRecord, suggestion_id)
    if suggestion is None:
        return None
    if status == SuggestionStatus.ACCEPTED and suggestion.status == SuggestionStatus.PENDING:
        await materialize_allocation(session, suggestion)
    else:
        suggestion.status = status
    await session.commit()
    await session.refresh(suggestion)
    return suggestion

