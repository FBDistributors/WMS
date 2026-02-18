from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_no: Mapped[str] = mapped_column(String(64), nullable=False)
    doc_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_document_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_filial_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="SET NULL"), nullable=True
    )
    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    controlled_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    lines: Mapped[list[DocumentLine]] = relationship(
        "DocumentLine",
        back_populates="document",
        cascade="all, delete-orphan",
    )
    assigned_to_user = relationship(
        "User",
        foreign_keys=[assigned_to_user_id],
        lazy="selectin",
    )
    controlled_by_user = relationship(
        "User",
        foreign_keys=[controlled_by_user_id],
        lazy="selectin",
    )

    __table_args__ = (
        UniqueConstraint("doc_no", "doc_type", name="uq_documents_doc_no_doc_type"),
        UniqueConstraint(
            "source_external_id",
            "doc_type",
            name="uq_documents_source_external_id_doc_type",
        ),
        Index("ix_documents_doc_no", "doc_no"),
        Index("ix_documents_status", "status"),
        Index("ix_documents_source", "source"),
        Index("ix_documents_source_external_id", "source_external_id"),
        Index("ix_documents_assigned_to_user_id", "assigned_to_user_id"),
        Index("ix_documents_controlled_by_user_id", "controlled_by_user_id"),
    )


class DocumentLine(Base):
    __tablename__ = "document_lines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"), nullable=True
    )
    lot_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("stock_lots.id", ondelete="RESTRICT"), nullable=True
    )
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="RESTRICT"), nullable=True
    )
    sku: Mapped[str | None] = mapped_column(String(64), nullable=True)
    product_name: Mapped[str] = mapped_column(String(128), nullable=False)
    barcode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    location_code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    batch: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    required_qty: Mapped[float] = mapped_column(Float, nullable=False)
    picked_qty: Mapped[float] = mapped_column(Float, nullable=False, server_default="0")

    document: Mapped[Document] = relationship("Document", back_populates="lines")

    __table_args__ = (
        Index("ix_document_lines_document_id", "document_id"),
        Index("ix_document_lines_product_id", "product_id"),
        Index("ix_document_lines_lot_id", "lot_id"),
        Index("ix_document_lines_location_id", "location_id"),
    )
