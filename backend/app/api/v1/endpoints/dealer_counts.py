"""Diller ombor qoldig'i sanovi — WMS ledgeridan alohida hujjatlar.

Holatsiz: sanov (ro'yxat) web'da yaratiladi, bir yoki bir necha xodim telefonda uni ochib
diller omboridagi tovarni skanerlab sanaydi — har kiritilgan miqdor darhol yoziladi, qayta
skanda ustiga qo'shiladi (kiritishlar tarixda). Qulf, "yuborish" yo'q. Dillerning faol sanovi bitta (ichki `open`); yangisi yaratilsa eskisi `closed`.
Bu yerda hech qanday `stock_movements` yozilmaydi: diller ombori bizniki emas.
"""
from __future__ import annotations

import io
from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import get_effective_permissions, require_permission
from app.auth.permissions import PERM_DEALER_COUNTS_READ, PERM_DEALER_COUNTS_WRITE
from app.db import get_db
from app.models.dealer_stock_count import DealerStockCount, DealerStockCountEntry, DealerStockCountLine
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
    LOCATION_MAX,
    add_lines,
    apply_counts,
    entries_brief,
    patch_line,
    prefill_sheet,
    recount,
)

router = APIRouter()

#: Bosh ofis — diller emas, tanlov ro'yxatiga kirmaydi.
HEAD_OFFICE_ORG_ID = "3788131"

WEB_ONLY_DETAIL = "Sanov ro'yxati faqat web'da yaratiladi va tahrirlanadi"
ACTIVE_EXISTS_DETAIL = "Bu dillerda faol sanov bor — yangisi yaratilsa, eskisi telefonlardan yo'qoladi"
#: 1.0.47 gacha ilovalar ro'yxatni "olib" (claim), oxirida "yuborardi" — endi bunday qadam yo'q.
UPDATE_APP_DETAIL = "Ilovani yangilang: diller sanovi yangi tartibda ishlaydi"


# --- sxemalar -----------------------------------------------------------------


class DealerOut(BaseModel):
    org_id: str
    name: str


class DealerCountLineIn(BaseModel):
    product_id: Optional[UUID] = None
    scanned_barcode: str = Field(default="", max_length=64)
    #: None — sanalmagan qator (ro'yxat); 0 — "dillerda yo'q".
    qty: Optional[Decimal] = Field(default=None, ge=0)
    snapshot_qty: Optional[Decimal] = Field(default=None, ge=0)
    expiry_date: Optional[date] = None
    location_code: Optional[str] = Field(default=None, max_length=LOCATION_MAX)


class DealerCountCreate(BaseModel):
    client_uuid: UUID
    dealer_org_id: str = Field(..., min_length=1, max_length=64)
    note: Optional[str] = Field(default=None, max_length=2000)
    lines: list[DealerCountLineIn] = Field(default_factory=list)
    #: Dillerda faol sanov bo'lsa — eskisini yopib yangisini yaratish (web tasdig'idan keyin).
    replace: bool = False
    #: web (jadval) / sheet (tayyor ro'yxat) — hisobot uchun.
    source: str = Field(default="web", max_length=16)


class LinesIn(BaseModel):
    lines: list[DealerCountLineIn] = Field(default_factory=list)


class LinePatch(BaseModel):
    """Faqat yuborilgan maydonlar o'zgaradi; `qty: null` — "sanalmagan"ga qaytarish."""

    qty: Optional[Decimal] = Field(default=None, ge=0)
    expiry_date: Optional[date] = None
    location_code: Optional[str] = Field(default=None, max_length=LOCATION_MAX)


class DealerCountLineOut(BaseModel):
    id: UUID
    product_id: Optional[UUID]
    sku: Optional[str]
    product_name: Optional[str]
    scanned_barcode: str
    qty: Optional[Decimal]
    snapshot_qty: Optional[Decimal] = None
    expiry_date: Optional[date]
    location_code: Optional[str] = None
    counted_at: Optional[datetime] = None
    counted_by_name: Optional[str] = None
    #: Kiritishlar soni va oxirgi jamidan beri ko'rinishi ("12 + 5") — qayta skanda qo'shilgan.
    entries_count: int = 0
    entries_brief: Optional[str] = None
    seq: int


