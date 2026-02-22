"""Dashboard summary API - real counts from database."""

import os
from datetime import date, datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import require_any_permission, require_permission
from app.db import get_db
from app.models.document import Document as DocumentModel
from app.models.order import Order as OrderModel

router = APIRouter()
DEFAULT_FILIAL_ID = os.getenv("WMS_DEFAULT_FILIAL_ID", "3788131").strip()


class PickDocumentListItem(BaseModel):
    id: UUID
    document_no: str
    status: str
    lines_picked: int
    lines_total: int
    picker_name: Optional[str] = None
    controller_name: Optional[str] = None


class PickDocumentsListResponse(BaseModel):
    items: List[PickDocumentListItem]


class DashboardSummaryResponse(BaseModel):
    total_orders: int
    completed_today: int
    in_picking: int
    active_pickers: int
    exceptions: int
    low_stock: int
    deltas: dict | None = None


class OrdersByStatusRow(BaseModel):
    status: str
    count: int


class OrdersByStatusResponse(BaseModel):
    items: List[OrdersByStatusRow]


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


@router.get("/summary", response_model=DashboardSummaryResponse, summary="Dashboard summary")
async def get_dashboard_summary(
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["reports:read", "audit:read", "admin:access"])),
):
    today = _today_utc()

    def _order_base(q):
        return q.filter(OrderModel.filial_id == DEFAULT_FILIAL_ID) if DEFAULT_FILIAL_ID else q

    # Total orders: B#S only (matches orders page default view)
    total_orders = (
        _order_base(db.query(func.count(OrderModel.id)))
        .filter(OrderModel.status == "B#S")
        .scalar()
        or 0
    )

    # Orders completed (shipped/packed) today
    completed_today = (
        _order_base(db.query(func.count(OrderModel.id)))
        .filter(
            OrderModel.status.in_(("packed", "shipped")),
            func.date(OrderModel.updated_at) == today,
        )
        .scalar()
        or 0
    )

    # Pick documents in progress (new, partial, in_progress) + picked (tekshirish kutilmoqda)
    in_picking = (
        db.query(func.count(DocumentModel.id))
        .filter(
            DocumentModel.doc_type == "SO",
            DocumentModel.status.in_(("new", "partial", "in_progress", "picked")),
        )
        .scalar()
        or 0
    )

    # Distinct pickers assigned to active pick documents (new, partial, in_progress, picked)
    active_pickers = (
        db.query(func.count(func.distinct(DocumentModel.assigned_to_user_id)))
        .filter(
            DocumentModel.doc_type == "SO",
            DocumentModel.status.in_(("new", "partial", "in_progress", "picked")),
            DocumentModel.assigned_to_user_id.isnot(None),
        )
        .scalar()
        or 0
    )

    # Placeholders - no exception/low_stock models yet
    exceptions = 0
    low_stock = 0

    # Deltas: new B#S orders today
    new_orders_today = (
        _order_base(db.query(func.count(OrderModel.id)))
        .filter(OrderModel.status == "B#S", func.date(OrderModel.created_at) == today)
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


ORDER_STATUSES_FOR_COUNTS = (
    "imported",
    "B#S",
    "allocated",
    "ready_for_picking",
    "picking",
    "picked",
    "packed",
    "shipped",
    "cancelled",
)


@router.get(
    "/orders-by-status",
    response_model=OrdersByStatusResponse,
    summary="Order counts by status (for dashboard table)",
)
async def get_orders_by_status(
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["reports:read", "audit:read", "admin:access"])),
):
    def _order_base(q):
        return q.filter(OrderModel.filial_id == DEFAULT_FILIAL_ID) if DEFAULT_FILIAL_ID else q

    rows = (
        _order_base(db.query(OrderModel.status, func.count(OrderModel.id)))
        .filter(OrderModel.status.in_(ORDER_STATUSES_FOR_COUNTS))
        .group_by(OrderModel.status)
        .all()
    )
    # Include zero counts for statuses that have no orders
    by_status = {r.status: r[1] for r in rows}
    items = [
        OrdersByStatusRow(status=s, count=by_status.get(s, 0))
        for s in ORDER_STATUSES_FOR_COUNTS
    ]
    return OrdersByStatusResponse(items=items)


@router.get(
    "/pick-documents",
    response_model=PickDocumentsListResponse,
    summary="List pick documents for admin (status, picker, controller)",
)
async def get_pick_documents(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status: Optional[str] = Query(None, description="Filter by status: new, partial, in_progress, picked, completed"),
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["reports:read", "audit:read", "admin:access"])),
):
    query = (
        db.query(DocumentModel)
        .options(
            selectinload(DocumentModel.lines),
            selectinload(DocumentModel.assigned_to_user),
            selectinload(DocumentModel.controlled_by_user),
        )
        .filter(DocumentModel.doc_type == "SO", DocumentModel.status != "cancelled")
    )
    if status:
        query = query.filter(DocumentModel.status == status)
    docs = query.order_by(DocumentModel.updated_at.desc()).offset(offset).limit(limit).all()
    items = []
    for doc in docs:
        lines_total = len(doc.lines)
        lines_picked = sum(1 for line in doc.lines if line.picked_qty >= line.required_qty)
        picker_name = None
        if doc.assigned_to_user:
            picker_name = doc.assigned_to_user.full_name or doc.assigned_to_user.username
        controller_name = None
        if doc.controlled_by_user:
            controller_name = doc.controlled_by_user.full_name or doc.controlled_by_user.username
        items.append(
            PickDocumentListItem(
                id=doc.id,
                document_no=doc.doc_no,
                status=doc.status,
                lines_picked=lines_picked,
                lines_total=lines_total,
                picker_name=picker_name,
                controller_name=controller_name,
            )
        )
    return PickDocumentsListResponse(items=items)
