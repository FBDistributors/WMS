"""Diller ombor qoldig'i sanovi — WMS ledgeridan alohida hujjatlar.

Ro'yxat faqat web'da yaratiladi (bitta dillerga bitta ochiq ro'yxat); xodim
telefonda uni oladi, diller omboridagi tovarni skanerlab sanaydi va yuboradi.
Bu yerda hech qanday `stock_movements` yozilmaydi: diller ombori bizniki emas.
"""
from __future__ import annotations

import io
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import get_effective_permissions, require_permission
from app.auth.permissions import PERM_DEALER_COUNTS_READ, PERM_DEALER_COUNTS_WRITE
from app.db import get_db
from app.models.dealer_stock_count import DealerStockCount, DealerStockCountLine
from app.models.product import Product as ProductModel
from app.models.settings_organization import SettingsOrganization
from app.models.user import User
from app.services.audit_service import (
    ACTION_CREATE,
    ACTION_DELETE,
    ACTION_UPDATE,
    get_client_ip,
    log_action,
)
from app.services.dealer_count_compare import compare_dealer_count
from app.services.dealer_count_sheet import (
    LOCK_DETAIL,
    apply_counts,
    claim_sheet,
    finalize_uncounted,
    prefill_sheet,
    release_sheet,
)
from app.services.product_scan_resolve import resolve_product_scan

router = APIRouter()

#: Bosh ofis — diller emas, tanlov ro'yxatiga kirmaydi.
HEAD_OFFICE_ORG_ID = "3788131"


# --- sxemalar -----------------------------------------------------------------


class DealerOut(BaseModel):
    org_id: str
    name: str


class DealerCountLineIn(BaseModel):
    product_id: Optional[UUID] = None
    scanned_barcode: str = Field(default="", max_length=64)
    #: None — tayyor ro'yxatdagi hali sanalmagan qator; 0 — "dillerda yo'q".
    qty: Optional[Decimal] = Field(default=None, ge=0)
    #: Web draft qatorni qayta yuborganda snapshot yo'qolmasin.
    snapshot_qty: Optional[Decimal] = Field(default=None, ge=0)
    expiry_date: Optional[date] = None
    scanned_at: Optional[datetime] = None


class DealerCountCreate(BaseModel):
    client_uuid: UUID
    dealer_org_id: str = Field(..., min_length=1, max_length=64)
    note: Optional[str] = Field(default=None, max_length=2000)
    started_at: Optional[datetime] = None
    lines: list[DealerCountLineIn] = Field(default_factory=list)
    #: True — yaratish bilan birga yuborish (ilova "Yuborish" tugmasi).
    submit: bool = False
    #: mobile / web / sheet — hisobot uchun.
    source: str = Field(default="mobile", max_length=16)


class DealerCountUpdate(BaseModel):
    note: Optional[str] = Field(default=None, max_length=2000)
    lines: list[DealerCountLineIn] = Field(default_factory=list)


class DealerCountLineOut(BaseModel):
    id: UUID
    product_id: Optional[UUID]
    sku: Optional[str]
    product_name: Optional[str]
    scanned_barcode: str
    qty: Optional[Decimal]
    snapshot_qty: Optional[Decimal] = None
    expiry_date: Optional[date]
    scanned_at: Optional[datetime]
    counted_at: Optional[datetime] = None
    seq: int


class DealerCountOut(BaseModel):
    id: UUID
    client_uuid: UUID
    dealer_org_id: str
    dealer_name: Optional[str]
    counted_by_user_id: UUID
    counted_by_name: Optional[str]
    status: str
    source: str = "mobile"
    started_at: datetime
    submitted_at: Optional[datetime]
    note: Optional[str]
    lines_count: int
    total_units: Decimal
    #: Ro'yxatdagi jami qatorlar va ulardan sanalganlari ("45/693").
    sheet_lines: int = 0
    counted_lines: int = 0
    assigned_to_user_id: Optional[UUID] = None
    assigned_to_name: Optional[str] = None
    claimed_at: Optional[datetime] = None
    uncounted_policy: Optional[str] = None
    created_at: datetime
    #: Masalan "bu diller bugun allaqachon sanalgan" — rad etmaydi, ogohlantiradi.
    warning: Optional[str] = None
    lines: list[DealerCountLineOut] = Field(default_factory=list)