class DealerCountEntryOut(BaseModel):
    id: UUID
    kind: str
    qty: Optional[Decimal]
    user_name: Optional[str]
    counted_at: datetime


class DealerCountOut(BaseModel):
    id: UUID
    client_uuid: UUID
    dealer_org_id: str
    dealer_name: Optional[str]
    created_by_user_id: UUID
    created_by_name: Optional[str]
    #: Dillerning faol sanovi — telefonlarda ko'rinadi. Yangisi yaratilsa false.
    is_active: bool
    source: str = "web"
    created_at: datetime
    note: Optional[str]
    lines_count: int
    total_units: Decimal
    #: Ro'yxatdagi jami qatorlar va ulardan sanalganlari ("45/693").
    sheet_lines: int = 0
    counted_lines: int = 0
    last_counted_at: Optional[datetime] = None
    last_counted_by_name: Optional[str] = None
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
    #: Telefon beradi — bir kiritish ikki marta qo'llanmaydi (tarmoq uzilib qayta yuborilsa).
    op_id: Optional[UUID] = None
    #: set — jami; add — ustiga qo'shish (qayta skan); undo — `undo_op_id` qo'shishini bekor qilish.
    mode: Literal["set", "add", "undo"] = "set"
    undo_op_id: Optional[UUID] = None
    line_id: Optional[UUID] = None
    product_id: Optional[UUID] = None
    scanned_barcode: str = Field(default="", max_length=64)
    qty: Optional[Decimal] = Field(default=None, ge=0)
    expiry_date: Optional[date] = None
    location_code: Optional[str] = Field(default=None, max_length=LOCATION_MAX)
    #: Telefonda sanalgan payt — bir qatorni ikki xodim sanasa, keyingisi qoladi.
    counted_at: Optional[datetime] = None
    scanned_at: Optional[datetime] = None


class CountsIn(BaseModel):
    entries: list[CountEntryIn] = Field(default_factory=list)


class CountsOut(BaseModel):
    updated: int
    added: int
    #: Serverda shu qator keyinroq sanalgan — telefondagi eski qiymat yozilmadi.
    stale: int
    #: Allaqachon qabul qilingan kiritishlar (takror yuborish) va bekor qilingan qo'shishlar.
    duplicate: int = 0
    undone: int = 0
    count: DealerCountOut


class LinesOut(BaseModel):
    added: int
    updated: int
    count: DealerCountOut


class DealerCountListOut(BaseModel):
    items: list[DealerCountOut]
    total: int


# --- yordamchilar --------------------------------------------------------------


def _display_name(user: User | None) -> Optional[str]:
    if not user:
        return None
    return (user.full_name and user.full_name.strip()) or (user.username and user.username.strip()) or None


def _names(db: Session, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: _display_name(u) for u in db.query(User).filter(User.id.in_(ids)).all()}


