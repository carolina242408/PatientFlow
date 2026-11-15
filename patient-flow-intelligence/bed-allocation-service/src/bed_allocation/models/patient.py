from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .hierarchy import Base


class Patient(Base):
    __tablename__ = "patients"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    sns_number: Mapped[str | None] = mapped_column(String, nullable=True)
    hospital_number: Mapped[str | None] = mapped_column(String, nullable=True)
    full_name: Mapped[str] = mapped_column(String)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[str | None] = mapped_column(String, nullable=True)
    isolation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    version: Mapped[int] = mapped_column(Integer)


class Encounter(Base):
    __tablename__ = "encounters"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    visit_number: Mapped[str | None] = mapped_column(String, nullable=True)
    patient_id: Mapped[UUID] = mapped_column(ForeignKey("patients.id"))
    status: Mapped[str] = mapped_column(String)
    start_period: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_period: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer)
    expected_discharge_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    clinical_discharge_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    service_id: Mapped[UUID | None] = mapped_column(ForeignKey("clinical_services.id"), nullable=True)