class PrefillIn(BaseModel):
    sources: list[str] = Field(default_factory=lambda: ["smartup"])
    months: int = Field(default=6, ge=1, le=24)
    refresh: bool = False


class PrefillOut(BaseModel):
    added: int
    skipped: int
    not_in_catalog: int
    sources: list[str]
    count: DealerCountOut


class CountEntryIn(BaseModel):
    line_id: Optional[UUID] = None
    product_id: Optional[UUID] = None
    scanned_barcode: str = Field(default="", max_length=64)
    qty: Decimal = Field(..., ge=0)
    expiry_date: Optional[date] = None
    scanned_at: Optional[datetime] = None


class CountsIn(BaseModel):
    entries: list[CountEntryIn] = Field(default_factory=list)


class CountsOut(BaseModel):
    updated: int
    added: int
    count: DealerCountOut


class DealerCountListOut(BaseModel):
    items: list[DealerCountOut]
    total: int


# --- yordamchilar --------------------------------------------------------------


def _display_name(user: User | None) -> Optional[str]:
    if not user:
        return None
    return (user.full_name and user.full_name.strip()) or (user.username and user.username.strip()) or None


def _to_line_out(line: DealerStockCountLine, product: ProductModel | None) -> DealerCountLineOut:
    return DealerCountLineOut(
        id=line.id,
        product_id=line.product_id,
        sku=product.sku if product else None,
        product_name=product.name if product else None,
        scanned_barcode=line.scanned_barcode or "",
        qty=line.qty,
        snapshot_qty=line.snapshot_qty,
        expiry_date=line.expiry_date,
        scanned_at=line.scanned_at,
        counted_at=line.counted_at,
        seq=line.seq,
    )


def _to_out(
    db: Session,
    item: DealerStockCount,
    *,
    with_lines: bool,
    warning: Optional[str] = None,
) -> DealerCountOut:
    counted_by = db.get(User, item.counted_by_user_id)
    assigned_to = db.get(User, item.assigned_to_user_id) if item.assigned_to_user_id else None
    lines_out: list[DealerCountLineOut] = []
    if with_lines:
        pids = {ln.product_id for ln in item.lines if ln.product_id}
        products = (
            {p.id: p for p in db.query(ProductModel).filter(ProductModel.id.in_(pids)).all()}
            if pids
            else {}
        )
        lines_out = [_to_line_out(ln, products.get(ln.product_id)) for ln in item.lines]
    return DealerCountOut(
        id=item.id,
        client_uuid=item.client_uuid,
        dealer_org_id=item.dealer_org_id,
        dealer_name=item.dealer_name,
        counted_by_user_id=item.counted_by_user_id,
        counted_by_name=_display_name(counted_by),
        status=item.status,
        source=item.source or "mobile",
        started_at=item.started_at,
        submitted_at=item.submitted_at,
        note=item.note,
        lines_count=item.lines_count,
        total_units=item.total_units,
        sheet_lines=len(item.lines),
        # Haqiqatan sanalganlar — "0 deb hisobla" bilan to'ldirilganlar bunga kirmaydi.
        counted_lines=sum(1 for ln in item.lines if ln.counted_at is not None),
        assigned_to_user_id=item.assigned_to_user_id,
        assigned_to_name=_display_name(assigned_to),
        claimed_at=item.claimed_at,
        uncounted_policy=item.uncounted_policy,
        created_at=item.created_at,
        warning=warning,
        lines=lines_out,
    )


def _month_start(d: Optional[date]) -> Optional[date]:
    return d.replace(day=1) if d else None


