"""Dashboard summary API - real counts from database."""

import os
from datetime import date, datetime, timezone
from typing import List, Optional
from uuid import UUID

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session, selectinload

logger = logging.getLogger(__name__)

from app.auth.deps import require_any_permission, require_permission
from app.db import get_db
from app.models.document import Document as DocumentModel
from app.models.document import DocumentLine as DocumentLineModel
from app.models.order import Order as OrderModel
from app.models.order import OrderWmsState as OrderWmsStateModel
from app.models.user import User as UserModel

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
    updated_at: datetime


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


class PickingStaffStatsRow(BaseModel):
    user_id: UUID
    full_name: str
    documents_count: int
    lines_count: int
    total_picked_qty: float


class PickingStaffStatsResponse(BaseModel):
    pickers: List[PickingStaffStatsRow]
    controllers: List[PickingStaffStatsRow]


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

    # Bitta query: total_orders (imported — yangi navbat), completed_today, new_orders_today (imported + created today)
    order_counts = _order_base(
        db.query(
            func.count(case((OrderWmsStateModel.status == "imported", 1))).label("total_orders"),
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
                            OrderWmsStateModel.status == "imported",
                            func.date(OrderModel.created_at) == today,
                        ),
                        1,
                    )
                )
            ).label("new_orders_today"),
        )
        .select_from(OrderModel)
        .join(OrderWmsStateModel, OrderModel.id == OrderWmsStateModel.order_id)
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
    "W",
    "allocated",
    "picking",
    "cancelling_in_progress",
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

        # Admin Jarayon (GET /picking/documents?process_scope=active) bilan moslik:
        # allocated / picking / picked sonlari faqat shu ro'yxatga tushadigan hujjatlardan.
        # Aks holda buyurtma WMS kechiksa, hujjat allaqachon completed bo'lsa KPI > 0, jadval bo'sh bo'lardi.
        ORDER_HIDDEN_STATUSES = ("completed", "packed", "shipped", "cancelled")
        ACTIVE_PIPELINE_ORDER_STATUSES = ("allocated", "picking", "picked")
        ACTIVE_DOCUMENT_STATUSES = ("draft", "confirmed", "new", "partial", "in_progress", "picked")

        for _pipeline_status in ACTIVE_PIPELINE_ORDER_STATUSES:
            by_status[_pipeline_status] = 0

        jarayon_doc_filter = and_(
            or_(
                OrderModel.id.is_(None),
                OrderWmsStateModel.status.in_(ACTIVE_PIPELINE_ORDER_STATUSES),
                DocumentModel.status.in_(ACTIVE_DOCUMENT_STATUSES),
            ),
            DocumentModel.status.notin_(("completed", "packed", "shipped")),
            or_(
                OrderModel.id.is_(None),
                OrderWmsStateModel.status.is_(None),
                OrderWmsStateModel.status.notin_(ORDER_HIDDEN_STATUSES),
            ),
        )

        doc_rows = (
            db.query(OrderWmsStateModel.status, func.count(DocumentModel.id))
            .select_from(DocumentModel)
            .outerjoin(OrderModel, DocumentModel.order_id == OrderModel.id)
            .outerjoin(OrderWmsStateModel, OrderModel.id == OrderWmsStateModel.order_id)
            .filter(
                OrderWmsStateModel.status.in_(ACTIVE_PIPELINE_ORDER_STATUSES),
                jarayon_doc_filter,
                DocumentModel.status != "cancelled",
            )
            .group_by(OrderWmsStateModel.status)
            .all()
        )
        for status, cnt in doc_rows:
            if status in ACTIVE_PIPELINE_ORDER_STATUSES:
                by_status[status] = cnt

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
                updated_at=doc.updated_at,
            )
        )
    return PickDocumentsListResponse(items=items)


def _aggregate_staff_by_user_column(
    db: Session,
    user_id_column,
    date_from: Optional[date],
    date_to: Optional[date],
) -> List[PickingStaffStatsRow]:
    filters = [
        DocumentModel.doc_type == "SO",
        DocumentModel.status == "completed",
        user_id_column.isnot(None),
    ]
    if date_from is not None:
        filters.append(func.date(DocumentModel.updated_at) >= date_from)
    if date_to is not None:
        filters.append(func.date(DocumentModel.updated_at) <= date_to)

    per_doc = (
        db.query(
            user_id_column.label("uid"),
            DocumentModel.id.label("doc_id"),
            func.count(DocumentLineModel.id).label("lines_cnt"),
            func.coalesce(func.sum(DocumentLineModel.picked_qty), 0).label("picked_sum"),
        )
        .outerjoin(DocumentLineModel, DocumentLineModel.document_id == DocumentModel.id)
        .filter(and_(*filters))
        .group_by(user_id_column, DocumentModel.id)
    ).subquery()

    rows = (
        db.query(
            per_doc.c.uid,
            UserModel.full_name,
            UserModel.username,
            func.count().label("documents_count"),
            func.sum(per_doc.c.lines_cnt).label("lines_count"),
            func.sum(per_doc.c.picked_sum).label("total_picked_qty"),
        )
        .join(UserModel, UserModel.id == per_doc.c.uid)
        .group_by(per_doc.c.uid, UserModel.full_name, UserModel.username)
        .all()
    )
    out: List[PickingStaffStatsRow] = []
    for r in rows:
        name = (r.full_name or "").strip() or (r.username or "Unknown")
        tqty = float(r.total_picked_qty or 0)
        out.append(
            PickingStaffStatsRow(
                user_id=r.uid,
                full_name=name,
                documents_count=int(r.documents_count or 0),
                lines_count=int(r.lines_count or 0),
                total_picked_qty=tqty,
            )
        )
    out.sort(
        key=lambda x: (-x.total_picked_qty, -x.documents_count, -x.lines_count, x.full_name.lower()),
    )
    return out


@router.get(
    "/picking-staff-stats",
    response_model=PickingStaffStatsResponse,
    summary="Completed SO documents: picker vs controller stats (orders, lines, qty)",
)
async def get_picking_staff_stats(
    date_from: Optional[date] = Query(None, description="Filter documents.updated_at (UTC date) from"),
    date_to: Optional[date] = Query(None, description="Filter documents.updated_at (UTC date) to"),
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["reports:read", "audit:read", "admin:access"])),
):
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(status_code=400, detail="date_from must be on or before date_to")
    pickers = _aggregate_staff_by_user_column(
        db, DocumentModel.assigned_to_user_id, date_from, date_to
    )
    controllers = _aggregate_staff_by_user_column(
        db, DocumentModel.controlled_by_user_id, date_from, date_to
    )
    return PickingStaffStatsResponse(pickers=pickers, controllers=controllers)
