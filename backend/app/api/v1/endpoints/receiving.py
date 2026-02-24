from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, validator
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import get_current_user, require_any_permission, require_permission
from app.db import get_db
from app.models.location import Location as LocationModel
from app.models.product import Product as ProductModel
from app.models.receipt import Receipt as ReceiptModel
from app.models.receipt import ReceiptLine as ReceiptLineModel
from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel
from app.models.user import User as UserModel

router = APIRouter()

RECEIPT_STATUSES = {"draft", "completed", "cancelled"}


class ReceiptLineCreate(BaseModel):
    product_id: UUID
    qty: Decimal = Field(..., gt=0)
    batch: Optional[str] = Field(default=None, max_length=64)
    expiry_date: Optional[date] = None
    location_id: UUID

    @validator("qty")
    def qty_must_be_integer(cls, v: Decimal) -> Decimal:
        d = Decimal(str(v))
        if d % 1 != 0:
            raise ValueError("qty must be an integer")
        return d.quantize(Decimal("1"))


class ReceiptCreate(BaseModel):
    doc_no: Optional[str] = Field(default=None, max_length=64)
    lines: List[ReceiptLineCreate]


class ReceiptLineOut(BaseModel):
    id: UUID
    product_id: UUID
    qty: Decimal
    batch: str
    expiry_date: Optional[date] = None
    location_id: UUID


class ReceiptOut(BaseModel):
    id: UUID
    doc_no: str
    status: str
    created_by: Optional[UUID] = None
    created_by_username: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    lines: List[ReceiptLineOut]


class ReceiptListOut(BaseModel):
    items: List[ReceiptOut]
    total: int


class ReceiverOut(BaseModel):
    id: UUID
    name: str


def _to_receipt(receipt: ReceiptModel, created_by_username: Optional[str] = None) -> ReceiptOut:
    return ReceiptOut(
        id=receipt.id,
        doc_no=receipt.doc_no,
        status=receipt.status,
        created_by=receipt.created_by,
        created_by_username=created_by_username,
        created_at=receipt.created_at,
        updated_at=receipt.updated_at,
        lines=[
            ReceiptLineOut(
                id=line.id,
                product_id=line.product_id,
                qty=line.qty,
                batch=line.batch,
                expiry_date=line.expiry_date,
                location_id=line.location_id,
            )
            for line in receipt.lines
        ],
    )


def _generate_doc_no() -> str:
    today = datetime.utcnow().strftime("%Y%m%d")
    token = uuid4().hex[:6].upper()
    return f"RCPT-{today}-{token}"


@router.get("/receipts/receivers", response_model=List[ReceiverOut], summary="List receivers")
@router.get("/receipts/receivers/", response_model=List[ReceiverOut], summary="List receivers")
async def list_receipt_receivers(
    db: Session = Depends(get_db),
    _user=Depends(require_permission("receiving:read")),
):
    creator_ids = (
        db.query(ReceiptModel.created_by)
        .filter(ReceiptModel.created_by.isnot(None))
        .distinct()
        .all()
    )
    creator_ids = [row[0] for row in creator_ids]
    if not creator_ids:
        return []
    users = (
        db.query(UserModel.id, UserModel.full_name, UserModel.username)
        .filter(UserModel.id.in_(creator_ids))
        .all()
    )
    return [
        ReceiverOut(
            id=u.id,
            name=(u.full_name or u.username or str(u.id)),
        )
        for u in users
    ]