def _build_lines(db: Session, payload_lines: list[DealerCountLineIn]) -> list[DealerStockCountLine]:
    """Kiruvchi qatorlarni normallashtirish: skanni resolve qilish, bir xil
    mahsulot+muddatni yig'ish, tartibni saqlash."""
    merged: dict[tuple, DealerStockCountLine] = {}
    order: list[tuple] = []
    seq = 0
    now = datetime.now(timezone.utc)
    for raw in payload_lines:
        product_id = raw.product_id
        barcode = (raw.scanned_barcode or "").strip()
        if product_id is None and barcode:
            resolved = resolve_product_scan(db, barcode)
            if resolved:
                product_id = resolved.product_id
        elif product_id is not None and not db.get(ProductModel, product_id):
            raise HTTPException(status_code=400, detail=f"Mahsulot topilmadi: {product_id}")
        expiry = _month_start(raw.expiry_date)
        # Tanilmagan skan har doim alohida qator — unga qo'shib bo'lmaydi.
        key = (product_id, expiry) if product_id is not None else ("raw", barcode, seq)
        qty = Decimal(str(raw.qty)) if raw.qty is not None else None
        if key in merged:
            cur = merged[key]
            if qty is not None:
                cur.qty = (Decimal(str(cur.qty)) if cur.qty is not None else Decimal("0")) + qty
                cur.counted_at = cur.counted_at or now
            if raw.snapshot_qty is not None and cur.snapshot_qty is None:
                cur.snapshot_qty = Decimal(str(raw.snapshot_qty))
            continue
        seq += 1
        line = DealerStockCountLine(
            product_id=product_id,
            scanned_barcode=barcode,
            qty=qty,
            snapshot_qty=Decimal(str(raw.snapshot_qty)) if raw.snapshot_qty is not None else None,
            expiry_date=expiry,
            scanned_at=raw.scanned_at,
            # Miqdor bor — bu sanalgan qator; ro'yxat qatori (None) esa keyin telefonda sanaladi.
            counted_at=now if qty is not None else None,
            seq=seq,
        )
        merged[key] = line
        order.append(key)
    return [merged[k] for k in order]


def _recount(item: DealerStockCount) -> None:
    """Faqat sanalgan (qty bor) qatorlar hisobga olinadi; ro'yxatning sanalmaganlari emas."""
    counted = [ln for ln in item.lines if ln.qty is not None]
    item.lines_count = len(counted)
    item.total_units = sum((Decimal(str(ln.qty)) for ln in counted), Decimal("0"))


def _same_day_warning(db: Session, item: DealerStockCount) -> Optional[str]:
    """Shu diller bugun boshqa hujjatda allaqachon yuborilgan bo'lsa — ogohlantirish."""
    today = datetime.now(timezone.utc).date()
    other = (
        db.query(DealerStockCount)
        .filter(
            DealerStockCount.dealer_org_id == item.dealer_org_id,
            DealerStockCount.status == "submitted",
            DealerStockCount.id != item.id,
            func.date(DealerStockCount.submitted_at) == today,
        )
        .first()
    )
    if not other:
        return None
    who = _display_name(db.get(User, other.assigned_to_user_id or other.counted_by_user_id)) or "—"
    return f"Bu diller bugun allaqachon sanalgan ({who})"


