from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import require_permission
from app.db import get_db
from app.integrations.smartup.products_sync import sync_smartup_products
from app.models.smartup_sync import SmartupSyncRun
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


class SmartupProductsSyncRequest(BaseModel):
    code: Optional[str] = None
    begin_created_on: Optional[str] = None
    end_created_on: Optional[str] = None
    begin_modified_on: Optional[str] = None
    end_modified_on: Optional[str] = None


class SmartupProductsSyncResponse(BaseModel):
    run_id: str
    inserted: int
    updated: int
    skipped: int
    errors_count: int
    status: str


class SmartupSyncRunOut(BaseModel):
    id: str
    run_type: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    inserted_count: int
    updated_count: int
    skipped_count: int
    error_count: int
    status: str


def _to_product(product: ProductModel) -> ProductOut:
    barcodes = [barcode.barcode for barcode in product.barcodes]
    brand_ref = getattr(product, "brand_ref", None)
    return ProductOut(
        id=product.id,
        name=product.name,
        sku=product.sku,
        brand=product.brand,
        brand_id=product.brand_id,
        brand_name=brand_ref.name if brand_ref else None,
        brand_display_name=brand_ref.display_name if brand_ref else None,
        category=product.category,
        photo_url=product.photo_url,
        is_active=product.is_active,
        barcodes=barcodes,
        barcode=barcodes[0] if barcodes else None,
        created_at=product.created_at,
    )


@router.post(
    "/sync-smartup",
    response_model=SmartupProductsSyncResponse,
    summary="Sync products from Smartup",
)
async def sync_products_from_smartup(
    payload: SmartupProductsSyncRequest,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("products:write")),
):
    run, inserted, updated, skipped, errors = sync_smartup_products(
        db,
        code=payload.code,
        begin_created_on=payload.begin_created_on,
        end_created_on=payload.end_created_on,
        begin_modified_on=payload.begin_modified_on,
        end_modified_on=payload.end_modified_on,
    )
    return SmartupProductsSyncResponse(
        run_id=str(run.id),
        inserted=inserted,
        updated=updated,
        skipped=skipped,
        errors_count=len(errors),
        status=run.status,
    )


@router.get(
    "/sync-smartup/runs",
    response_model=List[SmartupSyncRunOut],
    summary="List Smartup sync runs",
)
async def list_smartup_sync_runs(
    db: Session = Depends(get_db),
    _user=Depends(require_permission("products:write")),
):
    runs = (
        db.query(SmartupSyncRun)
        .filter(SmartupSyncRun.run_type == "products")
        .order_by(SmartupSyncRun.started_at.desc())
        .limit(20)
        .all()
    )
    return [
        SmartupSyncRunOut(
            id=str(run.id),
            run_type=run.run_type,
            started_at=run.started_at,
            finished_at=run.finished_at,
            inserted_count=run.inserted_count,
            updated_count=run.updated_count,
            skipped_count=run.skipped_count,
            error_count=run.error_count,
            status=run.status,
        )
        for run in runs
    ]


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
        external_source="manual",
        external_id=payload.sku,
        smartup_code=payload.sku,
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
                    external_source="manual",
                    external_id=item.sku,
                    smartup_code=item.sku,
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
