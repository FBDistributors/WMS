"""Admin: SmartUp mijoz qaytarishlari (sinxronlangan) ro'yxati va sinxron tugmasi."""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import get_current_user, require_any_permission, require_permission
from app.core.expiry import normalize_expiry_to_first_of_month
from app.db import get_db
from app.integrations.smartup.returns_export import sync_returns
from app.models.customer_return import (
    CUSTOMER_RETURN_STATUS_ASSIGNED,
    CustomerReturn as CustomerReturnModel,
    CustomerReturnLine as CustomerReturnLineModel,
)
from app.models.product import Product as ProductModel
from app.models.smartup_return import SmartupReturn, SmartupReturnLine
from app.models.user import User as UserModel

router = APIRouter()
logger = logging.getLogger(__name__)


def _parse_smartup_expiry(raw: Optional[str]) -> Optional[date]:
    """SmartUp muddat matnini sanaga aylantiradi (yumshoq). Bo'lmasa None."""
    if not raw or not str(raw).strip():
        return None
    s = str(raw).strip().split(" ")[0]
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%m.%Y", "%Y-%m"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


class SmartupReturnLineOut(BaseModel):
    product_code: Optional[str] = None
    product_name: Optional[str] = None
    return_quant: Optional[Decimal] = None
    product_price: Optional[Decimal] = None
    expiry_date: Optional[str] = None
    warehouse_code: Optional[str] = None
    action_name: Optional[str] = None


class SmartupReturnOut(BaseModel):
    id: UUID
    deal_id: str
    order_deal_id: Optional[str] = None
    return_date: Optional[date] = None
    person_name: Optional[str] = None
    person_code: Optional[str] = None
    return_reason_id: Optional[str] = None
    sales_manager_name: Optional[str] = None
    total_amount: Optional[Decimal] = None
    status: Optional[str] = None
    wms_status: str
    note: Optional[str] = None
    customer_return_id: Optional[UUID] = None
    lines_count: int
    lines: List[SmartupReturnLineOut]


class SmartupReturnsListResponse(BaseModel):
    items: List[SmartupReturnOut]
    total: int


class SmartupReturnsSyncResponse(BaseModel):
    fetched: int
    created: int
    updated: int


def _to_out(r: SmartupReturn) -> SmartupReturnOut:
    return SmartupReturnOut(
        id=r.id,
        deal_id=r.deal_id,
        order_deal_id=r.order_deal_id,
        return_date=r.return_date,
        person_name=r.person_name,
        person_code=r.person_code,
        return_reason_id=r.return_reason_id,
        sales_manager_name=r.sales_manager_name,
        total_amount=r.total_amount,
        status=r.status,
        wms_status=r.wms_status,
        note=r.note,
        customer_return_id=r.customer_return_id,
        lines_count=len(r.lines),
        lines=[
            SmartupReturnLineOut(
                product_code=l.product_code,
                product_name=l.product_name,
                return_quant=l.return_quant,
                product_price=l.product_price,
                expiry_date=l.expiry_date,
                warehouse_code=l.warehouse_code,
                action_name=l.action_name,
            )
            for l in sorted(r.lines, key=lambda x: x.line_no or 0)
        ],
    )


