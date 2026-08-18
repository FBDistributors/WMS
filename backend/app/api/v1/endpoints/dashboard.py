"""Dashboard summary API - real counts from database."""

import os
import statistics
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import List, Optional
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session, selectinload

logger = logging.getLogger(__name__)

from app.auth.deps import require_any_permission, require_permission
from app.constants.document_status import (
    ACTIVE_DOCUMENT_STATUSES,
    ACTIVE_PIPELINE_ORDER_STATUSES,
    ORDER_HIDDEN_STATUSES,
)
from app.core.business_time import business_seconds, day_bounds_in_tz
from app.db import get_db
from app.models.document import Document as DocumentModel
from app.models.document import DocumentLine as DocumentLineModel
from app.models.order import Order as OrderModel
from app.models.order import OrderWmsState as OrderWmsStateModel
from app.models.stock import StockMovement as StockMovementModel
from app.models.safe_cancel_return import SafeCancelReturnLine as SafeCancelReturnLineModel
from app.models.safe_cancel_return import SafeCancelReturnSession as SafeCancelReturnSessionModel
from app.models.user import User as UserModel
from app.services.order_source_group import (
    payroll_source_group_conditions,
    source_group_conditions,
)

router = APIRouter()
DEFAULT_FILIAL_ID = os.getenv("WMS_DEFAULT_FILIAL_ID", "3788131").strip()
def _load_business_tz():
    key = os.getenv("WMS_BUSINESS_TIMEZONE", "Asia/Tashkent")
    try:
        return ZoneInfo(key)
    except ZoneInfoNotFoundError:
        # Windows dev without tzdata; O'zbekiston doimiy UTC+5
        if key in ("Asia/Tashkent", "Asia/Samarkand"):
            return timezone(timedelta(hours=5), name=key)
        raise


# Ombor kuni — UI (arxiv updated_at) bilan mos; UTC emas.
BUSINESS_TZ = _load_business_tz()
COMPLETED_DOC_STATUSES = ("completed", "packed", "shipped")


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


class DailyCompletedPoint(BaseModel):
    date: date
    count: int


class PickingOrderStatsResponse(BaseModel):
    date_from: date
    date_to: date
    completed_today: int
    completed_in_period: int
    days_in_period: int
    avg_completed_per_day: float
    daily: List[DailyCompletedPoint] = []


class StaffOrderItem(BaseModel):
    document_id: UUID
    order_id: Optional[UUID] = None
    document_no: str
    order_number: Optional[str] = None
    customer_name: Optional[str] = None
    status: str
    lines_count: int
    picked_qty: float
    activity_at: Optional[datetime] = None
    # Vaqt belgilari + hisoblangan davomiyliklar (soniya)
    first_assigned_at: Optional[datetime] = None
    sent_to_controller_at: Optional[datetime] = None
    controller_verification_started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    pick_seconds: Optional[float] = None
    control_total_seconds: Optional[float] = None
    control_check_seconds: Optional[float] = None


class StaffOrdersResponse(BaseModel):
    items: List[StaffOrderItem]


class StaffTimingPickerRow(BaseModel):
    user_id: UUID
    full_name: str
    orders_count: int
    total_units: float
    total_positions: int
    units_per_hour: float
    positions_per_hour: float
    median_seconds: float  # biznes-vaqt median yig'ish davomiyligi


class StaffTimingControllerRow(BaseModel):
    user_id: UUID
    full_name: str
    orders_count: int
    total_units: float
    total_positions: int
    units_per_hour: float  # sof tekshiruv vaqti bo'yicha
    positions_per_hour: float
    check_count: int
    median_total_seconds: float  # kelgandan yakunlaguncha (biznes-vaqt)
    median_check_seconds: float  # tekshirishni boshlagandan (biznes-vaqt)


class StaffTimingResponse(BaseModel):
    pickers: List[StaffTimingPickerRow]
    controllers: List[StaffTimingControllerRow]


