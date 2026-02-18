from datetime import datetime
from typing import Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Query, status
from pydantic import BaseModel
from sqlalchemy import case, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import require_permission
from app.db import get_db
from app.services.audit_service import ACTION_CREATE, get_client_ip, log_action
from app.integrations.smartup.products_sync import sync_smartup_products
from app.models.smartup_sync import SmartupSyncRun
from app.models.product import Product as ProductModel
from app.models.product import ProductBarcode
from app.models.receipt import Receipt as ReceiptModel
from app.models.receipt import ReceiptLine as ReceiptLineModel
from app.models.document import Document as DocumentModel
from app.models.order import Order as OrderModel
from app.models.location import Location as LocationModel
from app.models.user import User as UserModel
from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel
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
    errors_json: Optional[List[dict]] = None


class ProductHistoryReceiving(BaseModel):
    date: str  # ISO
    received_by: Optional[str] = None
    doc_no: str
    qty: float
    batch: str
    location_name: Optional[str] = None


class ProductHistoryPick(BaseModel):
    date: str  # ISO
    picked_by: Optional[str] = None
    order_number: Optional[str] = None
    document_doc_no: Optional[str] = None
    qty: float


class ProductHistoryResponse(BaseModel):
    receiving: List[ProductHistoryReceiving] = []
    picks: List[ProductHistoryPick] = []
    on_hand_total: Optional[float] = None
    available_total: Optional[float] = None


def _to_product(
    product: ProductModel,
    summary: Optional[Dict[UUID, dict]] = None,
) -> ProductOut:
    barcodes = [barcode.barcode for barcode in product.barcodes]
    brand_ref = getattr(product, "brand_ref", None)
    s = (summary or {}).get(product.id) or {}
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
        on_hand_total=float(s["on_hand_total"]) if s.get("on_hand_total") is not None else None,
        available_total=float(s["available_total"]) if s.get("available_total") is not None else None,
    )


def _fetch_inventory_summary(db: Session, product_ids: List[UUID]) -> Dict[UUID, dict]:
    """Single aggregate query for on_hand/available per product. No N+1."""
    if not product_ids:
        return {}
    on_hand_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(("allocate", "unallocate")), 0),
            else_=StockMovementModel.qty_change,
        )
    )
    reserved_expr = func.sum(
        case(
            (
                StockMovementModel.movement_type.in_(("allocate", "unallocate")),
                StockMovementModel.qty_change,
            ),
            else_=0,
        )
    )
    rows = (
        db.query(
            StockLotModel.product_id,
            on_hand_expr.label("on_hand_total"),
            (on_hand_expr - reserved_expr).label("available_total"),
        )
        .join(StockMovementModel, StockMovementModel.lot_id == StockLotModel.id)
        .filter(StockLotModel.product_id.in_(product_ids))
        .group_by(StockLotModel.product_id)
        .all()
    )
    result = {}
    for r in rows:
        oh = r.on_hand_total
        av = r.available_total
        result[r.product_id] = {
            "on_hand_total": float(oh) if oh is not None else 0,
            "available_total": float(av) if av is not None else 0,
        }
    return result


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
    run_type: Optional[str] = Query(None, description="Filter: products, orders, full"),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("products:write")),
):
    query = db.query(SmartupSyncRun).order_by(SmartupSyncRun.started_at.desc()).limit(20)
    if run_type:
        query = query.filter(SmartupSyncRun.run_type == run_type)
    runs = query.all()
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
            errors_json=run.errors_json or [],
        )
        for run in runs
    ]


