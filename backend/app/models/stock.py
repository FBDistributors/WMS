from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class StockLot(Base):
    __tablename__ = "stock_lots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
    )
    batch: Mapped[str] = mapped_column(String(64), nullable=False)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    product = relationship("Product", lazy="joined")

    __table_args__ = (
        Index("ix_stock_lots_product_id", "product_id"),
        Index("ix_stock_lots_expiry_date", "expiry_date"),
        Index("uq_stock_lots_product_batch_expiry", "product_id", "batch", "expiry_date", unique=True),
    )


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", ondelete="RESTRICT"),
        nullable=False,
    )
    lot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("stock_lots.id", ondelete="RESTRICT"),
        nullable=False,
    )
    location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("locations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    qty_change: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    movement_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_document_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_document_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    product = relationship("Product", lazy="joined")
    lot = relationship("StockLot", lazy="joined")
    location = relationship("Location", lazy="joined")

    __table_args__ = (
        Index("ix_stock_movements_product_id", "product_id"),
        Index("ix_stock_movements_lot_id", "lot_id"),
        Index("ix_stock_movements_location_id", "location_id"),
        Index("ix_stock_movements_type", "movement_type"),
        Index("ix_stock_movements_created_at", "created_at"),
        Index("ix_stock_movements_source_doc", "source_document_type", "source_document_id"),
        Index("ix_stock_movements_product_lot_location", "product_id", "lot_id", "location_id"),
    )
