from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class SafeCancelReturnSession(Base):
    """Admin xavfsiz bekor: yig'uvchi tovarlarni joyiga qaytarguncha `returns_pending`."""

    __tablename__ = "safe_cancel_return_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    picker_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    initiated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="returns_pending")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    lines: Mapped[list["SafeCancelReturnLine"]] = relationship(
        "SafeCancelReturnLine",
        back_populates="session",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_safe_cancel_return_sessions_document_id", "document_id"),
        Index("ix_safe_cancel_return_sessions_picker_user_id", "picker_user_id"),
        Index("ix_safe_cancel_return_sessions_status", "status"),
    )


class SafeCancelReturnLine(Base):
    __tablename__ = "safe_cancel_return_lines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("safe_cancel_return_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    document_line_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_lines.id", ondelete="CASCADE"), nullable=False
    )
    expected_location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="RESTRICT"), nullable=False
    )
    expected_location_code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    lot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("stock_lots.id", ondelete="RESTRICT"), nullable=False
    )
    product_name: Mapped[str] = mapped_column(String(512), nullable=False)
    barcode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sku: Mapped[str | None] = mapped_column(String(64), nullable=True)
    qty_to_return: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    location_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    product_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    session: Mapped["SafeCancelReturnSession"] = relationship(
        "SafeCancelReturnSession", back_populates="lines"
    )

    __table_args__ = (
        Index("ix_safe_cancel_return_lines_session_id", "session_id"),
        Index("ix_safe_cancel_return_lines_document_line_id", "document_line_id"),
    )
