from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import require_permission
from app.db import get_db
from app.models.product import Product as ProductModel
from app.models.product import ProductBarcode
from app.schemas.product import ProductCreateIn, ProductImportItem, ProductListOut, ProductOut

router = APIRouter()

class ProductImportFailure(BaseModel):
    row: int
    sku: Optional[str] = None
    reason: str


class ProductImportResult(BaseModel):
    inserted: int
    updated: int = 0
    failed: List[ProductImportFailure]


def _to_product(product: ProductModel) -> ProductOut:
    barcodes = [barcode.barcode for barcode in product.barcodes]
    return ProductOut(
        id=product.id,
        name=product.name,
        sku=product.sku,
        brand=product.brand,
        category=product.category,
        photo_url=product.photo_url,
        is_active=product.is_active,
        barcodes=barcodes,
        barcode=barcodes[0] if barcodes else None,
        created_at=product.created_at,
    )


@router.get("", response_model=ProductListOut, summary="List Products")
@router.get("/", response_model=ProductListOut, summary="List Products")
async def list_products(
    search: Optional[str] = Query(None, alias="search"),
    q: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("products:read")),
):
    query = db.query(ProductModel).options(selectinload(ProductModel.barcodes))
    term_value = (search or q or "").strip()
    if term_value:
        term = f"%{term_value}%"
        query = query.filter(
            or_(
                ProductModel.name.ilike(term),
                ProductModel.sku.ilike(term),
                ProductModel.barcodes.any(ProductBarcode.barcode.ilike(term)),
            )
        )

    total = (
        query.with_entities(func.count(ProductModel.id))
        .order_by(None)
        .scalar()
        or 0
    )
    items = (
        query.order_by(ProductModel.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

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
    product = (
        db.query(ProductModel)
        .options(selectinload(ProductModel.barcodes))
        .filter(ProductModel.id == product_id)
        .one_or_none()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return _to_product(product)


def _validate_barcodes(barcodes: List[str]) -> Optional[str]:
    seen = set()
    for barcode in barcodes:
        if barcode in seen:
            return "Duplicate barcode in payload"
        seen.add(barcode)
        if not barcode.isdigit() or not (8 <= len(barcode) <= 14):
            return "Barcode must be numeric string length 8-14"
    return None


def _status_to_active(status_value: str) -> bool:
    if status_value == "active":
        return True
    if status_value == "inactive":
        return False
    raise HTTPException(status_code=400, detail="Invalid status")


@router.post("", response_model=ProductOut, summary="Create Product", status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=ProductOut, summary="Create Product", status_code=status.HTTP_201_CREATED)
async def create_product(
    payload: ProductCreateIn,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("products:write")),
):
    if not payload.sku or not payload.sku.strip():
        raise HTTPException(status_code=400, detail="SKU is required")
    if not payload.name or not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")

    barcode_error = _validate_barcodes(payload.barcodes)
    if barcode_error:
        raise HTTPException(status_code=400, detail=barcode_error)

    existing = db.query(ProductModel).filter(ProductModel.sku == payload.sku).one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="SKU already exists")

    if payload.barcodes:
        existing_barcode = (
            db.query(ProductBarcode)
            .filter(ProductBarcode.barcode.in_(payload.barcodes))
            .first()
        )
        if existing_barcode:
            raise HTTPException(status_code=409, detail="Barcode already assigned")

    product = ProductModel(
        sku=payload.sku,
        name=payload.name,
        brand=payload.brand,
        category=payload.category,
        photo_url=payload.photo_url,
        is_active=_status_to_active(payload.status),
    )
    product.barcodes = [ProductBarcode(barcode=code) for code in payload.barcodes]

    try:
        db.add(product)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="SKU or barcode already exists")

    db.refresh(product)
    return _to_product(product)


@router.post("/import", response_model=ProductImportResult, summary="Import Products")
async def import_products(
    payload: List[ProductImportItem],
    db: Session = Depends(get_db),
    _user=Depends(require_permission("products:write")),
):
    inserted = 0
    failed: List[ProductImportFailure] = []

    for idx, item in enumerate(payload, start=1):
        if not item.sku or not item.sku.strip():
            failed.append(ProductImportFailure(row=idx, sku=item.sku, reason="SKU is required"))
            continue
        if not item.name or not item.name.strip():
            failed.append(ProductImportFailure(row=idx, sku=item.sku, reason="Name is required"))
            continue

        barcode_error = _validate_barcodes(item.barcodes)
        if barcode_error:
            failed.append(ProductImportFailure(row=idx, sku=item.sku, reason=barcode_error))
            continue

        existing = db.query(ProductModel.id).filter(ProductModel.sku == item.sku).first()
        if existing:
            failed.append(ProductImportFailure(row=idx, sku=item.sku, reason="SKU already exists"))
            continue

        if item.barcodes:
            existing_barcode = (
                db.query(ProductBarcode.barcode)
                .filter(ProductBarcode.barcode.in_(item.barcodes))
                .first()
            )
            if existing_barcode:
                failed.append(
                    ProductImportFailure(row=idx, sku=item.sku, reason="Barcode already assigned")
                )
                continue

        try:
            is_active = _status_to_active(item.status)
        except HTTPException:
            failed.append(
                ProductImportFailure(row=idx, sku=item.sku, reason="Invalid status")
            )
            continue

        try:
            with db.begin_nested():
                product = ProductModel(
                    sku=item.sku,
                    name=item.name,
                    brand=item.brand,
                    category=item.category,
                    is_active=is_active,
                )
                product.barcodes = [ProductBarcode(barcode=code) for code in item.barcodes]
                db.add(product)
            inserted += 1
        except IntegrityError:
            db.rollback()
            failed.append(
                ProductImportFailure(row=idx, sku=item.sku, reason="SKU or barcode already exists")
            )

    db.commit()

    return ProductImportResult(inserted=inserted, failed=failed)
