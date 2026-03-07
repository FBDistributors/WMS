"""VIP customer: customer_id, name, min_expiry_months for allocation rules."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class VipCustomer(Base):
    __tablename__ = "vip_customers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    min_expiry_months: Mapped[int] = mapped_column(Integer, nullable=False, server_default="6")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_vip_customers_customer_id", "customer_id"),
    )