def _load(db: Session, count_id: UUID) -> DealerStockCount:
    item = (
        db.query(DealerStockCount)
        .options(selectinload(DealerStockCount.lines))
        .filter(DealerStockCount.id == count_id)
        .one_or_none()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Sanov topilmadi")
    return item


#: Ro'yxat (sanov hujjati) faqat web'da yaratiladi va to'ldiriladi; telefon faqat sanaydi.
WEB_ONLY_DETAIL = "Sanov ro'yxati faqat web'da yaratiladi"


def _is_admin(user: User) -> bool:
    return "admin:access" in get_effective_permissions(user)


OPEN_EXISTS_DETAIL = "Bu diller uchun ochiq ro'yxat bor — o'shani oching yoki o'chiring"
OPEN_STATUSES = ("draft", "in_progress")


def _open_count(db: Session, dealer_org_id: str) -> Optional[DealerStockCount]:
    """Dillerning yuborilmagan (ochiq) ro'yxati, bo'lsa."""
    return (
        db.query(DealerStockCount)
        .filter(
            DealerStockCount.dealer_org_id == dealer_org_id,
            DealerStockCount.status.in_(OPEN_STATUSES),
        )
        .order_by(DealerStockCount.created_at.desc())
        .first()
    )


def _require_web_user(user: User) -> None:
    """Web (admin panel) foydalanuvchisi — `admin:access`. Telefondagi sanovchida u yo'q."""
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail=WEB_ONLY_DETAIL)


def _require_owner_or_admin(item: DealerStockCount, user: User) -> None:
    if item.counted_by_user_id == user.id:
        return
    if _is_admin(user):
        return
    raise HTTPException(status_code=403, detail="Bu sanov sizga tegishli emas")


def _require_draft(item: DealerStockCount) -> None:
    if item.status == "in_progress":
        raise HTTPException(status_code=409, detail=LOCK_DETAIL)
    if item.status != "draft":
        raise HTTPException(status_code=409, detail="Sanov allaqachon yuborilgan — o'zgartirib bo'lmaydi")


def _require_counter_or_admin(item: DealerStockCount, user: User) -> None:
    """Telefonda ro'yxatni olgan xodim (yoki admin) sanalganlarni yozadi / yuboradi."""
    if item.status == "in_progress" and item.assigned_to_user_id not in (None, user.id):
        if "admin:access" not in get_effective_permissions(user):
            raise HTTPException(status_code=403, detail="Ro'yxatni boshqa xodim olgan")


def _submit(item: DealerStockCount, *, uncounted: str = "zero") -> int:
    """Yuborish. Sanalmagan qatorlar: zero → 0 (counted_at bo'sh), keep → NULL. Qaytaradi: ularning soni."""
    if item.status == "submitted":
        raise HTTPException(status_code=409, detail="Sanov allaqachon yuborilgan")
    if not item.lines:
        raise HTTPException(status_code=400, detail="Bo'sh sanovni yuborib bo'lmaydi")
    uncounted_n = finalize_uncounted(item, uncounted)
    if not any(ln.qty is not None for ln in item.lines):
        raise HTTPException(status_code=400, detail="Sanovda birorta sanalgan qator yo'q")
    _recount(item)
    item.status = "submitted"
    item.submitted_at = datetime.now(timezone.utc)
    return uncounted_n


# --- endpointlar ---------------------------------------------------------------


@router.get("/dealers", response_model=list[DealerOut], summary="Diller ro'yxati (settings_organizations)")
def list_dealers(
    q: Optional[str] = Query(default=None, max_length=100),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> list[DealerOut]:
    query = db.query(SettingsOrganization).filter(SettingsOrganization.org_id != HEAD_OFFICE_ORG_ID)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(SettingsOrganization.name.ilike(like), SettingsOrganization.org_id.ilike(like))
        )
    rows = query.order_by(SettingsOrganization.name.asc().nullslast()).all()
    return [DealerOut(org_id=r.org_id, name=r.name or r.org_id) for r in rows]


