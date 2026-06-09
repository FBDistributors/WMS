"""Quti (karobka) CRUD — mahsulotga bog'langan quti shtrix-kodlari."""
from __future__ import annotations

from datetime import datetime
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.auth.deps import require_any_permission, require_permission
from app.db import get_db
from app.models.product import Product as ProductModel
from app.models.product_box import ProductBox as ProductBoxModel
from app.models.user import User as UserModel
from app.services.audit_service import ACTION_CREATE, ACTION_DELETE, ACTION_UPDATE, get_client_ip, log_action

router = APIRouter()


class ProductBoxProductOut(BaseModel):
    id: UUID
    name: str
    sku: str
    barcode: str | None = None


class ProductBoxOut(BaseModel):
    id: UUID
    box_barcode: str
    product_id: UUID
    units_per_box: int
    label: str | None = None
    is_active: bool
    created_at: datetime
    product: ProductBoxProductOut | None = None


class ProductBoxCreate(BaseModel):
    box_barcode: str = Field(..., min_length=1, max_length=64)
    product_id: UUID
    units_per_box: int = Field(..., gt=0)
    label: str | None = Field(default=None, max_length=255)


class ProductBoxUpdate(BaseModel):
    box_barcode: str | None = Field(default=None, min_length=1, max_length=64)
    product_id: UUID | None = None
    units_per_box: int | None = Field(default=None, gt=0)
    label: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None


class ProductBoxResolveOut(BaseModel):
    product_id: UUID
    units_per_box: int
    scan_kind: str  # "box"
    product_name: str
    product_sku: str
    product_barcode: str | None = None
    box_id: UUID


def _to_out(item: ProductBoxModel) -> ProductBoxOut:
    prod_out = None
    if item.product:
        prod_out = ProductBoxProductOut(
            id=item.product.id,
            name=item.product.name,
            sku=item.product.sku,
            barcode=item.product.barcode,
        )
    return ProductBoxOut(
        id=item.id,
        box_barcode=item.box_barcode,
        product_id=item.product_id,
        units_per_box=item.units_per_box,
        label=item.label,
        is_active=item.is_active,
        created_at=item.created_at,
        product=prod_out,
    )


def _normalize_box_barcode(raw: str) -> str:
    return (raw or "").strip()


