from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

PLACEMENT_SEALED = "sealed"
PLACEMENT_REMOVED = "removed"


class LocationBoxPlacement(Base):
    """Jismoniy yopiq quti joylashuvi (lokatsiya + partiya)."""

    __tablename__ = "location_box_placements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_box_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("product_boxes.id", ondelete="CASCADE"),
        nullable=False,
    )
    location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("locations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    lot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("stock_lots.id", ondelete="RESTRICT"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default=PLACEMENT_SEALED)
    placed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    placed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    removed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    remove_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)

    product_box = relationship("ProductBox", lazy="joined")
    location = relationship("Location", lazy="joined")
    lot = relationship("StockLot", lazy="joined")

    __table_args__ = (
        Index("ix_location_box_placements_location_lot", "location_id", "lot_id"),
        Index("ix_location_box_placements_product_box_id", "product_box_id"),
        Index("ix_location_box_placements_status", "status"),
    )