@router.post("", response_model=DealerCountOut, summary="Sanovni yaratish (client_uuid bo'yicha idempotent)")
@router.post("/", response_model=DealerCountOut, include_in_schema=False)
def create_count(
    payload: DealerCountCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> DealerCountOut:
    _require_web_user(user)
    existing = (
        db.query(DealerStockCount)
        .options(selectinload(DealerStockCount.lines))
        .filter(DealerStockCount.client_uuid == payload.client_uuid)
        .one_or_none()
    )
    if existing:
        # Takror yuborish (tarmoq uzilib qayta urinish) — o'sha hujjat qaytadi.
        return _to_out(db, existing, with_lines=True)

    org = (
        db.query(SettingsOrganization)
        .filter(SettingsOrganization.org_id == payload.dealer_org_id.strip())
        .one_or_none()
    )
    if not org or org.org_id == HEAD_OFFICE_ORG_ID:
        raise HTTPException(status_code=400, detail="Diller topilmadi")
    # Bitta diller — bitta ochiq ro'yxat: telefonda xodim bitta ro'yxatni ko'radi va sanaydi.
    if not payload.submit and _open_count(db, org.org_id) is not None:
        raise HTTPException(status_code=409, detail=OPEN_EXISTS_DETAIL)

    item = DealerStockCount(
        client_uuid=payload.client_uuid,
        dealer_org_id=org.org_id,
        dealer_name=org.name,
        counted_by_user_id=user.id,
        status="draft",
        note=(payload.note or "").strip() or None,
        source=payload.source if payload.source in ("mobile", "web", "sheet") else "mobile",
    )
    if payload.started_at:
        item.started_at = payload.started_at
    item.lines = _build_lines(db, payload.lines)
    _recount(item)
    if payload.submit:
        _submit(item)
    db.add(item)
    db.flush()
    log_action(
        db,
        user_id=user.id,
        action=ACTION_CREATE,
        entity_type="dealer_stock_count",
        entity_id=str(item.id),
        new_data={
            "dealer_org_id": item.dealer_org_id,
            "status": item.status,
            "lines_count": item.lines_count,
            "total_units": str(item.total_units),
            "source": item.source,
        },
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(item)
    warning = _same_day_warning(db, item) if item.status == "submitted" else None
    return _to_out(db, item, with_lines=True, warning=warning)


@router.get("", response_model=DealerCountListOut, summary="Sanovlar ro'yxati")
@router.get("/", response_model=DealerCountListOut, include_in_schema=False)
def list_counts(
    dealer_org_id: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    counted_by_user_id: Optional[UUID] = Query(default=None),
    mine: bool = Query(default=False, description="Faqat mening sanovlarim"),
    available: bool = Query(
        default=False,
        description="Telefon uchun: ochiq (draft) + men olgan (in_progress); boshqalar olgani emas",
    ),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_READ)),
) -> DealerCountListOut:
    query = db.query(DealerStockCount)
    if dealer_org_id:
        query = query.filter(DealerStockCount.dealer_org_id == dealer_org_id.strip())
    if status_filter:
        # Bitta yoki vergul bilan bir nechta: `draft,in_progress` (telefon uchun tayyor ro'yxatlar).
        statuses = [s.strip() for s in status_filter.split(",") if s.strip()]
        query = query.filter(DealerStockCount.status.in_(statuses))
    if counted_by_user_id:
        query = query.filter(DealerStockCount.counted_by_user_id == counted_by_user_id)
    if mine:
        # Ro'yxatni web yaratadi (counted_by), telefonda sanagan xodim — assigned_to.
        query = query.filter(
            or_(
                DealerStockCount.counted_by_user_id == user.id,
                DealerStockCount.assigned_to_user_id == user.id,
            )
        )
    if available:
        query = query.filter(
            or_(
                DealerStockCount.status == "draft",
                and_(
                    DealerStockCount.status == "in_progress",
                    DealerStockCount.assigned_to_user_id == user.id,
                ),
            )
        )
    if date_from:
        query = query.filter(func.date(DealerStockCount.created_at) >= date_from)
    if date_to:
        query = query.filter(func.date(DealerStockCount.created_at) <= date_to)
    total = query.count()
    rows = query.order_by(DealerStockCount.created_at.desc()).offset(offset).limit(limit).all()
    return DealerCountListOut(items=[_to_out(db, r, with_lines=False) for r in rows], total=total)