class CancelledPickerRow(BaseModel):
    """Terilgan, keyin bekor qilingan ish — ish haqi uchun (unumdorlikka kirmaydi)."""

    user_id: UUID
    full_name: str
    documents_count: int
    positions: int
    qty: float
    # Shu yig'uvchiga tushgan, hali bajarilmagan qaytarish topshiriqlari (operativ).
    pending_returns: int


class CancelledStatsResponse(BaseModel):
    pickers: List[CancelledPickerRow]


def _duration_seconds(start: Optional[datetime], end: Optional[datetime]) -> Optional[float]:
    """end − start soniyada; ikkalasi bor va musbat bo'lsa, aks holda None."""
    if start is None or end is None:
        return None
    delta = (end - start).total_seconds()
    return delta if delta > 0 else None


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


def _today_business() -> date:
    return datetime.now(BUSINESS_TZ).date()


def _document_completed_at_expr():
    """Controller yakunlagan vaqt; eski yozuvlar uchun updated_at."""
    return func.coalesce(DocumentModel.completed_at, DocumentModel.updated_at)


def _picker_activity_at_expr():
    """Yig'uvchi controllerga yuborgan vaqt; eski yozuvlar uchun completed/updated_at."""
    return func.coalesce(
        DocumentModel.sent_to_controller_at,
        DocumentModel.completed_at,
        DocumentModel.updated_at,
    )


# Yig'uvchi uchun hujjat "bajarilgan" — controllerga yuborilganidan boshlab
# (status `picked`), controller yakunlashini kutmasdan.
PICKER_COUNTED_DOC_STATUSES = ("picked",) + COMPLETED_DOC_STATUSES


def _day_bounds_in_tz(day: date) -> tuple[datetime, datetime]:
    """Inclusive calendar day in BUSINESS_TZ as aware UTC datetimes for DB compare."""
    return day_bounds_in_tz(day)


def _completed_documents_filters(
    range_from: date,
    range_to: date,
) -> list:
    col = _document_completed_at_expr()
    start, _ = _day_bounds_in_tz(range_from)
    _, end = _day_bounds_in_tz(range_to)
    return [
        DocumentModel.doc_type == "SO",
        DocumentModel.status.in_(COMPLETED_DOC_STATUSES),
        col >= start,
        col <= end,
    ]


def _resolve_stats_period(
    date_from: Optional[date],
    date_to: Optional[date],
) -> tuple[date, date, int]:
    today = _today_business()
    effective_from = date_from if date_from is not None else today
    effective_to = date_to if date_to is not None else today
    if effective_from > effective_to:
        raise HTTPException(status_code=400, detail="date_from must be on or before date_to")
    days_in_period = (effective_to - effective_from).days + 1
    return effective_from, effective_to, max(days_in_period, 1)


def _count_completed_documents(
    db: Session,
    range_from: date,
    range_to: date,
) -> int:
    return int(
        db.query(func.count(DocumentModel.id))
        .filter(and_(*_completed_documents_filters(range_from, range_to)))
        .scalar()
        or 0
    )


def _recent_daily_completed(db: Session, days: int = 7) -> List["DailyCompletedPoint"]:
    """Oxirgi `days` ish kunidagi yakunlangan SO soni (bugun bilan tugaydi).

    Haftalik faollik grafigi uchun. Har kun uchun bitta arzon count so'rovi.
    """
    today = _today_business()
    points: List[DailyCompletedPoint] = []
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        points.append(DailyCompletedPoint(date=day, count=_count_completed_documents(db, day, day)))
    return points


def _first_completed_business_date(db: Session) -> Optional[date]:
    col = _document_completed_at_expr()
    first_dt = (
        db.query(func.min(col))
        .filter(
            DocumentModel.doc_type == "SO",
            DocumentModel.status.in_(COMPLETED_DOC_STATUSES),
        )
        .scalar()
    )
    if first_dt is None:
        return None
    if first_dt.tzinfo is None:
        first_dt = first_dt.replace(tzinfo=timezone.utc)
    return first_dt.astimezone(BUSINESS_TZ).date()


