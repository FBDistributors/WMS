"""O'rikzor harakatlari API — bazadan (Order, source=orikzor) limit/offset bilan, Mahsulotlar kabi tez."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import require_permission
from app.db import get_db
from app.models.order import Order as OrderModel

router = APIRouter()

ORIKZOR_SOURCE = "orikzor"


def _parse_date(value: str | None) -> date | None:
    if not value or not str(value).strip():
        return None
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _order_to_movement(order: OrderModel) -> dict[str, Any]:
    """Order (source=orikzor) ni frontend kutilgan movement formatiga aylantiradi."""
    lines = order.lines or []
    movement_items = [
        {
            "product_code": getattr(line, "sku", None),
            "quantity": getattr(line, "qty", 0),
            "name": getattr(line, "name", ""),
        }
        for line in lines
    ]
    delivery = order.delivery_date
    from_time = delivery.isoformat() if delivery else None
    return {
        "movement_id": order.order_number,
        "barcode": order.source_external_id,
        "from_warehouse_code": order.from_warehouse_code,
        "to_warehouse_code": order.to_warehouse_code,
        "note": order.movement_note,
        "amount": float(order.total_amount) if order.total_amount is not None else None,
        "status": order.status,
        "from_time": from_time,
        "from_movement_date": from_time,
        "movement_items": movement_items,
    }


@router.get("", summary="List O'rikzor movements from DB (fast, like Products)")
@router.get("/", summary="List O'rikzor movements from DB (fast, like Products)")
async def list_movements_orikzor(
    begin_created_on: str | None = Query(None, description="Start date (YYYY-MM-DD or DD.MM.YYYY)"),
    end_created_on: str | None = Query(None, description="End date (YYYY-MM-DD or DD.MM.YYYY)"),
    limit: int = Query(50, ge=1, le=500, description="Max items per page"),
    offset: int = Query(0, ge=0, description="Skip N items"),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:read")),
) -> dict[str, Any]:
    """
    O'rikzor harakatlari ro'yxati — bazadan (Order, source=orikzor).
    Mahsulotlar bo'limi kabi limit/offset bilan tez yuklanadi.
    Ma'lumot Smartup sync orqali Order jadvaliga yoziladi.
    """
    today = date.today()
    begin = _parse_date(begin_created_on)
    end = _parse_date(end_created_on)
    if begin is None and end is None:
        end = today
        begin = today - timedelta(days=30)
    elif begin is None:
        begin = end - timedelta(days=30) if end else today - timedelta(days=30)
    elif end is None:
        end = begin + timedelta(days=30) if begin else today
    if begin > end:
        raise HTTPException(status_code=400, detail="begin_created_on must be <= end_created_on")

    query = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.lines))
        .filter(OrderModel.source == ORIKZOR_SOURCE)
        .filter(func.date(OrderModel.created_at) >= begin)
        .filter(func.date(OrderModel.created_at) <= end)
    )

    total = query.with_entities(func.count(OrderModel.id)).order_by(None).scalar() or 0
    orders = (
        query.order_by(OrderModel.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    movement = [_order_to_movement(o) for o in orders]
    return {"movement": movement, "total": total}
