"""Ish haqi davri hisobi — xodim ilovasi va admin dashboard uchun YAGONA manba.

`/picking/my-period-stats` (xodim o'zi ko'radigan) va `/dashboard/staff-payroll`
(admin jadvali) aynan shu koddan foydalanadi — maosh kuni ikki xil raqam
chiqmasligi konstruktsiya darajasida kafolatlanadi.

Qoidalar (o'zgartirilMAgan, faqat shu yerga ko'chirilgan):
- Yig'uvchi `sent_to_controller_at` dan sanaladi (picked+), controller —
  faqat yakunlanganlardan (`completed_at`).
- Tarif davr BOSHIga qarab (`load_rates`) — to'langan oy qayta hisoblanmaydi.
- Guruh `payroll_source_group` — diller/o'rikzor (26.07.2026 dan) region.
- Ball pozitsiyaga: amount = pozitsiyalar x tarif[guruh].
- Yig'uvchida bekor qilingan terish ishi ham sanaladi (safe-cancel sessiyalari).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timezone
from decimal import Decimal
from typing import Iterable, Literal, Optional
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.business_time import BUSINESS_TZ, day_bounds_in_tz
from app.models.document import Document, DocumentLine
from app.models.order import Order
from app.models.safe_cancel_return import (
    SafeCancelReturnLine,
    SafeCancelReturnSession,
)
from app.services.order_source_group import (
    SOURCE_GROUP_CITY,
    SOURCE_GROUP_REGION,
    payroll_source_group,
)
from app.services.payroll_rates import load_rates

PayrollRole = Literal["picker", "controller"]

# Ish haqi davri kalendar oyi emas: 26-sanadan keyingi oyning 25-sanasigacha.
PAYROLL_PERIOD_START_DAY = 26


def payroll_period_bounds(today: date, offset: int = 0) -> tuple[date, date]:
    """`offset` 0 — joriy davr, -1 — oldingi va h.k."""
    year, month = today.year, today.month
    if today.day < PAYROLL_PERIOD_START_DAY:
        month -= 1
    month += offset
    while month <= 0:
        month += 12
        year -= 1
    while month > 12:
        month -= 12
        year += 1
    start = date(year, month, PAYROLL_PERIOD_START_DAY)
    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    end = date(next_year, next_month, PAYROLL_PERIOD_START_DAY - 1)
    return start, end

#: Har (kun, guruh) chelagi: orders/positions/qty.
GroupBucket = dict  # {"orders": int, "positions": int, "qty": float}
#: Bitta xodim: {kun: {"shahar": GroupBucket, "region": GroupBucket}}
UserBuckets = dict


def _empty_group() -> GroupBucket:
    return {"orders": 0, "positions": 0, "qty": 0.0}


def _new_user_buckets() -> UserBuckets:
    return defaultdict(
        lambda: {SOURCE_GROUP_CITY: _empty_group(), SOURCE_GROUP_REGION: _empty_group()}
    )


def collect_period_buckets(
    db: Session,
    period_from: date,
    period_to: date,
    *,
    role: PayrollRole,
    user_ids: Optional[Iterable[UUID]] = None,
) -> dict[UUID, UserBuckets]:
    """Davr ichida har xodim uchun kunma-kun (guruh kesimida) ish hajmi.

    `user_ids=None` — davrda ishlagan BARCHA xodimlar (admin jadvali);
    bitta id berilsa — xodim ilovasidagi hisob (xatti-harakat 1:1).
    """
    is_controller = role == "controller"
    window_start, _ = day_bounds_in_tz(period_from)
    _, window_end = day_bounds_in_tz(period_to)

    if is_controller:
        user_col = Document.controlled_by_user_id
        statuses = ("completed", "packed", "shipped")
        ts_col = func.coalesce(Document.completed_at, Document.updated_at)
    else:
        user_col = Document.assigned_to_user_id
        statuses = ("picked", "completed", "packed", "shipped")
        ts_col = func.coalesce(
            Document.sent_to_controller_at,
            Document.completed_at,
            Document.updated_at,
        )

    ids = list(user_ids) if user_ids is not None else None

    line_agg = (
        db.query(
            DocumentLine.document_id.label("doc_id"),
            func.count(DocumentLine.id).label("poz"),
            func.coalesce(func.sum(DocumentLine.picked_qty), 0).label("dona"),
        )
        .group_by(DocumentLine.document_id)
        .subquery()
    )
    query = (
        db.query(
            user_col.label("uid"),
            ts_col.label("ts"),
            func.coalesce(line_agg.c.poz, 0).label("poz"),
            func.coalesce(line_agg.c.dona, 0).label("dona"),
            Order.source.label("source"),
        )
        .outerjoin(line_agg, line_agg.c.doc_id == Document.id)
        .outerjoin(Order, Order.id == Document.order_id)
        .filter(
            Document.doc_type == "SO",
            Document.status.in_(statuses),
            ts_col >= window_start,
            ts_col <= window_end,
        )
    )
    query = query.filter(user_col.in_(ids)) if ids is not None else query.filter(user_col.isnot(None))
    rows = query.all()

    out: dict[UUID, UserBuckets] = defaultdict(_new_user_buckets)

    def _add(uid, ts, poz, dona, source) -> None:
        if uid is None or ts is None:
            return
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        group = payroll_source_group(source, period_from)
        bucket = out[uid][ts.astimezone(BUSINESS_TZ).date()][group]
        bucket["orders"] += 1
        bucket["positions"] += int(poz or 0)
        bucket["qty"] += float(dona or 0)

    for r in rows:
        _add(r.uid, r.ts, r.poz, r.dona, r.source)

    # Bekor qilingan terish ham yig'uvchining ishi (admin paneli ham shunday sanaydi).
    if not is_controller:
        cancel_lines = (
            db.query(
                SafeCancelReturnLine.session_id.label("sid"),
                func.count(SafeCancelReturnLine.id).label("poz"),
                func.coalesce(func.sum(SafeCancelReturnLine.qty_to_return), 0).label("dona"),
            )
            .group_by(SafeCancelReturnLine.session_id)
            .subquery()
        )
        cancel_ts = func.coalesce(
            db.query(func.max(DocumentLine.picked_at))
            .filter(DocumentLine.document_id == Document.id)
            .scalar_subquery(),
            SafeCancelReturnSession.created_at,
        )
        cancel_query = (
            db.query(
                Document.assigned_to_user_id.label("uid"),
                cancel_ts.label("ts"),
                func.coalesce(cancel_lines.c.poz, 0).label("poz"),
                func.coalesce(cancel_lines.c.dona, 0).label("dona"),
                Order.source.label("source"),
            )
            .join(Document, Document.id == SafeCancelReturnSession.document_id)
            .outerjoin(cancel_lines, cancel_lines.c.sid == SafeCancelReturnSession.id)
            .outerjoin(Order, Order.id == Document.order_id)
            .filter(
                cancel_ts >= window_start,
                cancel_ts <= window_end,
            )
        )
        cancel_query = (
            cancel_query.filter(Document.assigned_to_user_id.in_(ids))
            if ids is not None
            else cancel_query.filter(Document.assigned_to_user_id.isnot(None))
        )
        for r in cancel_query.all():
            _add(r.uid, r.ts, r.poz, r.dona, r.source)

    return dict(out)


def load_period_rates(db: Session, role: PayrollRole, period_from: date) -> dict[str, Decimal]:
    """Davr boshidagi tarif — to'langan oy keyingi tarifda qayta hisoblanmasin."""
    return load_rates(db, role, period_from)


def group_amount(positions: int, group: str, rates: dict[str, Decimal]) -> float:
    """Ball pozitsiyaga hisoblanadi — xodim ilovasi bilan bir xil formula."""
    return float(Decimal(positions) * rates[group])
