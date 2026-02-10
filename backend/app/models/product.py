from __future__ import annotations

import uuid
from datetime import datetime
from typing import List

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Product(Base):
    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_source: Mapped[str] = mapped_column(String(32), nullable=False, default="smartup")
    external_id: Mapped[str] = mapped_column(String(128), nullable=False)
    smartup_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    short_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    barcode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    article_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    brand: Mapped[str | None] = mapped_column(String(128), nullable=True)
    category: Mapped[str | None] = mapped_column(String(128), nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    smartup_groups: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    raw_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    barcodes: Mapped[List["ProductBarcode"]] = relationship(
        "ProductBarcode",
        back_populates="product",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    __table_args__ = (
        Index("ix_products_sku", "sku"),
        Index("ix_products_name", "name"),
        Index("ix_products_external_id", "external_id"),
        Index("ix_products_smartup_code", "smartup_code"),
        Index("ix_products_barcode", "barcode"),
        Index("ix_products_is_active", "is_active"),
        Index("uq_products_external_source_external_id", "external_source", "external_id", unique=True),
    )


class ProductBarcode(Base):
    __tablename__ = "product_barcodes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
    )
    barcode: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    product: Mapped[Product] = relationship("Product", back_populates="barcodes")

    __table_args__ = (
        Index("ix_product_barcodes_barcode", "barcode"),
    )
