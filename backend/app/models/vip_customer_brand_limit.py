"""VIP mijoz uchun brend bo'yicha muddat chegarasi (oy)."""
from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class VipCustomerBrandLimit(Base):
    __tablename__ = "vip_customer_brand_limits"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vip_customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vip_customers.id", ondelete="CASCADE"),
        nullable=False,
    )
    brand_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("brands.id", ondelete="CASCADE"),
        nullable=False,
    )
    min_expiry_months: Mapped[int] = mapped_column(Integer, nullable=False)

    vip_customer = relationship("VipCustomer", back_populates="brand_limits")

    __table_args__ = (
        UniqueConstraint("vip_customer_id", "brand_id", name="uq_vip_customer_brand_limits_vip_brand"),
        Index("ix_vip_customer_brand_limits_vip_customer_id", "vip_customer_id"),
        Index("ix_vip_customer_brand_limits_brand_id", "brand_id"),
    )