def _compute_all_time_avg(db: Session, today: date) -> tuple[int, float]:
    """Kunlar soni va kuniga o'rtacha (birinchi completion dan bugungacha)."""
    first_day = _first_completed_business_date(db)
    if first_day is None:
        return 1, 0.0
    days = max((today - first_day).days + 1, 1)
    total = _count_completed_documents(db, first_day, today)
    return days, round(total / days, 1)


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


def _staff_doc_filters(user_id_column, statuses: tuple, ts_col, date_from, date_to) -> list:
    """SO-hujjatlarni xodim/status/sana bo'yicha filtrlash (reyting va ro'yxat uchun bir xil)."""
    filters = [
        DocumentModel.doc_type == "SO",
        DocumentModel.status.in_(statuses),
        user_id_column.isnot(None),
    ]
    if date_from is not None:
        start, _ = _day_bounds_in_tz(date_from)
        filters.append(ts_col >= start)
    if date_to is not None:
        _, end = _day_bounds_in_tz(date_to)
        filters.append(ts_col <= end)
    return filters


def _staff_role_columns(role: str):
    """(user_id_column, statuses, ts_col) role bo'yicha — reyting bilan bir xil attributsiya."""
    if role == "picker":
        return (
            DocumentModel.assigned_to_user_id,
            PICKER_COUNTED_DOC_STATUSES,
            _picker_activity_at_expr(),
        )
    return (
        DocumentModel.controlled_by_user_id,
        COMPLETED_DOC_STATUSES,
        _document_completed_at_expr(),
    )


def _payroll_group_conditions(source_group: Optional[str], ts_col) -> list:
    """Reyting/ish haqi endpointlari uchun tarif-guruhlash.

    26.07.2026 dan o'rikzor region tarifida — xodim ilovasidagi hisob bilan bir
    xil bo'lishi shart, aks holda maosh paytida ikki xil raqam chiqadi. Shart
    hujjatning o'z ish vaqtiga (`ts_col`) bog'lanadi — eski hujjatlar eskicha.
    """
    return payroll_source_group_conditions(source_group, ts_col)


def _source_group_conditions(source_group: Optional[str]) -> list:
    """Buyurtma manbasi bo'yicha filtr: 'shahar' (smartup+orikzor) yoki 'region' (diller).

    Ta'rif `app.services.order_source_group` da — controller ro'yxati bilan bitta manba.
    """
    return source_group_conditions(source_group)


def _aggregate_staff_by_user_column(
    db: Session,
    user_id_column,
    date_from: Optional[date],
    date_to: Optional[date],
    statuses: tuple = COMPLETED_DOC_STATUSES,
    ts_col=None,
    source_group: Optional[str] = None,
) -> List[PickingStaffStatsRow]:
    col = ts_col if ts_col is not None else _document_completed_at_expr()
    filters = _staff_doc_filters(user_id_column, statuses, col, date_from, date_to)
    # Reyting jadvali maosh asosi — tarif-guruhlash (o'rikzor -> region, 26.07.2026 dan).
    filters.extend(_payroll_group_conditions(source_group, col))

    per_doc = (
        db.query(
            user_id_column.label("uid"),
            DocumentModel.id.label("doc_id"),
            func.count(DocumentLineModel.id).label("lines_cnt"),
            func.coalesce(func.sum(DocumentLineModel.picked_qty), 0).label("picked_sum"),
        )
        .outerjoin(OrderModel, DocumentModel.order_id == OrderModel.id)
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
    date_from: Optional[date] = Query(
        None, description="Filter completed_at (or updated_at) UTC date from"
    ),
    date_to: Optional[date] = Query(
        None, description="Filter completed_at (or updated_at) UTC date to"
    ),
    group: Optional[str] = Query(
        None,
        pattern="^(shahar|region)$",
        description="Manba guruhi: 'shahar' (smartup+orikzor) yoki 'region' (diller). Bo'sh — hammasi.",
    ),
    completed_only: bool = Query(
        False,
        description="True — yig'uvchi ham faqat to'liq yakunlangan (completed/packed/shipped) "
        "hujjatlarni sanaydi; 'picked' hisobga olinmaydi (KPI kartalari uchun).",
    ),
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["reports:read", "audit:read", "admin:access"])),
):
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(status_code=400, detail="date_from must be on or before date_to")
    # Yig'uvchi: odatda controllerga yuborilganidan boshlab (sent_to_controller_at)
    # sanaladi — controller yakunlashini kutmasdan. completed_only=True bo'lsa faqat
    # to'liq yakunlanganlar (completed_at bo'yicha). Controller: doim yakunlanganlar.
    picker_statuses = COMPLETED_DOC_STATUSES if completed_only else PICKER_COUNTED_DOC_STATUSES
    picker_ts = _document_completed_at_expr() if completed_only else _picker_activity_at_expr()
    pickers = _aggregate_staff_by_user_column(
        db,
        DocumentModel.assigned_to_user_id,
        date_from,
        date_to,
        statuses=picker_statuses,
        ts_col=picker_ts,
        source_group=group,
    )
    controllers = _aggregate_staff_by_user_column(
        db, DocumentModel.controlled_by_user_id, date_from, date_to, source_group=group
    )
    return PickingStaffStatsResponse(pickers=pickers, controllers=controllers)


