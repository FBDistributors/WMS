from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class SmartupOrderLine(BaseModel):
    sku: Optional[str] = None
    barcode: Optional[str] = None
    name: str
    qty: float = Field(..., alias="quantity")


class SmartupOrder(BaseModel):
    external_id: str = Field(..., alias="deal_id")
    order_no: Optional[str] = Field(default=None, alias="order_no")
    created_at: Optional[datetime] = None
    filial_code: Optional[str] = None
    lines: List[SmartupOrderLine]


class SmartupOrderExportResponse(BaseModel):
    items: List[SmartupOrder] = Field(default_factory=list, alias="data")
    total: Optional[int] = None

    # TODO: Confirm Smartup response shape and extend schema.
