"""Dashboard summary API - real counts from database."""

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func

from app.auth.deps import require_permission
from app.db import get_db
from app.models.document import Document as DocumentModel
from app.models.order import Order as OrderModel
from sqlalchemy.orm import Session

router = APIRouter()


class DashboardSummaryResponse(BaseModel):
    total_orders: int
    completed_today: int
    in_picking: int
    active_pickers: int
    exceptions: int
    low_stock: int
    deltas: dict | None = None


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


@router.get("/summary", response_model=DashboardSummaryResponse, summary="Dashboard summary")
async def get_dashboard_summary(
    db: Session = Depends(get_db),
    _user=Depends(require_permission("admin:access")),
):
    today = _today_utc()

    # Total orders (same as orders list with status=all - all orders)
    total_orders = db.query(func.count(OrderModel.id)).scalar() or 0

    # Orders completed (shipped/packed) today
    completed_today = (
        db.query(func.count(OrderModel.id))
        .filter(
            OrderModel.status.in_(("packed", "shipped")),
            func.date(OrderModel.updated_at) == today,
        )
        .scalar()
        or 0
    )

    # Pick documents in progress (new, partial, in_progress)
    in_picking = (
        db.query(func.count(DocumentModel.id))
        .filter(
            DocumentModel.doc_type == "SO",
            DocumentModel.status.in_(("new", "partial", "in_progress")),
        )
        .scalar()
        or 0
    )

    # Distinct pickers assigned to active pick documents
    active_pickers = (
        db.query(func.count(func.distinct(DocumentModel.assigned_to_user_id)))
        .filter(
            DocumentModel.doc_type == "SO",
            DocumentModel.status.in_(("new", "partial", "in_progress")),
            DocumentModel.assigned_to_user_id.isnot(None),
        )
        .scalar()
        or 0
    )

    # Placeholders - no exception/low_stock models yet
    exceptions = 0
    low_stock = 0

    # Deltas: new orders today for total_orders
    new_orders_today = (
        db.query(func.count(OrderModel.id))
        .filter(func.date(OrderModel.created_at) == today)
        .scalar()
        or 0
    )
    deltas = {}
    if new_orders_today > 0:
        deltas["total_orders"] = f"+{new_orders_today}"

    return DashboardSummaryResponse(
        total_orders=total_orders,
        completed_today=completed_today,
        in_picking=in_picking,
        active_pickers=active_pickers,
        exceptions=exceptions,
        low_stock=low_stock,
        deltas=deltas if deltas else None,
    )