@router.get("/receipts", response_model=ReceiptListOut, summary="List receipts")
@router.get("/receipts/", response_model=ReceiptListOut, summary="List receipts")
async def list_receipts(
    created_by: Optional[UUID] = Query(None, description="Filter by receiver user ID"),
    date_from: Optional[str] = Query(None, description="Filter from date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Filter to date (YYYY-MM-DD)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("receiving:read")),
):
    query = db.query(ReceiptModel).options(selectinload(ReceiptModel.lines))
    if created_by:
        query = query.filter(ReceiptModel.created_by == created_by)
    if date_from:
        try:
            d = date.fromisoformat(date_from)
            query = query.filter(ReceiptModel.created_at >= datetime.combine(d, time.min))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_from")
    if date_to:
        try:
            d = date.fromisoformat(date_to)
            query = query.filter(
                ReceiptModel.created_at <= datetime.combine(d, time.max)
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_to")
    total = query.count()
    receipts = query.order_by(ReceiptModel.created_at.desc()).offset(offset).limit(limit).all()
    creator_ids = {r.created_by for r in receipts if r.created_by}
    creator_map: dict[UUID, str] = {}
    if creator_ids:
        users = db.query(UserModel.id, UserModel.full_name, UserModel.username).filter(
            UserModel.id.in_(creator_ids)
        ).all()
        for u in users:
            creator_map[u.id] = (u.full_name or u.username) if u else ""
    items = [
        _to_receipt(receipt, created_by_username=creator_map.get(receipt.created_by))
        for receipt in receipts
    ]
    return ReceiptListOut(items=items, total=total)


@router.get("/receipts/{receipt_id}", response_model=ReceiptOut, summary="Get receipt")
async def get_receipt(
    receipt_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("receiving:read")),
):
    receipt = (
        db.query(ReceiptModel)
        .options(selectinload(ReceiptModel.lines))
        .filter(ReceiptModel.id == receipt_id)
        .one_or_none()
    )
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")
    created_by_username = None
    if receipt.created_by:
        creator = db.query(UserModel).filter(UserModel.id == receipt.created_by).one_or_none()
        if creator:
            created_by_username = creator.full_name or creator.username
    return _to_receipt(receipt, created_by_username=created_by_username)


@router.post("/receipts", response_model=ReceiptOut, status_code=status.HTTP_201_CREATED)
@router.post("/receipts/", response_model=ReceiptOut, status_code=status.HTTP_201_CREATED)
async def create_receipt(
    payload: ReceiptCreate,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_any_permission(["receiving:write", "admin:access"])),
):
    if not payload.lines:
        raise HTTPException(status_code=400, detail="Receipt lines must not be empty")
    
    # Validate expiry dates
    today = date.today()
    for line in payload.lines:
        if line.expiry_date and line.expiry_date < today:
            raise HTTPException(
                status_code=400,
                detail=f"Expiry date {line.expiry_date} is in the past for product {line.product_id}"
            )
    
    doc_no = payload.doc_no.strip() if payload.doc_no else _generate_doc_no()

    existing = db.query(ReceiptModel).filter(ReceiptModel.doc_no == doc_no).one_or_none()
    if existing:
        uname = None
        if existing.created_by:
            c = db.query(UserModel).filter(UserModel.id == existing.created_by).one_or_none()
            if c:
                uname = c.full_name or c.username
        return _to_receipt(existing, created_by_username=uname)

    receipt = ReceiptModel(doc_no=doc_no, status="draft", created_by=user.id)
    receipt.lines = []

    for line in payload.lines:
        product = db.query(ProductModel.id).filter(ProductModel.id == line.product_id).one_or_none()
        if not product:
            raise HTTPException(status_code=400, detail="Product not found")
        location = (
            db.query(LocationModel)
            .filter(LocationModel.id == line.location_id, LocationModel.is_active.is_(True))
            .one_or_none()
        )
        if not location:
            raise HTTPException(status_code=400, detail="Location not found")
        batch_val = (line.batch or "").strip()
        if not batch_val:
            batch_val = uuid4().hex[:12]
        receipt.lines.append(
            ReceiptLineModel(
                product_id=line.product_id,
                qty=line.qty,
                batch=batch_val,
                expiry_date=line.expiry_date,
                location_id=line.location_id,
            )
        )

    db.add(receipt)
    db.commit()
    db.refresh(receipt)
    creator_name = user.full_name or user.username
    return _to_receipt(receipt, created_by_username=creator_name)


@router.post(
    "/receipts/{receipt_id}/complete",
    response_model=ReceiptOut,
    status_code=status.HTTP_200_OK,
    summary="Complete receipt and post stock movements",
)
async def complete_receipt(
    receipt_id: UUID,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_any_permission(["receiving:write", "admin:access"])),
):
    receipt = (
        db.query(ReceiptModel)
        .options(selectinload(ReceiptModel.lines))
        .filter(ReceiptModel.id == receipt_id)
        .one_or_none()
    )
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")
    if receipt.status == "completed":
        return _to_receipt(receipt)

    existing_movements = (
        db.query(StockMovementModel.id)
        .filter(
            StockMovementModel.source_document_type == "receipt",
            StockMovementModel.source_document_id == receipt.id,
        )
        .first()
    )
    # Guard against double-posting: receipt completion is append-only in the stock ledger.
    if existing_movements:
        raise HTTPException(status_code=409, detail="Receipt already posted")

    if not receipt.lines:
        raise HTTPException(status_code=400, detail="Receipt has no lines")

    for line in receipt.lines:
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

        movement = StockMovementModel(
            product_id=line.product_id,
            lot_id=lot.id,
            location_id=line.location_id,
            qty_change=line.qty,
            movement_type="receipt",
            source_document_type="receipt",
            source_document_id=receipt.id,
            created_by_user_id=user.id,
        )
        db.add(movement)

    receipt.status = "completed"
    db.commit()
    db.refresh(receipt)
    created_by_username = None
    if receipt.created_by:
        creator = db.query(UserModel).filter(UserModel.id == receipt.created_by).one_or_none()
        if creator:
            created_by_username = creator.full_name or creator.username
    return _to_receipt(receipt, created_by_username=created_by_username)
