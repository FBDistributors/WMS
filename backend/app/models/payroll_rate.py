"""Ish haqi tarifi: bitta buyurtma uchun to'lov (rol + manba guruhi bo'yicha).

Tarif kodda emas, bazada — admin uni o'zi o'zgartiradi va o'zgarish hamma
qurilmada darrov ko'rinadi (ilovani qayta chiqarish shart emas).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Numeric, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

#: Tarif qo'llanadigan rollar.
PAYROLL_ROLES = ("picker", "controller")
#: Manba guruhlari — `order_source_group` bilan bir xil.
PAYROLL_GROUPS = ("shahar", "region")


class PayrollRate(Base):
    __tablename__ = "payroll_rates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    source_group: Mapped[str] = mapped_column(String(16), nullable=False)
    #: Bitta buyurtma uchun so'mda.
    amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("role", "source_group", name="uq_payroll_rates_role_group"),
    )
