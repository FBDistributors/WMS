from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class ProductBox(Base):
    """Quti (karobka) shtrix-kodi — mahsulotga bog'langan, ichidagi dona soni bilan."""

    __tablename__ = "product_boxes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    box_barcode: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
    )
    units_per_box: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    product = relationship("Product", back_populates="boxes", lazy="joined")

    __table_args__ = (
        Index("ix_product_boxes_box_barcode", "box_barcode"),
        Index("ix_product_boxes_product_id", "product_id"),
        Index("ix_product_boxes_is_active", "is_active"),
    )
