"""Wave picking and sorting zone models."""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Wave(Base):
    __tablename__ = "waves"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wave_number: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    orders: Mapped[list["WaveOrder"]] = relationship(
        "WaveOrder", back_populates="wave", cascade="all, delete-orphan"
    )
    lines: Mapped[list["WaveLine"]] = relationship(
        "WaveLine", back_populates="wave", cascade="all, delete-orphan"
    )
    bins: Mapped[list["SortingBin"]] = relationship(
        "SortingBin", back_populates="wave", cascade="all, delete-orphan"
    )
    sorting_scans: Mapped[list["SortingScan"]] = relationship(
        "SortingScan", back_populates="wave", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_waves_status", "status"),
        Index("ix_waves_wave_number", "wave_number"),
        Index("ix_waves_created_by", "created_by"),
    )


class WaveOrder(Base):
    __tablename__ = "wave_orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wave_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("waves.id", ondelete="CASCADE"), nullable=False
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )

    wave: Mapped[Wave] = relationship("Wave", back_populates="orders")
    order = relationship("Order", lazy="joined")

    __table_args__ = (
        UniqueConstraint("wave_id", "order_id", name="uq_wave_orders_wave_order"),
        Index("ix_wave_orders_wave_id", "wave_id"),
        Index("ix_wave_orders_order_id", "order_id"),
    )


class WaveLine(Base):
    __tablename__ = "wave_lines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wave_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("waves.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    barcode: Mapped[str] = mapped_column(String(64), nullable=False)
    total_qty: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    picked_qty: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False, server_default="0")
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="OPEN")

    wave: Mapped[Wave] = relationship("Wave", back_populates="lines")
    product = relationship("Product", lazy="joined")
    allocations: Mapped[list["WaveAllocation"]] = relationship(
        "WaveAllocation", back_populates="wave_line", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("wave_id", "product_id", name="uq_wave_lines_wave_product"),
        Index("ix_wave_lines_wave_id", "wave_id"),
        Index("ix_wave_lines_product_id", "product_id"),
        Index("ix_wave_lines_wave_barcode", "wave_id", "barcode"),
    )


class WaveAllocation(Base):
    __tablename__ = "wave_allocations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wave_line_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wave_lines.id", ondelete="CASCADE"), nullable=False
    )
    stock_lot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("stock_lots.id", ondelete="RESTRICT"), nullable=False
    )
    location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="RESTRICT"), nullable=False
    )
    allocated_qty: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    picked_qty: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False, server_default="0")

    wave_line: Mapped[WaveLine] = relationship("WaveLine", back_populates="allocations")
    lot = relationship("StockLot", lazy="joined")
    location = relationship("Location", lazy="joined")

    __table_args__ = (
        UniqueConstraint("wave_line_id", "stock_lot_id", "location_id", name="uq_wave_allocations_line_lot_loc"),
        Index("ix_wave_allocations_wave_line_id", "wave_line_id"),
        Index("ix_wave_allocations_stock_lot_id", "stock_lot_id"),
    )


class SortingBin(Base):
    __tablename__ = "sorting_bins"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wave_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("waves.id", ondelete="CASCADE"), nullable=False
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    bin_code: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="OPEN")

    wave: Mapped[Wave] = relationship("Wave", back_populates="bins")
    order = relationship("Order", lazy="joined")

    __table_args__ = (
        UniqueConstraint("wave_id", "order_id", name="uq_sorting_bins_wave_order"),
        Index("ix_sorting_bins_wave_id", "wave_id"),
        Index("ix_sorting_bins_order_id", "order_id"),
    )


class WavePickScan(Base):
    __tablename__ = "wave_pick_scans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wave_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("waves.id", ondelete="CASCADE"), nullable=False
    )
    request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True)
    barcode: Mapped[str] = mapped_column(String(64), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    scanned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_wave_pick_scans_wave_id", "wave_id"),)


class SortingScan(Base):
    __tablename__ = "sorting_scans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wave_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("waves.id", ondelete="CASCADE"), nullable=False
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    barcode: Mapped[str] = mapped_column(String(64), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    scanned_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    scanned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True)

    wave: Mapped[Wave] = relationship("Wave", back_populates="sorting_scans")

    __table_args__ = (
        Index("ix_sorting_scans_wave_id", "wave_id"),
        Index("ix_sorting_scans_order_id", "order_id"),
        Index("ix_sorting_scans_wave_order_barcode", "wave_id", "order_id", "barcode"),
    )
