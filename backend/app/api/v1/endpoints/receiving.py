from __future__ import annotations

from datetime import date, datetime
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
    batch: str = Field(..., min_length=1, max_length=64)
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


@router.get("/receipts", response_model=List[ReceiptOut], summary="List receipts")
@router.get("/receipts/", response_model=List[ReceiptOut], summary="List receipts")
async def list_receipts(
    status: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("receiving:read")),
):
    query = db.query(ReceiptModel).options(selectinload(ReceiptModel.lines))
    if status:
        tokens = [token.strip() for token in status.split(",") if token.strip()]
        invalid = [token for token in tokens if token not in RECEIPT_STATUSES]
        if invalid:
            raise HTTPException(status_code=400, detail="Invalid receipt status")
        query = query.filter(ReceiptModel.status.in_(tokens))
    receipts = query.order_by(ReceiptModel.created_at.desc()).offset(offset).limit(limit).all()
    creator_ids = {r.created_by for r in receipts if r.created_by}
    creator_map: dict[UUID, str] = {}
    if creator_ids:
        users = db.query(UserModel.id, UserModel.full_name, UserModel.username).filter(
            UserModel.id.in_(creator_ids)
        ).all()
        for u in users:
            creator_map[u.id] = (u.full_name or u.username) if u else ""
    return [
        _to_receipt(receipt, created_by_username=creator_map.get(receipt.created_by))
        for receipt in receipts
    ]


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
        receipt.lines.append(
            ReceiptLineModel(
                product_id=line.product_id,
                qty=line.qty,
                batch=line.batch.strip(),
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