def _to_out(db: Session, item: DealerStockCount, *, with_lines: bool) -> DealerCountOut:
    last = max((ln for ln in item.lines if ln.counted_at is not None), key=lambda ln: ln.counted_at, default=None)
    names = _names(
        db,
        {item.counted_by_user_id}
        | ({ln.counted_by_user_id for ln in item.lines} if with_lines else set())
        | ({last.counted_by_user_id} if last else set()),
    )
    lines_out: list[DealerCountLineOut] = []
    if with_lines:
        pids = {ln.product_id for ln in item.lines if ln.product_id}
        products = (
            {p.id: p for p in db.query(ProductModel).filter(ProductModel.id.in_(pids)).all()} if pids else {}
        )
        for ln in item.lines:
            p = products.get(ln.product_id)
            lines_out.append(
                DealerCountLineOut(
                    id=ln.id,
                    product_id=ln.product_id,
                    sku=p.sku if p else None,
                    product_name=p.name if p else None,
                    scanned_barcode=ln.scanned_barcode or "",
                    qty=ln.qty,
                    snapshot_qty=ln.snapshot_qty,
                    expiry_date=ln.expiry_date,
                    location_code=ln.location_code,
                    counted_at=ln.counted_at,
                    counted_by_name=names.get(ln.counted_by_user_id),
                    entries_count=len(ln.entries),
                    entries_brief=entries_brief(ln),
                    seq=ln.seq,
                )
            )
    return DealerCountOut(
        id=item.id,
        client_uuid=item.client_uuid,
        dealer_org_id=item.dealer_org_id,
        dealer_name=item.dealer_name,
        created_by_user_id=item.counted_by_user_id,
        created_by_name=names.get(item.counted_by_user_id),
        is_active=item.status == "open",
        source=item.source or "web",
        created_at=item.created_at,
        note=item.note,
        lines_count=item.lines_count,
        total_units=item.total_units,
        sheet_lines=len(item.lines),
        counted_lines=sum(1 for ln in item.lines if ln.counted_at is not None),
        last_counted_at=last.counted_at if last else None,
        last_counted_by_name=names.get(last.counted_by_user_id) if last else None,
        lines=lines_out,
    )


def _load(db: Session, count_id: UUID) -> DealerStockCount:
    item = (
        db.query(DealerStockCount)
        .options(selectinload(DealerStockCount.lines).selectinload(DealerStockCountLine.entries))
        .filter(DealerStockCount.id == count_id)
        .one_or_none()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Sanov topilmadi")
    return item


def _load_line(item: DealerStockCount, line_id: UUID) -> DealerStockCountLine:
    line = next((ln for ln in item.lines if ln.id == line_id), None)
    if line is None:
        raise HTTPException(status_code=404, detail="Qator topilmadi")
    return line


def _is_admin(user: User) -> bool:
    return "admin:access" in get_effective_permissions(user)


def _require_web_user(user: User) -> None:
    """Web (admin panel) foydalanuvchisi — `admin:access`. Telefondagi sanovchida u yo'q."""
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail=WEB_ONLY_DETAIL)


def _active_count(db: Session, dealer_org_id: str) -> Optional[DealerStockCount]:
    return (
        db.query(DealerStockCount)
        .filter(DealerStockCount.dealer_org_id == dealer_org_id, DealerStockCount.status == "open")
        .order_by(DealerStockCount.created_at.desc())
        .first()
    )


def _audit(db: Session, request: Request, user: User, item: DealerStockCount, action: str, data: dict) -> None:
    log_action(
        db,
        user_id=user.id,
        action=action,
        entity_type="dealer_stock_count",
        entity_id=str(item.id),
        new_data=data if action != ACTION_DELETE else None,
        old_data=data if action == ACTION_DELETE else None,
        ip_address=get_client_ip(request),
    )


def _save(db: Session, item: DealerStockCount) -> DealerCountOut:
    recount(item)
    db.commit()
    db.refresh(item)
    return _to_out(db, item, with_lines=True)


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


@router.post("", response_model=DealerCountOut, summary="Sanovni yaratish (web; client_uuid bo'yicha idempotent)")
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
    active = _active_count(db, org.org_id)
    if active is not None:
        if not payload.replace:
            raise HTTPException(status_code=409, detail=ACTIVE_EXISTS_DETAIL)
        # Dillerda bitta faol sanov: eskisi yopiladi (telefonlardan yo'qoladi, web'da qoladi).
        db.query(DealerStockCount).filter(
            DealerStockCount.dealer_org_id == org.org_id, DealerStockCount.status == "open"
        ).update({DealerStockCount.status: "closed"}, synchronize_session=False)

    item = DealerStockCount(
        client_uuid=payload.client_uuid,
        dealer_org_id=org.org_id,
        dealer_name=org.name,
        counted_by_user_id=user.id,
        status="open",
        note=(payload.note or "").strip() or None,
        source=payload.source if payload.source in ("web", "sheet") else "web",
    )
    db.add(item)
    add_lines(db, item, user, [ln.model_dump() for ln in payload.lines])
    recount(item)
    db.flush()
    _audit(
        db,
        request,
        user,
        item,
        ACTION_CREATE,
        {
            "dealer_org_id": item.dealer_org_id,
            "lines_count": item.lines_count,
            "closed_previous": str(active.id) if active else None,
        },
    )
    return _save(db, item)


