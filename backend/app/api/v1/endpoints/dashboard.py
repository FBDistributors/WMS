"""Dashboard summary API - real counts from database."""

import os
from datetime import date, datetime, timezone
from typing import List, Optional
from uuid import UUID

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, case, func
from sqlalchemy.orm import Session, selectinload

logger = logging.getLogger(__name__)

from app.auth.deps import require_any_permission, require_permission
from app.db import get_db
from app.models.document import Document as DocumentModel
from app.models.order import Order as OrderModel
from app.models.order import OrderWmsState as OrderWmsStateModel

router = APIRouter()
DEFAULT_FILIAL_ID = os.getenv("WMS_DEFAULT_FILIAL_ID", "3788131").strip()


class PickDocumentListItem(BaseModel):
    id: UUID
    document_no: str
    order_number: Optional[str] = None
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

    # Bitta query: total_orders (B#S), completed_today (packed/shipped today), new_orders_today (B#S + created today)
    order_counts = _order_base(
        db.query(
            func.count(case((OrderWmsStateModel.status == "B#S", 1))).label("total_orders"),
            func.count(
                case(
                    (
                        and_(
                            OrderWmsStateModel.status.in_(("packed", "shipped")),
                            func.date(OrderWmsStateModel.updated_at) == today,
                        ),
                        1,
                    )
                )
            ).label("completed_today"),
            func.count(
                case(
                    (
                        and_(
                            OrderWmsStateModel.status == "B#S",
                            func.date(OrderModel.created_at) == today,
                        ),
                        1,
                    )
                )
            ).label("new_orders_today"),
        ).join(OrderWmsStateModel, OrderModel.id == OrderWmsStateModel.order_id)
    ).one()

    total_orders = order_counts.total_orders or 0
    completed_today = order_counts.completed_today or 0
    new_orders_today = order_counts.new_orders_today or 0

    # Bitta query: in_picking (barcha hujjatlar), active_pickers (distinct assignee; NULL hisoblanmaydi)
    doc_counts = (
        db.query(
            func.count(DocumentModel.id).label("in_picking"),
            func.count(func.distinct(DocumentModel.assigned_to_user_id)).label("active_pickers"),
        )
        .filter(
            DocumentModel.doc_type == "SO",
            DocumentModel.status.in_(("new", "partial", "in_progress", "picked")),
        )
    ).one()
    in_picking = doc_counts.in_picking or 0
    active_pickers = doc_counts.active_pickers or 0

    exceptions = 0
    low_stock = 0
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
    "completed",  # controller yakunlagach
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
    try:
        rows = (
            db.query(OrderWmsStateModel.status, func.count(OrderModel.id))
            .join(OrderWmsStateModel, OrderModel.id == OrderWmsStateModel.order_id)
            .filter(OrderWmsStateModel.status.in_(ORDER_STATUSES_FOR_COUNTS))
            .group_by(OrderWmsStateModel.status)
            .all()
        )
        by_status = {r[0]: r[1] for r in rows}
        items = [
            OrdersByStatusRow(status=s, count=by_status.get(s, 0))
            for s in ORDER_STATUSES_FOR_COUNTS
        ]
        return OrdersByStatusResponse(items=items)
    except Exception as e:
        logger.exception("get_orders_by_status error")
        raise HTTPException(status_code=500, detail="Internal error") from e


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
            selectinload(DocumentModel.order),
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
        order_number = None
        if getattr(doc, "order", None) and doc.order:
            order_number = doc.order.order_number
        items.append(
            PickDocumentListItem(
                id=doc.id,
                document_no=doc.doc_no,
                order_number=order_number,
                status=doc.status,
                lines_picked=lines_picked,
                lines_total=lines_total,
                picker_name=picker_name,
                controller_name=controller_name,
            )
        )
    return PickDocumentsListResponse(items=items)
