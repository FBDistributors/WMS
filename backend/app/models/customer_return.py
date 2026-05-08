from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

# pending_controller -> approved -> assigned_to_picker -> completed | cancelled
CUSTOMER_RETURN_STATUS_PENDING = "pending_controller"
CUSTOMER_RETURN_STATUS_APPROVED = "approved"
CUSTOMER_RETURN_STATUS_ASSIGNED = "assigned_to_picker"
CUSTOMER_RETURN_STATUS_COMPLETED = "completed"
CUSTOMER_RETURN_STATUS_CANCELLED = "cancelled"


class CustomerReturn(Base):
    """Mijozdan qaytgan mahsulot: avval controller tekshiruvi, keyin yig'uvchi joylashtiradi."""

    __tablename__ = "customer_returns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_no: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    customer_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reason_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=CUSTOMER_RETURN_STATUS_PENDING)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    assigned_picker_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    assigned_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    lines: Mapped[list["CustomerReturnLine"]] = relationship(
        "CustomerReturnLine",
        back_populates="customer_return",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_customer_returns_status", "status"),
        Index("ix_customer_returns_created_at", "created_at"),
        Index("ix_customer_returns_assigned_picker_user_id", "assigned_picker_user_id"),
        Index("ix_customer_returns_assigned_by_user_id", "assigned_by_user_id"),
        Index("ix_customer_returns_customer_id", "customer_id"),
    )


class CustomerReturnLine(Base):
    __tablename__ = "customer_return_lines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_return_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customer_returns.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="RESTRICT"), nullable=True
    )
    product_name: Mapped[str] = mapped_column(String(512), nullable=False)
    location_code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    qty: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    batch: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    customer_return: Mapped["CustomerReturn"] = relationship("CustomerReturn", back_populates="lines")

    __table_args__ = (
        Index("ix_customer_return_lines_return_id", "customer_return_id"),
        Index("ix_customer_return_lines_product_id", "product_id"),
    )
