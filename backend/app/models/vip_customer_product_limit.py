"""VIP mijoz uchun mahsulot bo'yicha muddat chegarasi (oy) — brend limitini almashtiradi."""
from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class VipCustomerProductLimit(Base):
    __tablename__ = "vip_customer_product_limits"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vip_customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vip_customers.id", ondelete="CASCADE"),
        nullable=False,
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
    )
    min_expiry_months: Mapped[int] = mapped_column(Integer, nullable=False)

    vip_customer = relationship("VipCustomer", back_populates="product_limits")
    product = relationship("Product")

    __table_args__ = (
        UniqueConstraint("vip_customer_id", "product_id", name="uq_vip_customer_product_limits_vip_product"),
        Index("ix_vip_customer_product_limits_vip_customer_id", "vip_customer_id"),
        Index("ix_vip_customer_product_limits_product_id", "product_id"),
    )