def _staff_order_activity_at(role: str, doc: DocumentModel) -> Optional[datetime]:
    if role == "picker":
        return doc.sent_to_controller_at or doc.completed_at or doc.updated_at
    return doc.completed_at or doc.updated_at


@router.get(
    "/staff-orders",
    response_model=StaffOrdersResponse,
    summary="Bitta yig'uvchi/controller yiqqan (tekshirgan) hujjatlar ro'yxati (reyting bilan bir xil filtr)",
)
async def get_staff_orders(
    user_id: UUID = Query(..., description="Yig'uvchi yoki controller user_id"),
    role: str = Query(..., pattern="^(picker|controller)$"),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    group: Optional[str] = Query(
        None,
        pattern="^(shahar|region)$",
        description="Manba guruhi: 'shahar' (smartup+orikzor) yoki 'region' (diller). Bo'sh — hammasi.",
    ),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["reports:read", "audit:read", "admin:access"])),
):
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(status_code=400, detail="date_from must be on or before date_to")

    user_col, statuses, ts_col = _staff_role_columns(role)
    filters = _staff_doc_filters(user_col, statuses, ts_col, date_from, date_to)
    filters.append(user_col == user_id)
    # Reyting bilan bir xil filtr — tarif-guruhlash (o'rikzor -> region, 26.07.2026 dan).
    filters.extend(_payroll_group_conditions(group, ts_col))

    docs = (
        db.query(DocumentModel)
        .outerjoin(OrderModel, DocumentModel.order_id == OrderModel.id)
        .options(selectinload(DocumentModel.lines), selectinload(DocumentModel.order))
        .filter(and_(*filters))
        .order_by(ts_col.desc())
        .limit(limit)
        .all()
    )
    items: List[StaffOrderItem] = []
    for doc in docs:
        picked_qty = float(sum((line.picked_qty or 0) for line in doc.lines))
        order = getattr(doc, "order", None)
        # Mijoz nomi: SmartUp buyurtmalarida customer_name; diller/tashkiliy
        # harakatlarda customer_name bo'lmaydi — movement_note yoki agent_name'ga qaytamiz.
        customer_label = None
        if order is not None:
            customer_label = order.customer_name or order.movement_note or order.agent_name
        items.append(
            StaffOrderItem(
                document_id=doc.id,
                order_id=doc.order_id,
                document_no=doc.doc_no,
                order_number=order.order_number if order else None,
                customer_name=customer_label,
                status=doc.status,
                lines_count=len(doc.lines),
                picked_qty=picked_qty,
                activity_at=_staff_order_activity_at(role, doc),
                first_assigned_at=doc.first_assigned_at,
                sent_to_controller_at=doc.sent_to_controller_at,
                controller_verification_started_at=doc.controller_verification_started_at,
                completed_at=doc.completed_at,
                pick_seconds=business_seconds(doc.first_assigned_at, doc.sent_to_controller_at),
                control_total_seconds=business_seconds(doc.sent_to_controller_at, doc.completed_at),
                control_check_seconds=business_seconds(
                    doc.controller_verification_started_at, doc.completed_at
                ),
            )
        )
    return StaffOrdersResponse(items=items)


