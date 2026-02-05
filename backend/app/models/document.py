from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_no: Mapped[str] = mapped_column(String(64), nullable=False)
    doc_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
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

    __table_args__ = (
        UniqueConstraint("doc_no", "doc_type", name="uq_documents_doc_no_doc_type"),
        Index("ix_documents_doc_no", "doc_no"),
        Index("ix_documents_status", "status"),
    )


class DocumentLine(Base):
    __tablename__ = "document_lines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    sku: Mapped[str | None] = mapped_column(String(64), nullable=True)
    product_name: Mapped[str] = mapped_column(String(128), nullable=False)
    barcode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    location_code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    required_qty: Mapped[float] = mapped_column(Float, nullable=False)
    picked_qty: Mapped[float] = mapped_column(Float, nullable=False, server_default="0")

    document: Mapped[Document] = relationship("Document", back_populates="lines")

    __table_args__ = (Index("ix_document_lines_document_id", "document_id"),)
