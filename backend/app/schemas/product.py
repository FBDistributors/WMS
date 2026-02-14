from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, validator

ProductStatus = Literal["active", "inactive"]


def _clean_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped if stripped else None


def _normalize_barcodes(values: Optional[List[str]]) -> List[str]:
    if not values:
        return []
    normalized = []
    for raw in values:
        if raw is None:
            continue
        cleaned = raw.strip()
        if cleaned:
            normalized.append(cleaned)
    return normalized


class ProductOut(BaseModel):
    id: UUID
    name: str
    sku: str
    brand: Optional[str] = None
    brand_id: Optional[UUID] = None
    brand_name: Optional[str] = None
    brand_display_name: Optional[str] = None
    category: Optional[str] = None
    photo_url: Optional[str] = None
    is_active: bool
    barcodes: List[str] = Field(default_factory=list)
    barcode: Optional[str] = None
    created_at: datetime
    on_hand_total: Optional[float] = None
    available_total: Optional[float] = None


class ProductListOut(BaseModel):
    items: List[ProductOut]
    total: int
    limit: int
    offset: int


class ProductCreateIn(BaseModel):
    sku: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)
    brand: Optional[str] = Field(default=None, max_length=128)
    category: Optional[str] = Field(default=None, max_length=128)
    photo_url: Optional[str] = Field(default=None, max_length=512)
    status: ProductStatus = "active"
    barcodes: List[str] = Field(default_factory=list)

    @validator("sku", "name", "brand", "category", "photo_url", pre=True)
    def _strip_text(cls, value):  # noqa: N805
        return _clean_text(value)

    @validator("barcodes", pre=True)
    def _strip_barcodes(cls, value):  # noqa: N805
        return _normalize_barcodes(value)


class ProductImportItem(BaseModel):
    sku: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)
    brand: Optional[str] = Field(default=None, max_length=128)
    category: Optional[str] = Field(default=None, max_length=128)
    status: ProductStatus = "active"
    barcodes: List[str] = Field(default_factory=list)

    @validator("sku", "name", "brand", "category", pre=True)
    def _strip_text(cls, value):  # noqa: N805
        return _clean_text(value)

    @validator("barcodes", pre=True)
    def _strip_barcodes(cls, value):  # noqa: N805
        return _normalize_barcodes(value)