def _timing_name_map(db: Session, user_ids: set) -> dict:
    ids = [u for u in user_ids if u is not None]
    if not ids:
        return {}
    rows = db.query(UserModel.id, UserModel.full_name, UserModel.username).filter(UserModel.id.in_(ids)).all()
    return {r.id: ((r.full_name or "").strip() or (r.username or "Unknown")) for r in rows}


@router.get(
    "/staff-timing",
    response_model=StaffTimingResponse,
    summary="Yig'uvchi/controller ish vaqti: yig'ish va tekshirish davomiyligi (avg + median)",
)
async def get_staff_timing(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    group: Optional[str] = Query(None, pattern="^(shahar|region)$"),
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["reports:read", "audit:read", "admin:access"])),
):
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(status_code=400, detail="date_from must be on or before date_to")

    # Har hujjat uchun poz (qator soni) va dona (picked_qty yig'indisi).
    line_agg = (
        db.query(
            DocumentLineModel.document_id.label("doc_id"),
            func.count(DocumentLineModel.id).label("poz"),
            func.coalesce(func.sum(DocumentLineModel.picked_qty), 0).label("dona"),
        )
        .group_by(DocumentLineModel.document_id)
        .subquery()
    )

    def _per_hour(total: float, seconds: float) -> float:
        return round(total / (seconds / 3600.0), 1) if seconds > 0 else 0.0

    # --- Yig'uvchilar: first_assigned_at -> sent_to_controller_at (biznes-vaqt) ---
    p_col, p_statuses, p_ts = _staff_role_columns("picker")
    p_filters = _staff_doc_filters(p_col, p_statuses, p_ts, date_from, date_to)
    p_filters.extend(_source_group_conditions(group))
    p_rows = (
        db.query(
            DocumentModel.assigned_to_user_id.label("uid"),
            DocumentModel.first_assigned_at.label("a"),
            DocumentModel.sent_to_controller_at.label("b"),
            func.coalesce(line_agg.c.poz, 0).label("poz"),
            func.coalesce(line_agg.c.dona, 0).label("dona"),
        )
        .outerjoin(OrderModel, DocumentModel.order_id == OrderModel.id)
        .outerjoin(line_agg, line_agg.c.doc_id == DocumentModel.id)
        .filter(and_(*p_filters))
        .all()
    )
    pick_durs: dict = defaultdict(list)
    pick_units: dict = defaultdict(float)
    pick_poz: dict = defaultdict(int)
    pick_secs: dict = defaultdict(float)
    for r in p_rows:
        sec = business_seconds(r.a, r.b)
        if sec <= 0:
            continue
        pick_durs[r.uid].append(sec)
        pick_units[r.uid] += float(r.dona or 0)
        pick_poz[r.uid] += int(r.poz or 0)
        pick_secs[r.uid] += sec

    # --- Bekor qilingan buyurtmalardagi terish ---
    # Ish bajarilgan, shuning uchun unumdorlikka kiradi. Miqdor ham, vaqt ham
    # birga qo'shiladi — faqat biri qo'shilsa poz/soat yolg'on chiqadi.
    for r in _cancelled_picker_work_rows(db, date_from, date_to, group):
        sec = business_seconds(r["start"], r["end"])
        if sec <= 0:
            continue
        pick_durs[r["uid"]].append(sec)
        pick_units[r["uid"]] += r["dona"]
        pick_poz[r["uid"]] += r["poz"]
        pick_secs[r["uid"]] += sec

    # --- Controllerlar: jami (sent->completed) va sof tekshiruv (verify->completed) ---
    c_col, c_statuses, c_ts = _staff_role_columns("controller")
    c_filters = _staff_doc_filters(c_col, c_statuses, c_ts, date_from, date_to)
    c_filters.extend(_source_group_conditions(group))
    c_rows = (
        db.query(
            DocumentModel.controlled_by_user_id.label("uid"),
            DocumentModel.sent_to_controller_at.label("s"),
            DocumentModel.controller_verification_started_at.label("v"),
            DocumentModel.completed_at.label("c"),
            func.coalesce(line_agg.c.poz, 0).label("poz"),
            func.coalesce(line_agg.c.dona, 0).label("dona"),
        )
        .outerjoin(OrderModel, DocumentModel.order_id == OrderModel.id)
        .outerjoin(line_agg, line_agg.c.doc_id == DocumentModel.id)
        .filter(and_(*c_filters))
        .all()
    )
    ctrl_total: dict = defaultdict(list)
    ctrl_check: dict = defaultdict(list)
    ctrl_units: dict = defaultdict(float)
    ctrl_poz: dict = defaultdict(int)
    ctrl_check_secs: dict = defaultdict(float)
    for r in c_rows:
        tot = business_seconds(r.s, r.c)
        if tot > 0:
            ctrl_total[r.uid].append(tot)
        chk = business_seconds(r.v, r.c)
        if chk > 0:
            ctrl_check[r.uid].append(chk)
            ctrl_units[r.uid] += float(r.dona or 0)
            ctrl_poz[r.uid] += int(r.poz or 0)
            ctrl_check_secs[r.uid] += chk

    names = _timing_name_map(db, set(pick_durs) | set(ctrl_total) | set(ctrl_check))

    pickers = [
        StaffTimingPickerRow(
            user_id=uid,
            full_name=names.get(uid, "Unknown"),
            orders_count=len(durs),
            total_units=round(pick_units[uid], 1),
            total_positions=pick_poz[uid],
            units_per_hour=_per_hour(pick_units[uid], pick_secs[uid]),
            positions_per_hour=_per_hour(pick_poz[uid], pick_secs[uid]),
            median_seconds=round(statistics.median(durs), 1),
        )
        for uid, durs in pick_durs.items()
        if durs
    ]
    pickers.sort(key=lambda x: (-x.units_per_hour, x.full_name.lower()))

    controllers = []
    for uid in set(ctrl_total) | set(ctrl_check):
        totals = ctrl_total.get(uid, [])
        checks = ctrl_check.get(uid, [])
        if not totals and not checks:
            continue
        controllers.append(
            StaffTimingControllerRow(
                user_id=uid,
                full_name=names.get(uid, "Unknown"),
                orders_count=len(totals),
                total_units=round(ctrl_units[uid], 1),
                total_positions=ctrl_poz[uid],
                units_per_hour=_per_hour(ctrl_units[uid], ctrl_check_secs[uid]),
                positions_per_hour=_per_hour(ctrl_poz[uid], ctrl_check_secs[uid]),
                check_count=len(checks),
                median_total_seconds=round(statistics.median(totals), 1) if totals else 0.0,
                median_check_seconds=round(statistics.median(checks), 1) if checks else 0.0,
            )
        )
    controllers.sort(key=lambda x: (-x.units_per_hour, x.full_name.lower()))

    return StaffTimingResponse(pickers=pickers, controllers=controllers)


