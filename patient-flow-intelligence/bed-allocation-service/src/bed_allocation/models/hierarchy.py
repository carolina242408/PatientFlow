from __future__ import annotations

from uuid import UUID

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class ULS(Base):
    __tablename__ = "uls"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)


class HealthcareUnit(Base):
    __tablename__ = "healthcare_units"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    uls_id: Mapped[UUID] = mapped_column(ForeignKey("uls.id"))


class Building(Base):
    __tablename__ = "buildings"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    unit_id: Mapped[UUID] = mapped_column(ForeignKey("healthcare_units.id"))


class Floor(Base):
    __tablename__ = "floors"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    level_name: Mapped[str] = mapped_column(String)
    building_id: Mapped[UUID] = mapped_column(ForeignKey("buildings.id"))


class ClinicalService(Base):
    __tablename__ = "clinical_services"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    floor_id: Mapped[UUID] = mapped_column(ForeignKey("floors.id"))


class Wing(Base):
    __tablename__ = "wings"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    service_id: Mapped[UUID] = mapped_column(ForeignKey("clinical_services.id"))


class Ward(Base):
    __tablename__ = "wards"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    wing_id: Mapped[UUID] = mapped_column(ForeignKey("wings.id"))


class Room(Base):
    __tablename__ = "rooms"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String)
    ward_id: Mapped[UUID] = mapped_column(ForeignKey("wards.id"))


class Bed(Base):
    __tablename__ = "beds"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String)
    room_id: Mapped[UUID] = mapped_column(ForeignKey("rooms.id"))
    status: Mapped[str] = mapped_column(String)
    version: Mapped[int] = mapped_column(Integer)
    status_reason: Mapped[str | None] = mapped_column(String, nullable=True)
