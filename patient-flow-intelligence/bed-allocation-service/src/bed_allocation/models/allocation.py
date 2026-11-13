from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from .hierarchy import Base


class LocationAllocation(Base):
    __tablename__ = "location_allocations"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    encounter_id: Mapped[UUID] = mapped_column(ForeignKey("encounters.id"))
    bed_id: Mapped[UUID] = mapped_column(ForeignKey("beds.id"))
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    discharged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SugestaoAlocacao(Base):
    __tablename__ = "sugestoes_alocacao"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    encounter_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    bed_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    score: Mapped[float] = mapped_column(nullable=False)
    justification: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDENTE")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