@router.get("", response_model=List[ProductBoxOut], summary="List product boxes")
@router.get("/", response_model=List[ProductBoxOut], summary="List product boxes")
async def list_product_boxes(
    search: str | None = Query(None),
    product_id: UUID | None = Query(None),
    active_only: bool = Query(True),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: UserModel = Depends(require_any_permission(["products:read", "admin:access"])),
):
    query = (
        db.query(ProductBoxModel)
        .options(joinedload(ProductBoxModel.product))
    )
    if active_only:
        query = query.filter(ProductBoxModel.is_active.is_(True))
    if product_id:
        query = query.filter(ProductBoxModel.product_id == product_id)
    if search:
        term = f"%{search.strip()}%"
        query = query.join(ProductModel, ProductBoxModel.product_id == ProductModel.id).filter(
            or_(
                ProductBoxModel.box_barcode.ilike(term),
                ProductBoxModel.label.ilike(term),
                ProductModel.name.ilike(term),
                ProductModel.sku.ilike(term),
            )
        )
    items = (
        query.order_by(ProductBoxModel.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_to_out(i) for i in items]


@router.get(
    "/by-barcode/{barcode}",
    response_model=ProductBoxResolveOut,
    summary="Resolve box barcode to product",
)
async def resolve_box_by_barcode(
    barcode: str,
    db: Session = Depends(get_db),
    _user: UserModel = Depends(require_any_permission(["picking:read", "products:read", "inventory:read"])),
):
    code = _normalize_box_barcode(barcode)
    if not code:
        raise HTTPException(status_code=400, detail="Barcode is empty")
    box = (
        db.query(ProductBoxModel)
        .options(joinedload(ProductBoxModel.product))
        .filter(
            ProductBoxModel.box_barcode == code,
            ProductBoxModel.is_active.is_(True),
        )
        .one_or_none()
    )
    if not box or not box.product or not box.product.is_active:
        raise HTTPException(status_code=404, detail="Quti topilmadi")
    return ProductBoxResolveOut(
        product_id=box.product_id,
        units_per_box=box.units_per_box,
        scan_kind="box",
        product_name=box.product.name,
        product_sku=box.product.sku,
        product_barcode=box.product.barcode,
        box_id=box.id,
    )


@router.post("", response_model=ProductBoxOut, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=ProductBoxOut, status_code=status.HTTP_201_CREATED)
async def create_product_box(
    request: Request,
    payload: ProductBoxCreate,
    db: Session = Depends(get_db),
    user: UserModel = Depends(
        require_any_permission(["products:write", "inventory:adjust"])
    ),
):
    code = _normalize_box_barcode(payload.box_barcode)
    if not code:
        raise HTTPException(status_code=400, detail="box_barcode required")
    product = db.query(ProductModel).filter(ProductModel.id == payload.product_id).one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    existing = db.query(ProductBoxModel).filter(ProductBoxModel.box_barcode == code).one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Box barcode already exists")
    item = ProductBoxModel(
        box_barcode=code,
        product_id=payload.product_id,
        units_per_box=payload.units_per_box,
        label=payload.label.strip() if payload.label else None,
        is_active=True,
    )
    try:
        db.add(item)
        db.flush()
        log_action(
            db,
            user_id=user.id,
            action=ACTION_CREATE,
            entity_type="product_box",
            entity_id=str(item.id),
            ip_address=get_client_ip(request),
            new_data={
                "box_barcode": code,
                "product_id": str(payload.product_id),
                "units_per_box": payload.units_per_box,
            },
        )
        db.commit()
        db.refresh(item)
        return _to_out(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Box barcode already exists")


@router.patch("/{box_id}", response_model=ProductBoxOut)
async def update_product_box(
    box_id: UUID,
    request: Request,
    payload: ProductBoxUpdate,
    db: Session = Depends(get_db),
    user: UserModel = Depends(require_permission("products:write")),
):
    item = (
        db.query(ProductBoxModel)
        .options(joinedload(ProductBoxModel.product))
        .filter(ProductBoxModel.id == box_id)
        .one_or_none()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Box not found")
    old_data = {
        "box_barcode": item.box_barcode,
        "product_id": str(item.product_id),
        "units_per_box": item.units_per_box,
        "is_active": item.is_active,
    }
    if payload.box_barcode is not None:
        code = _normalize_box_barcode(payload.box_barcode)
        if not code:
            raise HTTPException(status_code=400, detail="box_barcode required")
        dup = (
            db.query(ProductBoxModel)
            .filter(ProductBoxModel.box_barcode == code, ProductBoxModel.id != box_id)
            .one_or_none()
        )
        if dup:
            raise HTTPException(status_code=409, detail="Box barcode already exists")
        item.box_barcode = code
    if payload.product_id is not None:
        product = db.query(ProductModel).filter(ProductModel.id == payload.product_id).one_or_none()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        item.product_id = payload.product_id
    if payload.units_per_box is not None:
        item.units_per_box = payload.units_per_box
    if payload.label is not None:
        item.label = payload.label.strip() or None
    if payload.is_active is not None:
        item.is_active = payload.is_active
    try:
        db.flush()
        log_action(
            db,
            user_id=user.id,
            action=ACTION_UPDATE,
            entity_type="product_box",
            entity_id=str(item.id),
            ip_address=get_client_ip(request),
            old_data=old_data,
            new_data={
                "box_barcode": item.box_barcode,
                "product_id": str(item.product_id),
                "units_per_box": item.units_per_box,
                "is_active": item.is_active,
            },
        )
        db.commit()
        db.refresh(item)
        return _to_out(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Box barcode already exists")


@router.delete("/{box_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product_box(
    box_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(require_permission("products:write")),
):
    item = db.query(ProductBoxModel).filter(ProductBoxModel.id == box_id).one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Box not found")
    old_data = {"box_barcode": item.box_barcode, "product_id": str(item.product_id)}
    item.is_active = False
    log_action(
        db,
        user_id=user.id,
        action=ACTION_DELETE,
        entity_type="product_box",
        entity_id=str(item.id),
        ip_address=get_client_ip(request),
        old_data=old_data,
    )
    db.commit()
