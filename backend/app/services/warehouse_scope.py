"""Ombor scope: asosiy ombor vs showroom — ajratish va terish filtrlari."""
from __future__ import annotations

from typing import Literal, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.api.v1.endpoints.picker_inventory import _location_ids_for_warehouse
from app.models.order import Order as OrderModel

WarehouseScope = Literal["main", "showroom"]


def warehouse_scope_for_order(order: Optional[OrderModel]) -> WarehouseScope:
    """Buyurtma qaysi ombordan ajratiladi/teriladi; default asosiy ombor."""
    if not order:
        return "main"
    for code in (order.from_warehouse_code, order.to_warehouse_code):
        if not code or not str(code).strip():
            continue
        u = str(code).strip().upper()
        if "SHOWROOM" in u or u in ("SR", "SHR", "SHOR"):
            return "showroom"
    return "main"


def location_ids_for_warehouse_scope(db: Session, warehouse: WarehouseScope) -> list[UUID]:
    """Asosiy yoki showroom lokatsiya id ro'yxati (bo'sh bo'lishi mumkin)."""
    return _location_ids_for_warehouse(db, warehouse) or []


def assert_location_allowed_for_pick(
    db: Session,
    location_id: UUID,
    *,
    order: Optional[OrderModel] = None,
) -> None:
    """Terish manbasi faqat buyurtma scope'idagi omborda bo'lishi kerak."""
    wh = warehouse_scope_for_order(order)
    allowed = set(location_ids_for_warehouse_scope(db, wh))
    if location_id not in allowed:
        if wh == "main":
            raise HTTPException(
                status_code=400,
                detail="Showroom location cannot be used for picking source",
            )
        raise HTTPException(
            status_code=400,
            detail="Main warehouse location cannot be used for this showroom order",
        )
