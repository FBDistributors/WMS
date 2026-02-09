from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator, root_validator


class SmartupOrderLine(BaseModel):
    sku: Optional[str] = Field(default=None, alias="sku")
    barcode: Optional[str] = Field(default=None, alias="barcode")
    name: Optional[str] = Field(default=None, alias="name")
    qty: float = Field(0, alias="quantity")
    uom: Optional[str] = Field(default=None, alias="uom")

    @root_validator(pre=True)
    def _normalize_qty(cls, values):  # noqa: N805
        if "quantity" in values:
            return values
        if "qty" in values:
            values["quantity"] = values.get("qty")
        return values


class SmartupOrder(BaseModel):
    external_id: Optional[str] = Field(default=None, alias="external_id")
    deal_id: Optional[str] = Field(default=None, alias="deal_id")
    order_no: Optional[str] = Field(default=None, alias="order_no")
    filial_id: Optional[str] = Field(default=None, alias="filial_id")
    filial_code: Optional[str] = Field(default=None, alias="filial_code")
    deal_time: Optional[datetime] = Field(default=None, alias="deal_time")
    delivery_date: Optional[datetime] = Field(default=None, alias="delivery_date")
    created_on: Optional[datetime] = Field(default=None, alias="created_on")
    modified_on: Optional[datetime] = Field(default=None, alias="modified_on")
    customer_name: Optional[str] = Field(default=None, alias="customer_name")
    lines: List[SmartupOrderLine] = Field(default_factory=list)

    @field_validator("deal_time", "delivery_date", "created_on", "modified_on", mode="before")
    @classmethod
    def _parse_smartup_datetime(cls, value):  # noqa: N805
        if value is None or isinstance(value, datetime):
            return value
        if isinstance(value, date) and not isinstance(value, datetime):
            return datetime.combine(value, datetime.min.time())
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return None
            for fmt in ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y"):
                try:
                    parsed = datetime.strptime(raw, fmt)
                    return parsed
                except ValueError:
                    continue
        return value

    @root_validator(pre=True)
    def _normalize_lines(cls, values):  # noqa: N805
        for key in ("lines", "items", "goods", "positions"):
            if key in values and isinstance(values[key], list):
                values["lines"] = values[key]
                break
        return values

    @property
    def resolved_external_id(self) -> Optional[str]:
        return self.external_id or self.deal_id


class SmartupOrderExportResponse(BaseModel):
    items: List[SmartupOrder] = Field(default_factory=list, alias="order")
    total: Optional[int] = None

    class Config:
        extra = "allow"

    # TODO: Confirm Smartup response shape and extend schema once payload is stable.