def _cancelled_picker_work_rows(
    db: Session,
    date_from: Optional[date],
    date_to: Optional[date],
    group: Optional[str] = None,
) -> List[dict]:
    """Bekor qilingan hujjatlardagi terish ishi: kim, qancha va qancha vaqtda.

    Miqdor qaytarish sessiyasidan olinadi — bekor qilinganda qator `picked_qty`
    nolga tushadi, sessiya esa o'sha paytdagi miqdorni saqlab qoladi.

    Ish tugagan payt: oxirgi skan (`picked_at`). Bekor qilingan vaqtni olib
    bo'lmaydi — admin yig'uvchi to'xtaganidan bir necha soat keyin bosishi
    mumkin, bu esa unumdorlikni asossiz tushirib yuboradi. Eski yozuvlarda
    `picked_at` bo'sh (migratsiyagacha bekor qilingan) — ular uchun `pick`
    harakatining vaqti, u ham bo'lmasa sessiya boshlangan payt.
    """
    line_totals = (
        db.query(
            SafeCancelReturnLineModel.session_id.label("sid"),
            func.count(SafeCancelReturnLineModel.id).label("poz"),
            func.coalesce(func.sum(SafeCancelReturnLineModel.qty_to_return), 0).label("dona"),
        )
        .group_by(SafeCancelReturnLineModel.session_id)
        .subquery()
    )
    last_scan = (
        db.query(
            DocumentLineModel.document_id.label("doc_id"),
            func.max(DocumentLineModel.picked_at).label("last_picked_at"),
        )
        .group_by(DocumentLineModel.document_id)
        .subquery()
    )
    last_movement = (
        db.query(
            StockMovementModel.source_document_id.label("doc_id"),
            func.max(StockMovementModel.created_at).label("last_pick_at"),
        )
        .filter(
            StockMovementModel.movement_type == "pick",
            StockMovementModel.source_document_type == "document",
        )
        .group_by(StockMovementModel.source_document_id)
        .subquery()
    )

    filters = [DocumentModel.assigned_to_user_id.isnot(None)]
    if date_from is not None:
        filters.append(SafeCancelReturnSessionModel.created_at >= _day_bounds_in_tz(date_from)[0])
    if date_to is not None:
        filters.append(SafeCancelReturnSessionModel.created_at <= _day_bounds_in_tz(date_to)[1])
    filters.extend(_source_group_conditions(group))

    rows = (
        db.query(
            DocumentModel.assigned_to_user_id.label("uid"),
            DocumentModel.first_assigned_at.label("start"),
            func.coalesce(
                last_scan.c.last_picked_at,
                last_movement.c.last_pick_at,
                SafeCancelReturnSessionModel.created_at,
            ).label("end"),
            func.coalesce(line_totals.c.poz, 0).label("poz"),
            func.coalesce(line_totals.c.dona, 0).label("dona"),
        )
        .join(DocumentModel, DocumentModel.id == SafeCancelReturnSessionModel.document_id)
        .outerjoin(OrderModel, DocumentModel.order_id == OrderModel.id)
        .outerjoin(line_totals, line_totals.c.sid == SafeCancelReturnSessionModel.id)
        .outerjoin(last_scan, last_scan.c.doc_id == DocumentModel.id)
        .outerjoin(last_movement, last_movement.c.doc_id == DocumentModel.id)
        .filter(and_(*filters))
        .all()
    )
    return [
        {
            "uid": r.uid,
            "start": r.start,
            "end": r.end,
            "poz": int(r.poz or 0),
            "dona": float(r.dona or 0),
        }
        for r in rows
    ]


