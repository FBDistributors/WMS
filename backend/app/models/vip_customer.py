"""VIP customer: customer_id, name; muddat chegaralari brand_limits va product_limits orqali."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class VipCustomer(Base):
    __tablename__ = "vip_customers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    brand_limits: Mapped[list["VipCustomerBrandLimit"]] = relationship(
        "VipCustomerBrandLimit",
        back_populates="vip_customer",
        cascade="all, delete-orphan",
    )
    product_limits: Mapped[list["VipCustomerProductLimit"]] = relationship(
        "VipCustomerProductLimit",
        back_populates="vip_customer",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_vip_customers_customer_id", "customer_id"),
    )
