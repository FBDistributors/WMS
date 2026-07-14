"""SmartUp mijoz qaytarishlari (mdeal/return$export) — o'qish uchun sinxronlangan.

Faqat ko'rsatish uchun emas: kelajakda qaytimni yig'uvchiga yuborish (ish oqimi)
uchun ham ishlatiladi, shuning uchun `wms_status` maydoni bor.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class SmartupReturn(Base):
    __tablename__ = "smartup_returns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # SmartUp deal_id — noyob identifikator (upsert kaliti).
    deal_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    order_deal_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    return_date: Mapped[date | None] = mapped_column(Date, nullable=True)  # booked_date
    deal_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    person_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    person_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    person_tin: Mapped[str | None] = mapped_column(String(32), nullable=True)

    filial_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    return_reason_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    return_reason_code: Mapped[str | None] = mapped_column(String(64), nullable=True)

    sales_manager_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sales_manager_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    total_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    currency_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str | None] = mapped_column(String(16), nullable=True)  # SmartUp status (A, ...)
    note: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    # WMS ish oqimi holati (kelajakda yig'uvchiga yuborish uchun). Standart: new.
    wms_status: Mapped[str] = mapped_column(String(24), nullable=False, server_default="new")

    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    lines: Mapped[list["SmartupReturnLine"]] = relationship(
        "SmartupReturnLine",
        back_populates="return_doc",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_smartup_returns_return_date", "return_date"),
        Index("ix_smartup_returns_person_code", "person_code"),
        Index("ix_smartup_returns_wms_status", "wms_status"),
    )


class SmartupReturnLine(Base):
    __tablename__ = "smartup_return_lines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    return_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("smartup_returns.id", ondelete="CASCADE"),
        nullable=False,
    )
    product_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    product_article_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    product_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    return_quant: Mapped[Decimal | None] = mapped_column(Numeric(18, 3), nullable=True)
    product_price: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    sold_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    expiry_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    serial_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    warehouse_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    line_no: Mapped[int | None] = mapped_column(Integer, nullable=True)

    return_doc: Mapped["SmartupReturn"] = relationship("SmartupReturn", back_populates="lines")

    __table_args__ = (
        Index("ix_smartup_return_lines_return_id", "return_id"),
    )
