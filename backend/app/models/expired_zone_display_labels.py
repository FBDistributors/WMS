from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

EXPIRED_ZONE_LABELS_SINGLETON_ID = 1


class ExpiredZoneDisplayLabels(Base):
    """Single-row settings: numeric labels shown for EXPIRED slots A and B (updated manually)."""

    __tablename__ = "expired_zone_display_labels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=EXPIRED_ZONE_LABELS_SINGLETON_ID)
    label_for_slot_a: Mapped[int | None] = mapped_column(Integer, nullable=True)
    label_for_slot_b: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