@router.get(
    "/staff-cancelled-stats",
    response_model=CancelledStatsResponse,
    summary="Bekor qilingan buyurtmalardagi terish ishi (ish haqi uchun)",
)
async def get_staff_cancelled_stats(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["reports:read", "audit:read", "admin:access"])),
):
    """Bekor qilingan buyurtmada yig'uvchi bajargan ish.

    Bekor qilinganda `document_lines.picked_qty` nolga tushadi, shuning uchun
    asosiy statistika bu ishni ko'rmaydi. Ammo qaytarish sessiyasi o'sha paytdagi
    terilgan miqdorni saqlab qoladi (`qty_to_return`) — hisob shundan olinadi.

    Ish yig'uvchiga (`documents.assigned_to_user_id`) yoziladi: qaytarishni boshqa
    odam bajarishi mumkin, lekin tergani baribir shu kishi.
    """
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(status_code=400, detail="date_from must be on or before date_to")

    filters = [DocumentModel.assigned_to_user_id.isnot(None)]
    if date_from is not None:
        filters.append(SafeCancelReturnSessionModel.created_at >= _day_bounds_in_tz(date_from)[0])
    if date_to is not None:
        filters.append(SafeCancelReturnSessionModel.created_at <= _day_bounds_in_tz(date_to)[1])

    per_session = (
        db.query(
            DocumentModel.assigned_to_user_id.label("uid"),
            SafeCancelReturnSessionModel.id.label("sid"),
            func.count(SafeCancelReturnLineModel.id).label("poz"),
            func.coalesce(func.sum(SafeCancelReturnLineModel.qty_to_return), 0).label("dona"),
        )
        .join(DocumentModel, DocumentModel.id == SafeCancelReturnSessionModel.document_id)
        .outerjoin(
            SafeCancelReturnLineModel,
            SafeCancelReturnLineModel.session_id == SafeCancelReturnSessionModel.id,
        )
        .filter(and_(*filters))
        .group_by(DocumentModel.assigned_to_user_id, SafeCancelReturnSessionModel.id)
        .subquery()
    )

    rows = (
        db.query(
            per_session.c.uid,
            UserModel.full_name,
            UserModel.username,
            func.count().label("documents_count"),
            func.sum(per_session.c.poz).label("positions"),
            func.sum(per_session.c.dona).label("qty"),
        )
        .join(UserModel, UserModel.id == per_session.c.uid)
        .group_by(per_session.c.uid, UserModel.full_name, UserModel.username)
        .all()
    )

    # Bajarilmagan qaytarishlar — sana filtriga bog'liq emas: hozir kimda osilib
    # turgani muhim (qaytim endi ishni bloklamaydi, shuning uchun kuzatib turiladi).
    pending = dict(
        db.query(
            SafeCancelReturnSessionModel.picker_user_id,
            func.count(SafeCancelReturnSessionModel.id),
        )
        .filter(SafeCancelReturnSessionModel.status == "returns_pending")
        .group_by(SafeCancelReturnSessionModel.picker_user_id)
        .all()
    )

    out: List[CancelledPickerRow] = []
    for r in rows:
        name = (r.full_name or "").strip() or (r.username or "Unknown")
        out.append(
            CancelledPickerRow(
                user_id=r.uid,
                full_name=name,
                documents_count=int(r.documents_count or 0),
                positions=int(r.positions or 0),
                qty=float(r.qty or 0),
                pending_returns=int(pending.get(r.uid, 0)),
            )
        )
    # Hali qaytarilmagan sessiyasi bor, lekin oraliqda bekor qilingan ishi yo'q
    # yig'uvchilar ham ko'rinsin — aks holda osilib qolgan qaytim yashirinadi.
    seen = {row.user_id for row in out}
    for uid, cnt in pending.items():
        if uid in seen:
            continue
        user = db.query(UserModel).filter(UserModel.id == uid).one_or_none()
        if user is None:
            continue
        out.append(
            CancelledPickerRow(
                user_id=uid,
                full_name=(user.full_name or "").strip() or user.username or "Unknown",
                documents_count=0,
                positions=0,
                qty=0.0,
                pending_returns=int(cnt),
            )
        )

    out.sort(key=lambda x: (-x.positions, -x.pending_returns, x.full_name.lower()))
    return CancelledStatsResponse(pickers=out)


@router.get(
    "/picking-order-stats",
    response_model=PickingOrderStatsResponse,
    summary="Completed SO documents: today, period count, average per day",
)
async def get_picking_order_stats(
    date_from: Optional[date] = Query(None, description="Period start (UTC date); default today"),
    date_to: Optional[date] = Query(None, description="Period end (UTC date); default today"),
    avg_all_time: bool = Query(
        False,
        description="When true, avg_completed_per_day uses all time from first completion",
    ),
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["reports:read", "audit:read", "admin:access"])),
):
    effective_from, effective_to, period_days = _resolve_stats_period(date_from, date_to)
    today = _today_business()
    completed_today = _count_completed_documents(db, today, today)
    completed_in_period = _count_completed_documents(db, effective_from, effective_to)
    if avg_all_time:
        avg_days, avg = _compute_all_time_avg(db, today)
    else:
        avg_days = period_days
        avg = round(completed_in_period / period_days, 1)
    return PickingOrderStatsResponse(
        date_from=effective_from,
        date_to=effective_to,
        completed_today=completed_today,
        completed_in_period=completed_in_period,
        days_in_period=avg_days,
        avg_completed_per_day=avg,
        daily=_recent_daily_completed(db, days=7),
    )