@router.get("", response_model=SmartupReturnsListResponse, summary="SmartUp qaytarishlar ro'yxati")
@router.get("/", response_model=SmartupReturnsListResponse)
def list_smartup_returns(
    q: Optional[str] = Query(None, description="Mijoz nomi / deal_id / buyurtma bo'yicha qidiruv"),
    only_new: bool = Query(True, description="Faqat hali yig'uvchiga yuborilmaganlar (inbox)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["reports:read", "audit:read", "admin:access"])),
) -> SmartupReturnsListResponse:
    query = db.query(SmartupReturn).options(selectinload(SmartupReturn.lines))
    if only_new:
        query = query.filter(SmartupReturn.customer_return_id.is_(None))
    if q and q.strip():
        term = f"%{q.strip()}%"
        query = query.filter(
            or_(
                SmartupReturn.person_name.ilike(term),
                SmartupReturn.deal_id.ilike(term),
                SmartupReturn.order_deal_id.ilike(term),
            )
        )
    total = query.count()
    rows = (
        query.order_by(SmartupReturn.return_date.desc().nullslast(), SmartupReturn.deal_time.desc().nullslast())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return SmartupReturnsListResponse(items=[_to_out(r) for r in rows], total=total)


@router.get("/{return_id}", response_model=SmartupReturnOut, summary="Bitta qaytarish (mahsulotlari bilan)")
def get_smartup_return(
    return_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["reports:read", "audit:read", "admin:access"])),
) -> SmartupReturnOut:
    row = (
        db.query(SmartupReturn)
        .options(selectinload(SmartupReturn.lines))
        .filter(SmartupReturn.id == return_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Qaytarish topilmadi")
    return _to_out(row)


@router.post("/sync", response_model=SmartupReturnsSyncResponse, summary="SmartUp'dan oxirgi 30 kunni sinxronlash")
def sync_smartup_returns(
    days: int = Query(30, ge=1, le=90),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("admin:access")),
) -> SmartupReturnsSyncResponse:
    try:
        result = sync_returns(db, days=days)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("SmartUp returns sync error")
        raise HTTPException(status_code=500, detail="Sinxronlashda xato") from e
    return SmartupReturnsSyncResponse(**result)


class DispatchReturnBody(BaseModel):
    picker_user_id: UUID


class DispatchReturnResponse(BaseModel):
    customer_return_id: UUID
    doc_no: str
    status: str


def _generate_return_doc_no(deal_id: str) -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    token = uuid4().hex[:6].upper()
    return f"SRET-{today}-{(deal_id or '')[:12]}-{token}"[:64]


@router.post(
    "/{return_id}/dispatch",
    response_model=DispatchReturnResponse,
    summary="SmartUp qaytimni yig'uvchiga yuborish (customer_return yaratadi)",
)
def dispatch_smartup_return(
    return_id: UUID,
    payload: DispatchReturnBody,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_permission("documents:edit_status")),
) -> DispatchReturnResponse:
    ret = (
        db.query(SmartupReturn)
        .options(selectinload(SmartupReturn.lines))
        .filter(SmartupReturn.id == return_id)
        .one_or_none()
    )
    if ret is None:
        raise HTTPException(status_code=404, detail="Qaytarish topilmadi")
    if ret.customer_return_id is not None:
        raise HTTPException(status_code=409, detail="Qaytim allaqachon yig'uvchiga yuborilgan")
    if not ret.lines:
        raise HTTPException(status_code=400, detail="Qaytimda mahsulot yo'q")

    picker = (
        db.query(UserModel)
        .filter(
            UserModel.id == payload.picker_user_id,
            UserModel.role == "picker",
            UserModel.is_active.is_(True),
        )
        .one_or_none()
    )
    if not picker:
        raise HTTPException(status_code=400, detail="Noto'g'ri yig'uvchi")

    # Har bir qatorni WMS mahsulotiga bog'lash; birortasi mos kelmasa — bloklash.
    resolved: list[tuple[SmartupReturnLine, ProductModel, Decimal]] = []
    unmapped: list[dict] = []
    for line in sorted(ret.lines, key=lambda x: x.line_no or 0):
        code = (line.product_code or "").strip()
        product = (
            db.query(ProductModel).filter(ProductModel.smartup_code == code).one_or_none()
            if code
            else None
        )
        qty = line.return_quant
        if product is None:
            unmapped.append(
                {"product_code": line.product_code, "product_name": line.product_name, "reason": "not_found"}
            )
            continue
        if qty is None or qty <= 0 or (qty % 1 != 0):
            unmapped.append(
                {"product_code": line.product_code, "product_name": line.product_name, "reason": "bad_qty"}
            )
            continue
        resolved.append((line, product, Decimal(qty).quantize(Decimal("1"))))

    if unmapped:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "UNMAPPED_PRODUCTS",
                "message": "Ba'zi mahsulotlar WMS bazasida topilmadi",
                "items": unmapped,
            },
        )

    cr = CustomerReturnModel(
        doc_no=_generate_return_doc_no(ret.deal_id),
        customer_id=(ret.person_code or None),
        customer_name=(ret.person_name[:255] if ret.person_name else None),
        reason_code="customer_return",
        source="smartup",
        status=CUSTOMER_RETURN_STATUS_ASSIGNED,
        created_by_user_id=user.id,
        approved_by_user_id=user.id,
        assigned_picker_user_id=picker.id,
        assigned_by_user_id=user.id,
        assigned_at=datetime.now(timezone.utc),
    )
    for line, product, qty in resolved:
        exp = normalize_expiry_to_first_of_month(_parse_smartup_expiry(line.expiry_date))
        cr.lines.append(
            CustomerReturnLineModel(
                product_id=product.id,
                location_id=None,
                product_name=(line.product_name or product.name or "")[:512],
                location_code="",
                qty=qty,
                batch=uuid4().hex[:12],
                expiry_date=exp,
            )
        )
    db.add(cr)
    db.flush()

    ret.customer_return_id = cr.id
    ret.wms_status = "dispatched"
    db.commit()

    return DispatchReturnResponse(customer_return_id=cr.id, doc_no=cr.doc_no, status=cr.status)
