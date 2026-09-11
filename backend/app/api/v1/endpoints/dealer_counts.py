"""Diller ombor qoldig'i sanovi — WMS ledgeridan alohida hujjatlar.

Xodim viloyatda diller omboridagi tovarni skanerlab sanaydi va ilova hujjatni
bir so'rovda yuboradi (`client_uuid` bilan idempotent). Bu yerda hech qanday
`stock_movements` yozilmaydi: diller ombori bizniki emas.
"""
from __future__ import annotations

import io
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
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
    qty: Decimal = Field(..., gt=0)
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


class DealerCountUpdate(BaseModel):
    note: Optional[str] = Field(default=None, max_length=2000)
    lines: list[DealerCountLineIn] = Field(default_factory=list)


class DealerCountLineOut(BaseModel):
    id: UUID
    product_id: Optional[UUID]
    sku: Optional[str]
    product_name: Optional[str]
    scanned_barcode: str
    qty: Decimal
    expiry_date: Optional[date]
    scanned_at: Optional[datetime]
    seq: int


class DealerCountOut(BaseModel):
    id: UUID
    client_uuid: UUID
    dealer_org_id: str
    dealer_name: Optional[str]
    counted_by_user_id: UUID
    counted_by_name: Optional[str]
    status: str
    started_at: datetime
    submitted_at: Optional[datetime]
    note: Optional[str]
    lines_count: int
    total_units: Decimal
    created_at: datetime
    #: Masalan "bu diller bugun allaqachon sanalgan" — rad etmaydi, ogohlantiradi.
    warning: Optional[str] = None
    lines: list[DealerCountLineOut] = Field(default_factory=list)


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
        expiry_date=line.expiry_date,
        scanned_at=line.scanned_at,
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
        started_at=item.started_at,
        submitted_at=item.submitted_at,
        note=item.note,
        lines_count=item.lines_count,
        total_units=item.total_units,
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
        if key in merged:
            merged[key].qty = Decimal(str(merged[key].qty)) + Decimal(str(raw.qty))
            continue
        seq += 1
        line = DealerStockCountLine(
            product_id=product_id,
            scanned_barcode=barcode,
            qty=Decimal(str(raw.qty)),
            expiry_date=expiry,
            scanned_at=raw.scanned_at,
            seq=seq,
        )
        merged[key] = line
        order.append(key)
    return [merged[k] for k in order]


def _recount(item: DealerStockCount) -> None:
    item.lines_count = len(item.lines)
    item.total_units = sum((Decimal(str(ln.qty)) for ln in item.lines), Decimal("0"))


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
    who = _display_name(db.get(User, other.counted_by_user_id)) or "—"
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


def _require_owner_or_admin(item: DealerStockCount, user: User) -> None:
    if item.counted_by_user_id == user.id:
        return
    if "admin:access" in get_effective_permissions(user):
        return
    raise HTTPException(status_code=403, detail="Bu sanov sizga tegishli emas")


def _require_draft(item: DealerStockCount) -> None:
    if item.status != "draft":
        raise HTTPException(status_code=409, detail="Sanov allaqachon yuborilgan — o'zgartirib bo'lmaydi")


def _submit(item: DealerStockCount) -> None:
    if not item.lines:
        raise HTTPException(status_code=400, detail="Bo'sh sanovni yuborib bo'lmaydi")
    _recount(item)
    item.status = "submitted"
    item.submitted_at = datetime.now(timezone.utc)


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

    item = DealerStockCount(
        client_uuid=payload.client_uuid,
        dealer_org_id=org.org_id,
        dealer_name=org.name,
        counted_by_user_id=user.id,
        status="draft",
        note=(payload.note or "").strip() or None,
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
        query = query.filter(DealerStockCount.status == status_filter.strip())
    if counted_by_user_id:
        query = query.filter(DealerStockCount.counted_by_user_id == counted_by_user_id)
    if mine:
        query = query.filter(DealerStockCount.counted_by_user_id == user.id)
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
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> DealerCountOut:
    item = _load(db, count_id)
    _require_owner_or_admin(item, user)
    _require_draft(item)
    _submit(item)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="dealer_stock_count",
        entity_id=str(item.id),
        new_data={"status": "submitted", "lines_count": item.lines_count, "total_units": str(item.total_units)},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(item)
    return _to_out(db, item, with_lines=True, warning=_same_day_warning(db, item))


@router.delete("/{count_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Draft sanovni o'chirish")
def delete_count(
    count_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> Response:
    item = _load(db, count_id)
    _require_owner_or_admin(item, user)
    _require_draft(item)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_DELETE,
        entity_type="dealer_stock_count",
        entity_id=str(item.id),
        old_data={"dealer_org_id": item.dealer_org_id, "lines_count": item.lines_count},
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
    ws.append(["Sanadi", out.counted_by_name or ""])
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
                float(ln.qty),
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
