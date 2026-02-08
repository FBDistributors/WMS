from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.auth.deps import require_permission
from app.db import get_db
from app.models.product import Product as ProductModel

router = APIRouter()


class ProductOut(BaseModel):
    id: UUID
    name: str
    sku: str
    barcode: Optional[str] = None
    is_active: bool


class ProductListOut(BaseModel):
    items: List[ProductOut]
    total: int
    limit: int
    offset: int


def _to_product(product: ProductModel) -> ProductOut:
    return ProductOut(
        id=product.id,
        name=product.name,
        sku=product.sku,
        barcode=product.barcode,
        is_active=product.is_active,
    )


@router.get("", response_model=ProductListOut, summary="List Products")
@router.get("/", response_model=ProductListOut, summary="List Products")
async def list_products(
    q: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("products:read")),
):
    query = db.query(ProductModel)
    if q:
        term = f"%{q.strip()}%"
        query = query.filter(
            or_(
                ProductModel.name.ilike(term),
                ProductModel.sku.ilike(term),
                ProductModel.barcode.ilike(term),
            )
        )

    total = query.with_entities(func.count(ProductModel.id)).scalar() or 0
    items = query.order_by(ProductModel.created_at.desc()).offset(offset).limit(limit).all()

    return ProductListOut(
        items=[_to_product(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{product_id}", response_model=ProductOut, summary="Get Product")
async def get_product(
    product_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("products:read")),
):
    product = db.query(ProductModel).filter(ProductModel.id == product_id).one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return _to_product(product)