@router.get("", response_model=ProductListOut, summary="List Products")
@router.get("/", response_model=ProductListOut, summary="List Products")
async def list_products(
    search: Optional[str] = Query(None, alias="search"),
    q: Optional[str] = None,
    product_ids: Optional[str] = Query(None, description="Comma-separated product UUIDs to filter"),
    include_inactive: bool = Query(False),
    include_summary: bool = Query(False, description="Include on_hand_total, available_total per product"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("products:read")),
):
    query = db.query(ProductModel).options(selectinload(ProductModel.barcodes))
    if not include_inactive:
        query = query.filter(ProductModel.is_active.is_(True))
    ids_value = (product_ids or "").strip()
    if ids_value:
        ids = [UUID(x.strip()) for x in ids_value.split(",") if x.strip()]
        if ids:
            query = query.filter(ProductModel.id.in_(ids))
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

    summary: Dict[UUID, dict] = {}
    if include_summary and items:
        product_ids = [item.id for item in items]
        summary = _fetch_inventory_summary(db, product_ids)

    return ProductListOut(
        items=[_to_product(item, summary) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


def _get_product_by_barcode(db: Session, barcode: str) -> Optional[ProductModel]:
    barcode = (barcode or "").strip()
    if not barcode:
        return None
    return (
        db.query(ProductModel)
        .options(selectinload(ProductModel.barcodes))
        .filter(
            ProductModel.is_active.is_(True),
            (
                (ProductModel.barcode == barcode)
                | ProductModel.id.in_(
                    db.query(ProductBarcode.product_id).filter(ProductBarcode.barcode == barcode)
                )
            ),
        )
        .first()
    )


@router.get(
    "/by-barcode/{barcode}",
    response_model=ProductOut,
    summary="Get product by barcode (for scanner/mobile)",
)
async def get_product_by_barcode(
    barcode: str,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("products:read")),
):
    product = _get_product_by_barcode(db, barcode)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    summary = _fetch_inventory_summary(db, [product.id])
    return _to_product(product, summary)


@router.get(
    "/{product_id}/history",
    response_model=ProductHistoryResponse,
    summary="Get product history (receiving and picks)",
)
async def get_product_history(
    product_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("products:read")),
):
    product = (
        db.query(ProductModel)
        .filter(ProductModel.id == product_id)
        .one_or_none()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    receiving: List[ProductHistoryReceiving] = []
    receipt_lines = (
        db.query(ReceiptLineModel)
        .options(
            selectinload(ReceiptLineModel.receipt),
            selectinload(ReceiptLineModel.location),
        )
        .filter(
            ReceiptLineModel.product_id == product_id,
            ReceiptLineModel.receipt.has(ReceiptModel.status == "completed"),
        )
        .order_by(ReceiptLineModel.receipt_id)
        .all()
    )
    creator_ids = {line.receipt.created_by for line in receipt_lines if line.receipt and line.receipt.created_by}
    users_by_id: Dict[UUID, UserModel] = {}
    if creator_ids:
        for u in db.query(UserModel).filter(UserModel.id.in_(creator_ids)).all():
            users_by_id[u.id] = u
    for line in receipt_lines:
        rec = line.receipt
        creator = users_by_id.get(rec.created_by) if rec and rec.created_by else None
        received_by = (creator.full_name or creator.username) if creator else None
        loc = line.location
        location_name = loc.name if loc else None
        receiving.append(
            ProductHistoryReceiving(
                date=rec.created_at.isoformat() if rec and rec.created_at else "",
                received_by=received_by,
                doc_no=rec.doc_no if rec else "",
                qty=float(line.qty),
                batch=line.batch or "",
                location_name=location_name,
            )
        )

    picks: List[ProductHistoryPick] = []
    movements = (
        db.query(StockMovementModel)
        .filter(
            StockMovementModel.product_id == product_id,
            StockMovementModel.movement_type == "pick",
            StockMovementModel.source_document_type == "document",
        )
        .order_by(StockMovementModel.created_at.desc())
        .all()
    )
    picker_ids = {m.created_by_user_id for m in movements if m.created_by_user_id}
    pickers_by_id: Dict[UUID, UserModel] = {}
    if picker_ids:
        for u in db.query(UserModel).filter(UserModel.id.in_(picker_ids)).all():
            pickers_by_id[u.id] = u
    doc_ids = {m.source_document_id for m in movements if m.source_document_id}
    docs_by_id: Dict[UUID, DocumentModel] = {}
    if doc_ids:
        for d in db.query(DocumentModel).filter(DocumentModel.id.in_(doc_ids)).all():
            docs_by_id[d.id] = d
    order_ids = {d.order_id for d in docs_by_id.values() if d.order_id}
    orders_by_id: Dict[UUID, OrderModel] = {}
    if order_ids:
        for o in db.query(OrderModel).filter(OrderModel.id.in_(order_ids)).all():
            orders_by_id[o.id] = o
    for mov in movements:
        doc = docs_by_id.get(mov.source_document_id) if mov.source_document_id else None
        order_number = None
        document_doc_no = doc.doc_no if doc else None
        if doc and doc.order_id:
            order = orders_by_id.get(doc.order_id)
            if order:
                order_number = order.order_number
        creator = pickers_by_id.get(mov.created_by_user_id) if mov.created_by_user_id else None
        picked_by = (creator.full_name or creator.username) if creator else None
        qty = abs(float(mov.qty_change))
        picks.append(
            ProductHistoryPick(
                date=mov.created_at.isoformat() if mov.created_at else "",
                picked_by=picked_by,
                order_number=order_number,
                document_doc_no=document_doc_no,
                qty=qty,
            )
        )

    summary = _fetch_inventory_summary(db, [product_id])
    s = summary.get(product_id) or {}
    return ProductHistoryResponse(
        receiving=receiving,
        picks=picks,
        on_hand_total=s.get("on_hand_total"),
        available_total=s.get("available_total"),
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
    request: Request,
    payload: ProductCreateIn,
    db: Session = Depends(get_db),
    user=Depends(require_permission("products:write")),
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
        log_action(
            db,
            user_id=user.id,
            action=ACTION_CREATE,
            entity_type="product",
            entity_id=str(product.id),
            new_data={"sku": product.sku, "name": product.name, "brand": product.brand, "is_active": product.is_active},
            ip_address=get_client_ip(request),
        )
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