@router.get("", response_model=DealerCountListOut, summary="Sanovlar ro'yxati")
@router.get("/", response_model=DealerCountListOut, include_in_schema=False)
def list_counts(
    dealer_org_id: Optional[str] = Query(default=None),
    active: Optional[bool] = Query(default=None, description="true — faol sanovlar (telefon ro'yxati)"),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission(PERM_DEALER_COUNTS_READ)),
) -> DealerCountListOut:
    query = db.query(DealerStockCount)
    if dealer_org_id:
        query = query.filter(DealerStockCount.dealer_org_id == dealer_org_id.strip())
    if active is not None:
        query = query.filter(DealerStockCount.status == ("open" if active else "closed"))
    if date_from:
        query = query.filter(func.date(DealerStockCount.created_at) >= date_from)
    if date_to:
        query = query.filter(func.date(DealerStockCount.created_at) <= date_to)
    total = query.count()
    rows = (
        query.options(selectinload(DealerStockCount.lines))
        .order_by(DealerStockCount.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return DealerCountListOut(items=[_to_out(db, r, with_lines=False) for r in rows], total=total)


@router.get("/{count_id}", response_model=DealerCountOut, summary="Sanov tafsiloti")
def get_count(
    count_id: UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission(PERM_DEALER_COUNTS_READ)),
) -> DealerCountOut:
    return _to_out(db, _load(db, count_id), with_lines=True)


# --- web: qator darajasidagi tahrir (telefon sanaganiga tegmaydi) ----------------


@router.post("/{count_id}/lines", response_model=LinesOut, summary="Qator(lar) qo'shish — web jadval / Excel")
def add_count_lines(
    count_id: UUID,
    payload: LinesIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> LinesOut:
    _require_web_user(user)
    item = _load(db, count_id)
    result = add_lines(db, item, user, [ln.model_dump() for ln in payload.lines])
    _audit(db, request, user, item, ACTION_UPDATE, {"lines": result})
    return LinesOut(**result, count=_save(db, item))


@router.patch("/{count_id}/lines/{line_id}", response_model=DealerCountOut, summary="Qatorni o'zgartirish — web")
def update_count_line(
    count_id: UUID,
    line_id: UUID,
    payload: LinePatch,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> DealerCountOut:
    _require_web_user(user)
    item = _load(db, count_id)
    line = _load_line(item, line_id)
    fields = payload.model_dump(include=payload.model_fields_set)
    patch_line(item, line, user, fields)
    _audit(db, request, user, item, ACTION_UPDATE, {"line": str(line_id), **{k: str(v) for k, v in fields.items()}})
    return _save(db, item)


@router.get(
    "/{count_id}/lines/{line_id}/entries",
    response_model=list[DealerCountEntryOut],
    summary="Qatorga kiritishlar tarixi (kim qancha sanadi / qo'shdi / tuzatdi)",
)
def list_line_entries(
    count_id: UUID,
    line_id: UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission(PERM_DEALER_COUNTS_READ)),
) -> list[DealerCountEntryOut]:
    line = _load_line(_load(db, count_id), line_id)
    names = _names(db, {en.user_id for en in line.entries})
    return [
        DealerCountEntryOut(id=en.id, kind=en.kind, qty=en.qty, user_name=names.get(en.user_id), counted_at=en.counted_at)
        for en in line.entries
    ]


@router.delete("/{count_id}/lines/{line_id}", response_model=DealerCountOut, summary="Qatorni o'chirish — web")
def delete_count_line(
    count_id: UUID,
    line_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> DealerCountOut:
    _require_web_user(user)
    item = _load(db, count_id)
    line = _load_line(item, line_id)
    item.lines.remove(line)
    _audit(db, request, user, item, ACTION_UPDATE, {"deleted_line": str(line_id)})
    return _save(db, item)


@router.post("/{count_id}/prefill", response_model=PrefillOut, summary="Ro'yxatni to'ldirish (smartup/shipped/all)")
def prefill_count(
    count_id: UUID,
    payload: PrefillIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> PrefillOut:
    _require_web_user(user)
    item = _load(db, count_id)
    result = prefill_sheet(db, item, sources=payload.sources, months=payload.months, refresh=payload.refresh)
    _audit(db, request, user, item, ACTION_UPDATE, {"prefill": result})
    return PrefillOut(**result, count=_save(db, item))


# --- telefon: sanalganlarni yozish ------------------------------------------------


@router.put("/{count_id}/counts", response_model=CountsOut, summary="Sanalgan qatorlarni yozish (telefon, idempotent)")
def put_counts(
    count_id: UUID,
    payload: CountsIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> CountsOut:
    item = _load(db, count_id)
    # Yopilgan sanovga ham yoziladi: oflayn telefon kech ulansa sanalgani yo'qolmasin.
    result = apply_counts(db, item, user, [e.model_dump() for e in payload.entries])
    _audit(db, request, user, item, ACTION_UPDATE, {"counts": result})
    return CountsOut(**result, count=_save(db, item))


@router.post("/{count_id}/claim", include_in_schema=False)
@router.post("/{count_id}/release", include_in_schema=False)
@router.post("/{count_id}/submit", include_in_schema=False)
def legacy_flow(count_id: UUID) -> None:
    raise HTTPException(status_code=410, detail=UPDATE_APP_DETAIL)


@router.delete(
    "/{count_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Sanovni o'chirish (yaratgan yoki admin)",
)
def delete_count(
    count_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(PERM_DEALER_COUNTS_WRITE)),
) -> Response:
    item = _load(db, count_id)
    if item.counted_by_user_id != user.id and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Bu sanov sizga tegishli emas")
    _audit(
        db,
        request,
        user,
        item,
        ACTION_DELETE,
        {
            "dealer_org_id": item.dealer_org_id,
            "active": item.status == "open",
            "lines": len(item.lines),
            "counted_lines": sum(1 for ln in item.lines if ln.counted_at is not None),
            "total_units": str(item.total_units),
        },
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

    out = _to_out(db, _load(db, count_id), with_lines=True)
    wb = Workbook()
    ws = wb.active
    ws.title = "Sanov"
    ws.append(["Diller", out.dealer_name or out.dealer_org_id])
    ws.append(["Diller ID", out.dealer_org_id])
    ws.append(["Yaratdi", out.created_by_name or ""])
    ws.append(["Yaratildi", out.created_at.strftime("%Y-%m-%d %H:%M")])
    ws.append(["Sanaldi", f"{out.counted_lines}/{out.sheet_lines}"])
    ws.append(["Izoh", out.note or ""])
    ws.append([])
    ws.append(["#", "SKU", "Mahsulot", "Shtrix-kod", "Joy", "Dona", "Muddat", "Kim sanadi", "Qachon", "Kiritishlar"])
    for ln in out.lines:
        ws.append(
            [
                ln.seq,
                ln.sku or "",
                ln.product_name or "(tanilmagan shtrix-kod)",
                ln.scanned_barcode,
                ln.location_code or "",
                # Sanalmagan qatorda miqdor yo'q.
                float(ln.qty) if ln.qty is not None else "",
                ln.expiry_date.strftime("%Y-%m") if ln.expiry_date else "",
                ln.counted_by_name or "",
                ln.counted_at.strftime("%Y-%m-%d %H:%M") if ln.counted_at else "",
                ln.entries_brief or "",
            ]
        )
    ws.append([])
    ws.append(["Jami sanalgan qatorlar", out.counted_lines, "", "", "Jami dona", float(out.total_units)])
    buf = io.BytesIO()
    wb.save(buf)
    fname = f"diller_sanov_{out.dealer_org_id}_{out.created_at.strftime('%Y%m%d')}.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