@router.get("/{count_id}", response_model=DealerCountOut, summary="Sanov tafsiloti")
def get_count(
    count_id: UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission(PERM_DEALER_COUNTS_READ)),
) -> DealerCountOut:
    return _to_out(db, _load(db, count_id), with_lines=True)


@router.put("/{count_id}", response_model=DealerCountOut, summary="Draft sanovni to'liq yangilash")
def update_count(
    count_id: UUID,
    payload: DealerCountUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> DealerCountOut:
    item = _load(db, count_id)
    _require_owner_or_admin(item, user)
    _require_draft(item)
    item.note = (payload.note or "").strip() or None
    item.lines = _build_lines(db, payload.lines)
    _recount(item)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="dealer_stock_count",
        entity_id=str(item.id),
        new_data={"lines_count": item.lines_count, "total_units": str(item.total_units)},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(item)
    return _to_out(db, item, with_lines=True)


@router.post("/{count_id}/submit", response_model=DealerCountOut, summary="Sanovni yuborish")
def submit_count(
    count_id: UUID,
    request: Request,
    uncounted: str = Query(default="zero", description="Sanalmagan qatorlar: zero (0 deb) | keep (NULL)"),
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> DealerCountOut:
    item = _load(db, count_id)
    if item.status == "draft":
        _require_owner_or_admin(item, user)
    else:
        # in_progress — olgan xodim; submitted — `_submit` 409 qaytaradi (403 emas:
        # ro'yxatni web yaratgan, telefondagi sanovchi uning egasi emas).
        _require_counter_or_admin(item, user)
    uncounted_n = _submit(item, uncounted=uncounted)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="dealer_stock_count",
        entity_id=str(item.id),
        new_data={
            "status": "submitted",
            "lines_count": item.lines_count,
            "total_units": str(item.total_units),
            "uncounted": uncounted,
            "uncounted_lines": uncounted_n,
        },
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(item)
    return _to_out(db, item, with_lines=True, warning=_same_day_warning(db, item))


# --- tayyor ro'yxat (ведомость) --------------------------------------------------


@router.post("/{count_id}/prefill", response_model=PrefillOut, summary="Ro'yxatni to'ldirish (smartup/shipped/all)")
def prefill_count(
    count_id: UUID,
    payload: PrefillIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> PrefillOut:
    item = _load(db, count_id)
    _require_web_user(user)
    result = prefill_sheet(db, item, sources=payload.sources, months=payload.months, refresh=payload.refresh)
    _recount(item)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="dealer_stock_count",
        entity_id=str(item.id),
        new_data={"prefill": result},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(item)
    return PrefillOut(**result, count=_to_out(db, item, with_lines=True))


@router.post("/{count_id}/claim", response_model=DealerCountOut, summary="Telefon ro'yxatni oladi (in_progress, web qulf)")
def claim_count(
    count_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> DealerCountOut:
    item = _load(db, count_id)
    claim_sheet(item, user)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="dealer_stock_count",
        entity_id=str(item.id),
        new_data={"status": "in_progress", "assigned_to_user_id": str(user.id)},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(item)
    return _to_out(db, item, with_lines=True)


@router.post("/{count_id}/release", response_model=DealerCountOut, summary="Qulfni ochish (olgan xodim yoki admin)")
def release_count(
    count_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> DealerCountOut:
    item = _load(db, count_id)
    _require_counter_or_admin(item, user)
    release_sheet(item)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="dealer_stock_count",
        entity_id=str(item.id),
        new_data={"status": "draft", "released": True},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(item)
    return _to_out(db, item, with_lines=True)


@router.put("/{count_id}/counts", response_model=CountsOut, summary="Sanalgan qatorlarni yozish (telefon, idempotent)")
def put_counts(
    count_id: UUID,
    payload: CountsIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> CountsOut:
    item = _load(db, count_id)
    _require_counter_or_admin(item, user)
    result = apply_counts(db, item, user, [e.model_dump() for e in payload.entries])
    _recount(item)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="dealer_stock_count",
        entity_id=str(item.id),
        new_data={"counts": result},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(item)
    return CountsOut(**result, count=_to_out(db, item, with_lines=True))


@router.delete(
    "/{count_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Sanovni o'chirish (draft — egasi yoki admin; telefonda / yuborilgan — faqat admin)",
)
def delete_count(
    count_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> Response:
    item = _load(db, count_id)
    if item.status == "submitted":
        # Keraksiz/xato yuborilgan hujjatni tozalash; ledgerga ta'siri yo'q, audit qoladi.
        if not _is_admin(user):
            raise HTTPException(status_code=403, detail="Yuborilgan sanovni faqat admin o'chira oladi")
    elif item.status == "in_progress":
        # Telefon olgan ro'yxat — xodimning telefondagi sanalganlari ham yo'qoladi, shuning
        # uchun faqat admin. Telefon keyingi so'rovda 404 oladi va nusxasini o'chiradi.
        if not _is_admin(user):
            raise HTTPException(status_code=409, detail=LOCK_DETAIL)
    else:
        _require_owner_or_admin(item, user)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_DELETE,
        entity_type="dealer_stock_count",
        entity_id=str(item.id),
        old_data={
            "dealer_org_id": item.dealer_org_id,
            "status": item.status,
            "assigned_to_user_id": str(item.assigned_to_user_id) if item.assigned_to_user_id else None,
            "lines_count": item.lines_count,
            "total_units": str(item.total_units),
        },
        ip_address=get_client_ip(request),
    )
    db.delete(item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{count_id}/compare",
    summary="Sanovni Smartup qoldig'i bilan solishtirish (filial + ombor kodi, kunlik kesh)",
)
def compare_count(
    count_id: UUID,
    refresh: bool = Query(default=False, description="Smartup'dan qayta so'rash"),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission(PERM_DEALER_COUNTS_READ)),
) -> dict:
    return compare_dealer_count(db, _load(db, count_id), refresh=refresh)


@router.get("/{count_id}/export.xlsx", summary="Sanovni Excel'ga eksport")
def export_count_xlsx(
    count_id: UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission(PERM_DEALER_COUNTS_READ)),
) -> Response:
    from openpyxl import Workbook

    item = _load(db, count_id)
    out = _to_out(db, item, with_lines=True)
    wb = Workbook()
    ws = wb.active
    ws.title = "Sanov"
    ws.append(["Diller", out.dealer_name or out.dealer_org_id])
    ws.append(["Diller ID", out.dealer_org_id])
    # Ro'yxatni web'da biri yaratadi, telefonda boshqasi sanaydi.
    ws.append(["Sanadi", out.assigned_to_name or out.counted_by_name or ""])
    ws.append(["Yaratdi", out.counted_by_name or ""])
    ws.append(["Holat", out.status])
    ws.append(["Boshlandi", out.started_at.strftime("%Y-%m-%d %H:%M")])
    ws.append(["Yuborildi", out.submitted_at.strftime("%Y-%m-%d %H:%M") if out.submitted_at else ""])
    ws.append(["Izoh", out.note or ""])
    ws.append([])
    ws.append(["#", "SKU", "Mahsulot", "Shtrix-kod", "Dona", "Muddat"])
    for ln in out.lines:
        ws.append(
            [
                ln.seq,
                ln.sku or "",
                ln.product_name or "(tanilmagan shtrix-kod)",
                ln.scanned_barcode,
                # "Sanalmagan qoldirsin" bilan yuborilgan qatorda qty yo'q.
                float(ln.qty) if ln.qty is not None else "",
                ln.expiry_date.strftime("%Y-%m") if ln.expiry_date else "",
            ]
        )
    ws.append([])
    ws.append(["Jami qatorlar", out.lines_count, "", "Jami dona", float(out.total_units), ""])
    buf = io.BytesIO()
    wb.save(buf)
    fname = f"diller_sanov_{out.dealer_org_id}_{out.started_at.strftime('%Y%m%d')}.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
