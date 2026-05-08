"""Mijozdan qaytgan mahsulot: controller tekshiruvi, keyin yig'uvchi joylashtirish (ombor receipt)."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, validator
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import get_current_user, get_effective_permissions, require_any_permission, require_permission
from app.core.expiry import first_day_of_current_month, normalize_expiry_to_first_of_month
from app.core.stock_rules import check_location_single_expiry
from app.db import get_db
from app.models.customer_return import (
    CUSTOMER_RETURN_STATUS_APPROVED,
    CUSTOMER_RETURN_STATUS_ASSIGNED,
    CUSTOMER_RETURN_STATUS_COMPLETED,
    CUSTOMER_RETURN_STATUS_PENDING,
    CustomerReturn as CustomerReturnModel,
    CustomerReturnLine as CustomerReturnLineModel,
)
from app.models.location import Location as LocationModel
from app.models.product import Product as ProductModel
from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel
from app.models.user import User as UserModel

router = APIRouter()
RETURN_REASON_CODES = {"customer_return", "damaged", "wrong_shipment"}


def _is_missing_reason_code_column_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return (
        "reason_code" in msg
        and "customer_return" in msg
        and ("does not exist" in msg or "unknown column" in msg or "no such column" in msg)
    )


def _is_missing_customer_returns_schema_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    is_missing_column = "does not exist" in msg or "unknown column" in msg or "no such column" in msg
    touches_returns_tables = "customer_returns" in msg or "customer_return_lines" in msg
    return is_missing_column and touches_returns_tables


class CustomerReturnLineCreate(BaseModel):
    product_id: UUID
    location_id: UUID
    qty: Decimal = Field(..., gt=0)
    product_name: str = Field(..., max_length=512)
    location_code: str = Field(default="", max_length=64)
    batch: Optional[str] = Field(default=None, max_length=64)
    expiry_date: Optional[str] = None  # YYYY-MM-DD

    @validator("qty")
    def qty_int(cls, v: Decimal) -> Decimal:
        d = Decimal(str(v))
        if d % 1 != 0:
            raise ValueError("qty must be an integer")
        return d.quantize(Decimal("1"))


class CustomerReturnCreate(BaseModel):
    doc_no: Optional[str] = Field(default=None, max_length=64)
    customer_id: Optional[str] = Field(default=None, max_length=64)
    customer_name: Optional[str] = Field(default=None, max_length=255)
    reason_code: str = Field(..., max_length=32)
    lines: List[CustomerReturnLineCreate]

    @validator("reason_code")
    def reason_code_valid(cls, v: str) -> str:
        value = (v or "").strip().lower()
        if value not in RETURN_REASON_CODES:
            raise ValueError("Invalid reason_code")
        return value


class CustomerReturnLineOut(BaseModel):
    id: UUID
    product_id: UUID
    location_id: UUID
    product_name: str
    location_code: str
    qty: Decimal
    batch: str
    expiry_date: Optional[str] = None


class CustomerReturnOut(BaseModel):
    id: UUID
    doc_no: str
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    reason_code: Optional[str] = None
    status: str
    created_by_user_id: Optional[UUID] = None
    created_by_user_name: Optional[str] = None
    approved_by_user_id: Optional[UUID] = None
    approved_by_user_name: Optional[str] = None
    assigned_picker_user_id: Optional[UUID] = None
    assigned_by_user_id: Optional[UUID] = None
    assigned_at: Optional[datetime] = None
    assigned_by_user_name: Optional[str] = None
    assigned_picker_user_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    lines: List[CustomerReturnLineOut]


class CustomerReturnListOut(BaseModel):
    items: List[CustomerReturnOut]
    total: int


class AssignPickerBody(BaseModel):
    picker_user_id: UUID


class CompleteCustomerReturnLineBody(BaseModel):
    line_id: UUID
    location_id: UUID


class CompleteCustomerReturnBody(BaseModel):
    location_id: Optional[UUID] = None
    lines: Optional[List[CompleteCustomerReturnLineBody]] = None


def _generate_doc_no() -> str:
    today = datetime.utcnow().strftime("%Y%m%d")
    token = uuid4().hex[:6].upper()
    return f"CRET-{today}-{token}"


def _line_to_out(line: CustomerReturnLineModel) -> CustomerReturnLineOut:
    return CustomerReturnLineOut(
        id=line.id,
        product_id=line.product_id,
        location_id=line.location_id,
        product_name=line.product_name,
        location_code=line.location_code,
        qty=line.qty,
        batch=line.batch,
        expiry_date=line.expiry_date.isoformat() if line.expiry_date else None,
    )


def _to_out(
    cr: CustomerReturnModel,
    *,
    created_by_user_name: Optional[str] = None,
    approved_by_user_name: Optional[str] = None,
    assigned_by_user_name: Optional[str] = None,
    assigned_picker_user_name: Optional[str] = None,
) -> CustomerReturnOut:
    return CustomerReturnOut(
        id=cr.id,
        doc_no=cr.doc_no,
        customer_id=cr.customer_id,
        customer_name=cr.customer_name,
        reason_code=cr.reason_code,
        status=cr.status,
        created_by_user_id=cr.created_by_user_id,
        created_by_user_name=created_by_user_name,
        approved_by_user_id=cr.approved_by_user_id,
        approved_by_user_name=approved_by_user_name,
        assigned_picker_user_id=cr.assigned_picker_user_id,
        assigned_by_user_id=cr.assigned_by_user_id,
        assigned_at=cr.assigned_at,
        assigned_by_user_name=assigned_by_user_name,
        assigned_picker_user_name=assigned_picker_user_name,
        created_at=cr.created_at,
        updated_at=cr.updated_at,
        lines=[_line_to_out(l) for l in cr.lines],
    )


def _build_user_name_map(db: Session, user_ids: List[UUID]) -> dict[UUID, str]:
    unique_ids = list({uid for uid in user_ids if uid is not None})
    if not unique_ids:
        return {}
    users = db.query(UserModel.id, UserModel.full_name, UserModel.username).filter(UserModel.id.in_(unique_ids)).all()
    return {u.id: (u.full_name or u.username or "").strip() for u in users}


def _parse_expiry(s: Optional[str]):
    if not s or not str(s).strip():
        return None
    raw = str(s).strip()[:10]
    from datetime import date as date_type

    try:
        return date_type.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid expiry_date, use YYYY-MM-DD")


@router.post("", response_model=CustomerReturnOut, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=CustomerReturnOut, status_code=status.HTTP_201_CREATED)
async def create_customer_return(
    payload: CustomerReturnCreate,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_any_permission(["receiving:write", "admin:access"])),
):
    if not payload.lines:
        raise HTTPException(status_code=400, detail="Lines must not be empty")

    cid_raw = (payload.customer_id or "").strip() if payload.customer_id else ""
    cname_raw = (payload.customer_name or "").strip() if payload.customer_name else ""
    if cid_raw or cname_raw:
        if not cid_raw or not cname_raw:
            raise HTTPException(
                status_code=400,
                detail="customer_id and customer_name must both be set when providing customer",
            )
    cust_id = cid_raw if cid_raw else None
    cust_name = cname_raw[:255] if cust_id else None

    doc_no = payload.doc_no.strip() if payload.doc_no else _generate_doc_no()
    try:
        existing_doc = db.query(CustomerReturnModel.id).filter(CustomerReturnModel.doc_no == doc_no).first()
    except (ProgrammingError, OperationalError) as exc:
        db.rollback()
        if _is_missing_customer_returns_schema_error(exc):
            raise HTTPException(
                status_code=500,
                detail="DB migration required: customer_returns schema is outdated. Run alembic upgrade head.",
            ) from exc
        raise
    if existing_doc:
        raise HTTPException(status_code=409, detail="doc_no already exists")

    first_of_month = first_day_of_current_month()
    cr = CustomerReturnModel(
        doc_no=doc_no,
        customer_id=cust_id,
        customer_name=cust_name,
        reason_code=payload.reason_code,
        status=CUSTOMER_RETURN_STATUS_PENDING,
        created_by_user_id=user.id,
    )
    for line in payload.lines:
        product = db.query(ProductModel).filter(ProductModel.id == line.product_id).one_or_none()
        if not product:
            raise HTTPException(status_code=400, detail=f"Product not found: {line.product_id}")
        loc = (
            db.query(LocationModel)
            .filter(LocationModel.id == line.location_id, LocationModel.is_active.is_(True))
            .one_or_none()
        )
        if not loc:
            raise HTTPException(status_code=400, detail="Location not found")
        exp = _parse_expiry(line.expiry_date)
        if exp:
            norm = normalize_expiry_to_first_of_month(exp)
            if norm and norm < first_of_month:
                raise HTTPException(status_code=400, detail="Expiry date is in the past for this product")
        else:
            norm = None
        batch_val = (line.batch or "").strip()
        if not batch_val:
            batch_val = uuid4().hex[:12]
        # Customer return is a receipt flow: we validate location/expiry compatibility,
        # but do not cap qty by currently available stock.
        check_location_single_expiry(db, line.location_id, line.product_id, norm)
        cr.lines.append(
            CustomerReturnLineModel(
                product_id=line.product_id,
                location_id=line.location_id,
                product_name=(line.product_name or product.name or "")[:512],
                location_code=(line.location_code or loc.code or "")[:64],
                qty=line.qty,
                batch=batch_val,
                expiry_date=norm,
            )
        )
    db.add(cr)
    try:
        db.commit()
    except (ProgrammingError, OperationalError) as exc:
        db.rollback()
        if _is_missing_reason_code_column_error(exc) or _is_missing_customer_returns_schema_error(exc):
            raise HTTPException(
                status_code=500,
                detail="DB migration required: customer_returns schema is outdated. Run alembic upgrade head.",
            ) from exc
        raise
    db.refresh(cr)
    cr = (
        db.query(CustomerReturnModel)
        .options(selectinload(CustomerReturnModel.lines))
        .filter(CustomerReturnModel.id == cr.id)
        .one()
    )
    return _to_out(cr)


@router.get("", response_model=CustomerReturnListOut)
@router.get("/", response_model=CustomerReturnListOut)
async def list_customer_returns(
    status_filter: Optional[str] = Query(None, alias="status"),
    mine_as_picker: bool = Query(False, description="Faqat menga biriktirilgan (yig'uvchi)"),
    search_q: Optional[str] = Query(None, alias="q", min_length=1, max_length=120),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
):
    perms = get_effective_permissions(user)
    q = db.query(CustomerReturnModel).options(selectinload(CustomerReturnModel.lines))
    if mine_as_picker:
        if "picking:write" not in perms:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        q = q.filter(CustomerReturnModel.assigned_picker_user_id == user.id)
        # Picker queue only exposes controller-sent assigned returns.
        q = q.filter(CustomerReturnModel.status == CUSTOMER_RETURN_STATUS_ASSIGNED)
    elif status_filter in (
        CUSTOMER_RETURN_STATUS_PENDING,
        CUSTOMER_RETURN_STATUS_APPROVED,
    ):
        if "documents:edit_status" not in perms and "admin:access" not in perms:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        q = q.filter(CustomerReturnModel.status == status_filter)
    elif status_filter == CUSTOMER_RETURN_STATUS_ASSIGNED:
        if "documents:edit_status" not in perms and "admin:access" not in perms:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        q = q.filter(CustomerReturnModel.status == status_filter)
    elif status_filter:
        if "receiving:read" not in perms and "admin:access" not in perms:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        q = q.filter(CustomerReturnModel.status == status_filter)
        if "admin:access" not in perms and "documents:edit_status" not in perms:
            q = q.filter(CustomerReturnModel.created_by_user_id == user.id)
    else:
        if "receiving:read" not in perms and "admin:access" not in perms and "documents:edit_status" not in perms:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if "admin:access" not in perms and "documents:edit_status" not in perms:
            q = q.filter(CustomerReturnModel.created_by_user_id == user.id)
    if date_from is not None:
        q = q.filter(CustomerReturnModel.created_at >= date_from)
    if date_to is not None:
        q = q.filter(CustomerReturnModel.created_at <= date_to)
    search = (search_q or "").strip()
    if search:
        like_value = f"%{search}%"
        q = q.filter(
            (CustomerReturnModel.doc_no.ilike(like_value))
            | (CustomerReturnModel.customer_id.ilike(like_value))
            | (CustomerReturnModel.customer_name.ilike(like_value))
        )
    total = q.count()
    rows = q.order_by(CustomerReturnModel.created_at.desc()).offset(offset).limit(limit).all()
    user_name_map = _build_user_name_map(
        db,
        [
            uid
            for row in rows
            for uid in (
                row.created_by_user_id,
                row.approved_by_user_id,
                row.assigned_by_user_id,
                row.assigned_picker_user_id,
            )
            if uid is not None
        ],
    )
    return CustomerReturnListOut(
        items=[
            _to_out(
                r,
                created_by_user_name=user_name_map.get(r.created_by_user_id),
                approved_by_user_name=user_name_map.get(r.approved_by_user_id),
                assigned_by_user_name=user_name_map.get(r.assigned_by_user_id),
                assigned_picker_user_name=user_name_map.get(r.assigned_picker_user_id),
            )
            for r in rows
        ],
        total=total,
    )


@router.get("/{return_id}", response_model=CustomerReturnOut)
async def get_customer_return(
    return_id: UUID,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
):
    perms = get_effective_permissions(user)
    cr = (
        db.query(CustomerReturnModel)
        .options(selectinload(CustomerReturnModel.lines))
        .filter(CustomerReturnModel.id == return_id)
        .one_or_none()
    )
    if not cr:
        raise HTTPException(status_code=404, detail="Not found")
    if "admin:access" not in perms:
        if cr.created_by_user_id == user.id:
            pass
        elif "documents:edit_status" in perms:
            pass
        elif (
            cr.assigned_picker_user_id == user.id
            and "picking:write" in perms
            and cr.status in (CUSTOMER_RETURN_STATUS_ASSIGNED, CUSTOMER_RETURN_STATUS_COMPLETED)
        ):
            pass
        else:
            raise HTTPException(status_code=404, detail="Not found")
    user_name_map = _build_user_name_map(
        db,
        [
            uid
            for uid in (
                cr.created_by_user_id,
                cr.approved_by_user_id,
                cr.assigned_by_user_id,
                cr.assigned_picker_user_id,
            )
            if uid is not None
        ],
    )
    return _to_out(
        cr,
        created_by_user_name=user_name_map.get(cr.created_by_user_id),
        approved_by_user_name=user_name_map.get(cr.approved_by_user_id),
        assigned_by_user_name=user_name_map.get(cr.assigned_by_user_id),
        assigned_picker_user_name=user_name_map.get(cr.assigned_picker_user_id),
    )


@router.post("/{return_id}/controller-approve", response_model=CustomerReturnOut)
async def controller_approve_customer_return(
    return_id: UUID,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_permission("documents:edit_status")),
):
    cr = (
        db.query(CustomerReturnModel)
        .options(selectinload(CustomerReturnModel.lines))
        .filter(CustomerReturnModel.id == return_id)
        .one_or_none()
    )
    if not cr:
        raise HTTPException(status_code=404, detail="Not found")
    if cr.status != CUSTOMER_RETURN_STATUS_PENDING:
        raise HTTPException(status_code=409, detail="Return is not pending controller review")
    cr.status = CUSTOMER_RETURN_STATUS_APPROVED
    cr.approved_by_user_id = user.id
    db.commit()
    db.refresh(cr)
    return _to_out(cr)


@router.post("/{return_id}/assign-picker", response_model=CustomerReturnOut)
async def assign_picker_customer_return(
    return_id: UUID,
    payload: AssignPickerBody,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_permission("documents:edit_status")),
):
    cr = (
        db.query(CustomerReturnModel)
        .options(selectinload(CustomerReturnModel.lines))
        .filter(CustomerReturnModel.id == return_id)
        .one_or_none()
    )
    if not cr:
        raise HTTPException(status_code=404, detail="Not found")
    if cr.status != CUSTOMER_RETURN_STATUS_APPROVED:
        raise HTTPException(status_code=409, detail="Return must be approved before assigning picker")
    if cr.approved_by_user_id is None:
        raise HTTPException(status_code=409, detail="Return approval is incomplete")
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
        raise HTTPException(status_code=400, detail="Invalid picker user")
    cr.assigned_picker_user_id = payload.picker_user_id
    cr.assigned_by_user_id = user.id
    cr.assigned_at = datetime.utcnow()
    cr.status = CUSTOMER_RETURN_STATUS_ASSIGNED
    db.commit()
    db.refresh(cr)
    return _to_out(
        cr,
        assigned_by_user_name=(user.full_name or user.username or "").strip(),
        assigned_picker_user_name=(picker.full_name or picker.username or "").strip(),
    )


@router.post("/{return_id}/complete", response_model=CustomerReturnOut)
async def complete_customer_return(
    return_id: UUID,
    payload: CompleteCustomerReturnBody,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_any_permission(["receiving:write", "picking:write", "admin:access"])),
):
    cr = (
        db.query(CustomerReturnModel)
        .options(selectinload(CustomerReturnModel.lines))
        .filter(CustomerReturnModel.id == return_id)
        .one_or_none()
    )
    if not cr:
        raise HTTPException(status_code=404, detail="Not found")
    if cr.status != CUSTOMER_RETURN_STATUS_ASSIGNED:
        raise HTTPException(status_code=409, detail="Return is not assigned to picker")
    if cr.assigned_picker_user_id is None:
        raise HTTPException(status_code=409, detail="Assigned picker is missing")
    if cr.assigned_picker_user_id != user.id:
        perms = get_effective_permissions(user)
        if not ("receiving:write" in perms and "admin:access" in perms):
            raise HTTPException(status_code=403, detail="Only assigned picker can complete")

    existing = (
        db.query(StockMovementModel.id)
        .filter(
            StockMovementModel.source_document_type == "customer_return",
            StockMovementModel.source_document_id == cr.id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Already posted to stock")

    if not cr.lines:
        raise HTTPException(status_code=400, detail="No lines")

    line_location_map: dict[UUID, UUID] = {}
    if payload.lines:
        for item in payload.lines:
            line_location_map[item.line_id] = item.location_id
    elif payload.location_id:
        for line in cr.lines:
            line_location_map[line.id] = payload.location_id
    else:
        raise HTTPException(status_code=400, detail="location_id or lines[] is required")

    cr_line_ids = {line.id for line in cr.lines}
    if set(line_location_map.keys()) != cr_line_ids:
        raise HTTPException(status_code=400, detail="All return lines must have location mapping")

    location_ids = list({loc_id for loc_id in line_location_map.values()})
    locations = (
        db.query(LocationModel)
        .filter(LocationModel.id.in_(location_ids), LocationModel.is_active.is_(True))
        .all()
    )
    location_map = {loc.id: loc for loc in locations}
    if len(location_map) != len(location_ids):
        raise HTTPException(status_code=400, detail="One or more target locations not found")

    for line in cr.lines:
        target_location = location_map[line_location_map[line.id]]
        line.location_id = target_location.id
        line.location_code = target_location.code
        expiry_normalized = normalize_expiry_to_first_of_month(line.expiry_date)
        check_location_single_expiry(db, target_location.id, line.product_id, expiry_normalized)

        lot = (
            db.query(StockLotModel)
            .filter(
                StockLotModel.product_id == line.product_id,
                StockLotModel.batch == line.batch,
                StockLotModel.expiry_date == line.expiry_date,
            )
            .one_or_none()
        )
        if not lot:
            lot = StockLotModel(
                product_id=line.product_id,
                batch=line.batch,
                expiry_date=line.expiry_date,
            )
            db.add(lot)
            db.flush()

        db.add(
            StockMovementModel(
                product_id=line.product_id,
                lot_id=lot.id,
                location_id=target_location.id,
                qty_change=line.qty,
                movement_type="receipt",
                source_document_type="customer_return",
                source_document_id=cr.id,
                created_by_user_id=user.id,
            )
        )

    cr.status = CUSTOMER_RETURN_STATUS_COMPLETED
    db.commit()
    db.refresh(cr)
    cr = (
        db.query(CustomerReturnModel)
        .options(selectinload(CustomerReturnModel.lines))
        .filter(CustomerReturnModel.id == return_id)
        .one()
    )
    user_name_map = _build_user_name_map(
        db,
        [
            uid
            for uid in (
                cr.created_by_user_id,
                cr.approved_by_user_id,
                cr.assigned_by_user_id,
                cr.assigned_picker_user_id,
            )
            if uid is not None
        ],
    )
    return _to_out(
        cr,
        created_by_user_name=user_name_map.get(cr.created_by_user_id),
        approved_by_user_name=user_name_map.get(cr.approved_by_user_id),
        assigned_by_user_name=user_name_map.get(cr.assigned_by_user_id),
        assigned_picker_user_name=user_name_map.get(cr.assigned_picker_user_id),
    )
