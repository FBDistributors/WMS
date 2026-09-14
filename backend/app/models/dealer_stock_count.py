"""Diller ombor qoldig'i sanovi.

Sanov (ro'yxat) web'da yaratiladi, xodimlar telefonda uni ochib diller omboridagi
tovarni skanerlab sanaydi — holat, qulf va "yuborish" yo'q. Dillerlar WMS
ishlatmaydi, shuning uchun bu ma'lumot WMS zaxira ledgeriga (`stock_movements`)
UMUMAN tegmaydi — alohida hujjat. Diller = `settings_organizations.org_id`
(Smartup filial ID); nom hujjatda snapshot sifatida saqlanadi.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

#: Ichki belgi, foydalanuvchiga ko'rsatilmaydi: open — dillerning faol (oxirgi) sanovi,
#: telefonlarda ko'rinadi; closed — shu dillerga yangi sanov yaratilgach eskisi.
DEALER_COUNT_STATUSES = ("open", "closed")


class DealerStockCount(Base):
    __tablename__ = "dealer_stock_counts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    #: Ilova beradi — bir sanovni ikki marta yuborishga qarshi (idempotent POST).
    client_uuid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True)
    #: FK emas: tashkilot ro'yxatdan o'chsa ham hujjat qolishi kerak.
    dealer_org_id: Mapped[str] = mapped_column(String(64), nullable=False)
    dealer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    counted_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Ro'yxatda tez ko'rsatish uchun; saqlashda va submit'da qayta hisoblanadi.
    lines_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_units: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False, default=0)
    #: Qayerda yaratildi: mobile (noldan skan) / web (jadval) / sheet (tayyor ro'yxat).
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="mobile")
    #: Eski (holatli) oqimdan qolgan ustunlar — ishlatilmaydi, keyingi migratsiyada o'chiriladi.
    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    uncounted_policy: Mapped[str | None] = mapped_column(String(8), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    lines: Mapped[list["DealerStockCountLine"]] = relationship(
        "DealerStockCountLine",
        back_populates="count",
        cascade="all, delete-orphan",
        order_by="DealerStockCountLine.seq",
    )

    __table_args__ = (
        CheckConstraint(f"status IN {DEALER_COUNT_STATUSES}", name="ck_dealer_stock_counts_status"),
        Index("ix_dealer_stock_counts_dealer_org_id", "dealer_org_id"),
        Index("ix_dealer_stock_counts_counted_by", "counted_by_user_id"),
        Index("ix_dealer_stock_counts_status_created", "status", "created_at"),
    )


class DealerStockCountLine(Base):
    __tablename__ = "dealer_stock_count_lines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    count_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dealer_stock_counts.id", ondelete="CASCADE"), nullable=False
    )
    #: Skan tanilmasa null — xom shtrix-kod saqlanadi, admin ko'radi.
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    scanned_barcode: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    #: NULL — tayyor ro'yxatdagi hali sanalmagan qator; 0 — "dillerda yo'q" deb sanaldi.
    qty: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    #: Ro'yxat to'ldirilgandagi Smartup soni — telefonda internet bo'lmasa ham farq ko'rinsin.
    snapshot_qty: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    #: Oy boshi (YYYY-MM-01) — tizimdagi lot muddatlari bilan bir xil konvensiya.
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    #: Diller omboridagi joy (javon / zona, masalan "A-3") — bir tovar ikki joyda = ikki qator.
    location_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    scanned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Xodim haqiqatan sanagan payt; "0 deb hisobla" bilan to'ldirilgan qatorlarda bo'sh qoladi.
    counted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    counted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    count: Mapped[DealerStockCount] = relationship("DealerStockCount", back_populates="lines")

    __table_args__ = (
        CheckConstraint("qty IS NULL OR qty >= 0", name="ck_dealer_stock_count_lines_qty_nonneg"),
        Index("ix_dealer_stock_count_lines_count_id", "count_id"),
        Index("ix_dealer_stock_count_lines_product_id", "product_id"),
        # Bir mahsulot + muddat + joy = bitta qator (tanilmagan skanlar bundan mustasno).
        Index(
            "ux_dealer_stock_count_lines_product_expiry_loc",
            "count_id",
            "product_id",
            "expiry_date",
            "location_code",
            unique=True,
            postgresql_where=text("product_id IS NOT NULL"),
        ),
    )
