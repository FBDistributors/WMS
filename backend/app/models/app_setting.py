"""Umumiy kalit-qiymat sozlamalari (admin boshqaradi).

Birinchi ishlatuvchi: sotuv muddat chegarasi (sale_expiry_cutoff). Kichik,
bir-qiymatli operatsion sozlamalar uchun — tarixi shart bo'lsa (masalan ish
haqiga ta'sir qilsa) alohida sanali jadval ishlating (payroll_* naqshlari).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str | None] = mapped_column(String(512), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
