from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Literal, Optional
from uuid import UUID

import logging

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

logger = logging.getLogger(__name__)

from app.auth.deps import get_current_user, require_permission
from app.db import get_db
from app.models.document import Document as DocumentModel
from app.models.document import DocumentLine as DocumentLineModel
from app.models.location import Location as LocationModel
from app.models.order import Order as OrderModel
from app.models.order import OrderWmsState as OrderWmsStateModel
from app.models.picking import PickRequest
from app.models.stock import StockMovement as StockMovementModel
from app.models.product import Product as ProductModel
from app.models.user import User as UserModel
from app.models.user_fcm_token import UserFCMToken

router = APIRouter()


class PickingLine(BaseModel):
    id: UUID
    product_name: str
    sku: Optional[str] = None
    barcode: Optional[str] = None
    location_code: str
    batch: Optional[str] = None
    expiry_date: Optional[str] = None
    qty_required: float
    qty_picked: float
    skip_reason: Optional[str] = None


class PickingProgress(BaseModel):
    picked: float
    required: float


class PickingDocument(BaseModel):
    id: UUID
    reference_number: str
    status: str
    lines: List[PickingLine]
    progress: PickingProgress
    incomplete_reason: Optional[str] = None
    assigned_to_user_id: Optional[UUID] = None
    assigned_to_user_name: Optional[str] = None
    order_number: Optional[str] = None


class PickingListItem(BaseModel):
    id: UUID
    reference_number: str
    status: str
    lines_total: int
    lines_done: int
    controlled_by_user_id: Optional[UUID] = None
    assigned_to_user_id: Optional[UUID] = None
    assigned_to_user_name: Optional[str] = None
    order_number: Optional[str] = None


class ConsolidatedLineItem(BaseModel):
    """Per-document line inside a product group (bu mahsulot bu buyurtma)."""
    document_id: UUID
    line_id: UUID
    reference_number: str
    qty_required: float
    qty_picked: float
    location_code: str
    pick_sequence: Optional[int] = None
    expiry_date: Optional[str] = None


class ConsolidatedProduct(BaseModel):
    """Product group: total required/picked + per-document lines."""
    barcode: Optional[str] = None
    sku: Optional[str] = None
    product_name: str
    total_required: float
    total_picked: float
    expiry_date: Optional[str] = None  # representative (e.g. first line's) for display
    lines: List[ConsolidatedLineItem]


class ConsolidatedDocumentSummary(BaseModel):
    id: UUID
    reference_number: str
    status: str
    lines_total: int
    lines_done: int


class ConsolidatedViewResponse(BaseModel):
    documents: List[ConsolidatedDocumentSummary]
    products: List[ConsolidatedProduct]


class ConsolidatedPickRequest(BaseModel):
    barcode: str
    qty: float
    request_id: str

    @field_validator("qty", mode="before")
    @classmethod
    def coerce_qty(cls, v):  # noqa: ANN001
        """Ilovadan string yoki raqam kelishi mumkin; 500 oldini olish."""
        if v is None:
            raise ValueError("qty required")
        try:
            n = float(v) if not isinstance(v, (int, float)) else float(v)
        except (TypeError, ValueError):
            raise ValueError("qty must be a number")
        if n <= 0:
            raise ValueError("qty must be positive")
        return n


class PickLineRequest(BaseModel):
    delta: int
    request_id: str

    @field_validator("delta")
    @classmethod
    def delta_nonzero_bounded(cls, v: int) -> int:
        if v == 0:
            raise ValueError("delta must not be zero")
        if v < -10000 or v > 10000:
            raise ValueError("delta must be between -10000 and 10000")
        return v


class PickLineResponse(BaseModel):
    line: PickingLine
    progress: PickingProgress
    document_status: str


class ControllerUser(BaseModel):
    id: UUID
    username: str
    full_name: Optional[str] = None


class PickerUser(BaseModel):
    id: UUID
    username: str
    full_name: Optional[str] = None


class SendToControllerRequest(BaseModel):
    controller_user_id: UUID


class FCMTokenRequest(BaseModel):
    token: str
    device_id: Optional[str] = None


INCOMPLETE_REASON_CODES = (
    "expired",
    "out_of_stock",
    "product_not_found",
    "not_enough_time",
    "damaged",
    "wrong_location",
    "other",
)


class CompletePickingRequest(BaseModel):
    incomplete_reason: Optional[str] = None

    class Config:
        json_schema_extra = {
            "example": {"incomplete_reason": "out_of_stock"},
        }


class MyPickerStatsDay(BaseModel):
    date: str  # YYYY-MM-DD
    count: int


class MyPickerStatsResponse(BaseModel):
    total_completed: int
    completed_today: int
    by_day: List[MyPickerStatsDay]


def _calculate_progress(lines: List[DocumentLineModel]) -> PickingProgress:
    required = sum(float(line.required_qty) if line.required_qty is not None else 0 for line in lines)
    picked = sum(float(line.picked_qty) if line.picked_qty is not None else 0 for line in lines)
    return PickingProgress(picked=picked, required=required)


def _safe_expiry_date(expiry_date) -> Optional[str]:
    if expiry_date is None:
        return None
    if hasattr(expiry_date, "isoformat"):
        return expiry_date.isoformat()
    return str(expiry_date) if expiry_date else None


def _to_picking_line(line: DocumentLineModel) -> PickingLine:
    return PickingLine(
        id=line.id,
        product_name=line.product_name or "",
        sku=line.sku,
        barcode=line.barcode,
        location_code=line.location_code or "",
        batch=line.batch,
        expiry_date=_safe_expiry_date(getattr(line, "expiry_date", None)),
        qty_required=float(line.required_qty) if line.required_qty is not None else 0,
        qty_picked=float(line.picked_qty) if line.picked_qty is not None else 0,
        skip_reason=getattr(line, "skip_reason", None),
    )


def _picker_name(doc: DocumentModel) -> Optional[str]:
    user = getattr(doc, "assigned_to_user", None)
    if user is None:
        return None
    return getattr(user, "full_name", None) or getattr(user, "username", None)


def _to_picking_document(doc: DocumentModel) -> PickingDocument:
    lines = getattr(doc, "lines", None) or []
    return PickingDocument(
        id=doc.id,
        reference_number=doc.doc_no,
        status=doc.status,
        lines=[_to_picking_line(line) for line in lines],
        progress=_calculate_progress(lines),
        incomplete_reason=getattr(doc, "incomplete_reason", None),
        assigned_to_user_id=doc.assigned_to_user_id,
        assigned_to_user_name=_picker_name(doc),
        order_number=_order_number(doc),
    )


def _to_picking_document_with_lines(doc: DocumentModel, lines: List[DocumentLineModel]) -> PickingDocument:
    """Commit dan keyin javob qaytarish uchun — doc.lines expired bo‘lishi mumkin."""
    return PickingDocument(
        id=doc.id,
        reference_number=doc.doc_no,
        status=doc.status,
        lines=[_to_picking_line(line) for line in lines],
        progress=_calculate_progress(lines),
        incomplete_reason=getattr(doc, "incomplete_reason", None),
        assigned_to_user_id=doc.assigned_to_user_id,
        assigned_to_user_name=_picker_name(doc),
        order_number=_order_number(doc),
    )


def _order_number(doc: DocumentModel) -> Optional[str]:
    order = getattr(doc, "order", None)
    return order.order_number if order else None


def _to_picking_list_item(doc: DocumentModel) -> PickingListItem:
    lines_total = len(doc.lines)
    lines_done = sum(1 for line in doc.lines if line.picked_qty >= line.required_qty)
    return PickingListItem(
        id=doc.id,
        reference_number=doc.doc_no,
        status=doc.status,
        lines_total=lines_total,
        lines_done=lines_done,
        controlled_by_user_id=doc.controlled_by_user_id,
        assigned_to_user_id=doc.assigned_to_user_id,
        assigned_to_user_name=_picker_name(doc),
        order_number=_order_number(doc),
    )


def _refresh_document_status(doc: DocumentModel, lines: List[DocumentLineModel]) -> None:
    if all(line.picked_qty >= line.required_qty for line in lines):
        doc.status = "in_progress"
    elif any(line.picked_qty > 0 for line in lines):
        doc.status = "in_progress"


@router.get("/documents/{document_id}", response_model=PickingDocument, summary="Picking document")
async def get_picking_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:read")),
):
    document = (
        db.query(DocumentModel)
        .options(
            selectinload(DocumentModel.assigned_to_user),
            selectinload(DocumentModel.order),
        )
        .filter(DocumentModel.id == document_id)
        .one_or_none()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if user.role == "picker" and document.assigned_to_user_id != user.id:
        raise HTTPException(status_code=404, detail="Document not found")
    if user.role == "inventory_controller" and document.controlled_by_user_id != user.id:
        raise HTTPException(status_code=404, detail="Document not found")
    # Joylashuv bo‘yicha terish tartibi (admin panel Locations — pick_sequence)
    lines = (
        db.query(DocumentLineModel)
        .outerjoin(LocationModel, DocumentLineModel.location_id == LocationModel.id)
        .filter(DocumentLineModel.document_id == document_id)
        .order_by(
            DocumentLineModel.expiry_date.asc().nulls_last(),
            LocationModel.pick_sequence.asc().nulls_last(),
            LocationModel.code.asc().nulls_last(),
            DocumentLineModel.id,
        )
        .all()
    )
    return _to_picking_document_with_lines(document, lines)


@router.get("/documents", response_model=List[PickingListItem], summary="Picking documents")
@router.get("/documents/", response_model=List[PickingListItem], summary="Picking documents")
async def list_picking_documents(
    limit: int = 50,
    offset: int = 0,
    include_cancelled: bool = False,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:read")),
):
    # Admin buyurtmani packed/shipped/cancelled qilsa — yig'uvchi va controller ro'yxatida ko'rinmasin
    ORDER_HIDDEN_STATUSES = ("completed", "packed", "shipped", "cancelled")
    query = (
        db.query(DocumentModel)
        .options(
            selectinload(DocumentModel.lines),
            selectinload(DocumentModel.assigned_to_user),
            selectinload(DocumentModel.order).selectinload(OrderModel.wms_state),
        )
        .outerjoin(OrderModel, DocumentModel.order_id == OrderModel.id)
        .outerjoin(OrderWmsStateModel, OrderModel.id == OrderWmsStateModel.order_id)
        .filter(
            or_(
                OrderModel.id.is_(None),
                OrderWmsStateModel.status.notin_(ORDER_HIDDEN_STATUSES),
            )
        )
    )
    if user.role == "picker":
        query = query.filter(DocumentModel.assigned_to_user_id == user.id)
        # Controllerga yuborilgan (picked + controlled_by) yig'uvchi ro'yxatida ko'rinmasin
        query = query.filter(
            or_(
                DocumentModel.status != "picked",
                DocumentModel.controlled_by_user_id.is_(None),
            )
        )
        # Controller tekshirib yakunlagan hujjatlar yig'uvchi ro'yxatida ko'rinmasin
        query = query.filter(DocumentModel.status != "completed")
    elif user.role == "inventory_controller":
        query = query.filter(
            DocumentModel.controlled_by_user_id == user.id,
            DocumentModel.status == "picked",
        )
    if not include_cancelled:
        query = query.filter(DocumentModel.status != "cancelled")
    docs = query.order_by(DocumentModel.created_at.desc()).offset(offset).limit(limit).all()
    return [_to_picking_list_item(doc) for doc in docs]


@router.get(
    "/consolidated",
    response_model=ConsolidatedViewResponse,
    summary="Consolidated pick view (all assigned docs by product)",
)
async def get_consolidated(
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:read")),
):
    if user.role != "picker":
        raise HTTPException(status_code=403, detail="Only for picker")
    ORDER_HIDDEN_STATUSES = ("completed", "packed", "shipped", "cancelled")
    # Exclude from consolidated view when picked AND sent to controller (controlled_by set).
    # Also exclude completed (controller tugatgan); matches Buyurtmalar ro'yxati.
    docs_id_query = (
        db.query(DocumentModel.id)
        .outerjoin(OrderModel, DocumentModel.order_id == OrderModel.id)
        .outerjoin(OrderWmsStateModel, OrderModel.id == OrderWmsStateModel.order_id)
        .filter(
            DocumentModel.assigned_to_user_id == user.id,
            or_(
                OrderModel.id.is_(None),
                OrderWmsStateModel.status.notin_(ORDER_HIDDEN_STATUSES),
            ),
            or_(
                DocumentModel.status != "picked",
                DocumentModel.controlled_by_user_id.is_(None),
            ),
            DocumentModel.status != "cancelled",
            DocumentModel.status != "completed",
        )
    )
    doc_ids_raw = [r[0] for r in docs_id_query.all()]
    doc_ids = list(dict.fromkeys(doc_ids_raw))  # uniq, order preserved
    if not doc_ids:
        return ConsolidatedViewResponse(documents=[], products=[])
    try:
        return _build_consolidated_response(db, doc_ids)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("get_consolidated error: %s", e)
        raise HTTPException(
            status_code=500,
            detail="Umumiy yig'ish ro'yxati yuklanmadi: " + (str(e).strip() or type(e).__name__),
        ) from e


def _build_consolidated_response(db: Session, doc_ids: list) -> ConsolidatedViewResponse:
    """Build consolidated view response (shared by GET and after POST). doc_ids must be non-empty."""
    # Fresh query for doc_no/status to avoid touching expired attributes after consolidated_pick commit (500 fix)
    doc_info_rows = (
        db.query(DocumentModel.id, DocumentModel.doc_no, DocumentModel.status)
        .filter(DocumentModel.id.in_(doc_ids))
        .all()
    )
    doc_info_map = {r[0]: {"doc_no": str(r[1]) if r[1] is not None else "", "status": str(r[2]) if r[2] is not None else ""} for r in doc_info_rows}
    # Ensure every doc_id has an entry (in case of race)
    for doc_id in doc_ids:
        if doc_id not in doc_info_map:
            doc_info_map[doc_id] = {"doc_no": "", "status": ""}

    lines_with_loc = (
        db.query(DocumentLineModel, LocationModel)
        .outerjoin(LocationModel, DocumentLineModel.location_id == LocationModel.id)
        .filter(DocumentLineModel.document_id.in_(doc_ids))
        .order_by(
            DocumentLineModel.expiry_date.asc().nulls_last(),
            LocationModel.pick_sequence.asc().nulls_last(),
            LocationModel.code.asc().nulls_last(),
            DocumentLineModel.id,
        )
        .all()
    )
    # Group by product key (barcode or sku+product_name); preserve order of first occurrence
    # Also build per-document line counts from lines_with_loc to avoid touching d.lines after commit (500 fix)
    product_order: List[tuple] = []  # (barcode_or_key, product_name, sku, expiry_display)
    groups: dict = {}
    first_line_attrs: dict = {}  # key -> (barcode, sku, product_id) from first line in group
    doc_line_stats: dict = {}  # doc_id -> {"total": int, "done": int}
    for line, loc in lines_with_loc:
        doc_id = line.document_id
        doc_line_stats.setdefault(doc_id, {"total": 0, "done": 0})
        doc_line_stats[doc_id]["total"] += 1
        if (line.picked_qty or 0) >= (line.required_qty or 0):
            doc_line_stats[doc_id]["done"] += 1
        key = (line.barcode or line.sku or str(line.product_id or ""), line.product_name or "", line.sku)
        if key not in groups:
            groups[key] = []
            first_line_attrs[key] = (line.barcode, line.sku, line.product_id)
            product_order.append((key, line.product_name or "", line.sku, _safe_expiry_date(line.expiry_date)))
        ref = doc_info_map.get(line.document_id, {}).get("doc_no", "")
        pick_seq = loc.pick_sequence if loc else None
        try:
            pick_seq_int = int(pick_seq) if pick_seq is not None else None
        except (TypeError, ValueError):
            pick_seq_int = None
        groups[key].append(
            ConsolidatedLineItem(
                document_id=line.document_id,
                line_id=line.id,
                reference_number=ref or "",
                qty_required=float(line.required_qty or 0),
                qty_picked=float(line.picked_qty or 0),
                location_code=line.location_code or "",
                pick_sequence=pick_seq_int,
                expiry_date=_safe_expiry_date(line.expiry_date),
            )
        )
    # Fallback barcode from Product when document_line has none
    need_barcode_ids = []
    for k in first_line_attrs:
        b, _s, pid = first_line_attrs[k]
        if pid and (not b or not str(b).strip()):
            need_barcode_ids.append(pid)
    need_barcode_ids = list(set(need_barcode_ids))
    product_barcode_map: dict = {}
    if need_barcode_ids:
        for row in db.query(ProductModel.id, ProductModel.barcode).filter(ProductModel.id.in_(need_barcode_ids)).all():
            if row.barcode and str(row.barcode).strip():
                product_barcode_map[row.id] = row.barcode
    products = []
    for (barcode_or_sku, product_name, sku), _name, _sku, expiry_display in product_order:
        key = (barcode_or_sku, product_name, sku)
        lines_list = groups[key]
        total_required = sum(l.qty_required for l in lines_list)
        total_picked = sum(l.qty_picked for l in lines_list)
        first_barcode, first_sku, first_product_id = first_line_attrs.get(key, (None, None, None))
        barcode = (
            first_barcode if (first_barcode and str(first_barcode).strip()) else
            (product_barcode_map.get(first_product_id) if first_product_id else None)
        )
        products.append(
            ConsolidatedProduct(
                barcode=barcode if (barcode and str(barcode).strip()) else None,
                sku=first_sku if (first_sku and str(first_sku).strip()) else sku,
                product_name=product_name or "",
                total_required=total_required,
                total_picked=total_picked,
                expiry_date=expiry_display,
                lines=lines_list,
            )
        )
    # doc_ids orqali yig'amiz — document ORM obyektlariga tayanmaslik (commit dan keyin 500 oldini olish)
    doc_summaries = []
    for doc_id in doc_ids:
        info = doc_info_map.get(doc_id, {})
        stats = doc_line_stats.get(doc_id, {})
        doc_summaries.append(
            ConsolidatedDocumentSummary(
                id=doc_id,
                reference_number=info.get("doc_no") or "",
                status=info.get("status") or "",
                lines_total=stats.get("total", 0) or 0,
                lines_done=stats.get("done", 0) or 0,
            )
        )
    return ConsolidatedViewResponse(documents=doc_summaries, products=products)


@router.post(
    "/consolidated/pick",
    response_model=ConsolidatedViewResponse,
    summary="Consolidated pick by barcode + qty (idempotent by request_id)",
)
async def consolidated_pick(
    payload: ConsolidatedPickRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:pick")),
):
    if user.role != "picker":
        raise HTTPException(status_code=403, detail="Only for picker")
    barcode = (payload.barcode or "").strip()
    if not barcode:
        raise HTTPException(status_code=400, detail="barcode required")
    qty = payload.qty
    if qty is None or qty <= 0:
        raise HTTPException(status_code=400, detail="qty must be positive")

    # Idempotency: if we already processed this request_id, return current view
    existing = db.query(PickRequest).filter(PickRequest.request_id == payload.request_id).one_or_none()
    if existing:
        return await get_consolidated(db=db, user=user)

    ORDER_HIDDEN_STATUSES = ("completed", "packed", "shipped", "cancelled")
    # Same as get_consolidated: exclude picked+controlled and completed.
    docs_query = (
        db.query(DocumentModel.id)
        .outerjoin(OrderModel, DocumentModel.order_id == OrderModel.id)
        .outerjoin(OrderWmsStateModel, OrderModel.id == OrderWmsStateModel.order_id)
        .filter(
            DocumentModel.assigned_to_user_id == user.id,
            or_(
                OrderModel.id.is_(None),
                OrderWmsStateModel.status.notin_(ORDER_HIDDEN_STATUSES),
            ),
            or_(
                DocumentModel.status != "picked",
                DocumentModel.controlled_by_user_id.is_(None),
            ),
            DocumentModel.status != "cancelled",
            DocumentModel.status != "completed",
        )
    )
    doc_ids = [r[0] for r in docs_query.all()]
    if not doc_ids:
        raise HTTPException(status_code=404, detail="Mahsulot topilmadi yoki sizning vazifangizda yo'q")
    # Lines matching barcode (or sku), same sort order as consolidated view.
    # Two-step to avoid PostgreSQL "FOR UPDATE cannot be applied to the nullable side of an outer join":
    # 1) get ordered line IDs (join, no lock); 2) lock only document_lines by those IDs.
    ordered_ids_query = (
        db.query(DocumentLineModel.id)
        .outerjoin(LocationModel, DocumentLineModel.location_id == LocationModel.id)
        .filter(
            DocumentLineModel.document_id.in_(doc_ids),
            or_(
                DocumentLineModel.barcode == barcode,
                DocumentLineModel.sku == barcode,
            ),
        )
        .order_by(
            DocumentLineModel.expiry_date.asc().nulls_last(),
            LocationModel.pick_sequence.asc().nulls_last(),
            LocationModel.code.asc().nulls_last(),
            DocumentLineModel.id,
        )
    )
    ordered_ids = [r[0] for r in ordered_ids_query.all()]
    if not ordered_ids:
        raise HTTPException(status_code=404, detail="Mahsulot topilmadi yoki sizning vazifangizda yo'q")
    lines_locked = (
        db.query(DocumentLineModel)
        .filter(DocumentLineModel.id.in_(ordered_ids))
        .with_for_update()
        .all()
    )
    order_map = {lid: i for i, lid in enumerate(ordered_ids)}
    lines = sorted(lines_locked, key=lambda L: order_map[L.id])

    remaining = Decimal(str(qty))
    first_picked_line_id: Optional[UUID] = None
    docs_to_refresh = set()
    try:
        for line in lines:
            if remaining <= 0:
                break
            need = min(remaining, Decimal(str(line.required_qty or 0)) - Decimal(str(line.picked_qty or 0)))
            if need <= 0:
                continue
            if not line.product_id or not line.lot_id or not line.location_id:
                raise HTTPException(
                    status_code=409,
                    detail="Pick line missing allocation details (product/lot/location). Allocate the order first.",
                )
            loc = db.query(LocationModel).filter(LocationModel.id == line.location_id).one_or_none()
            if not loc or loc.zone_type != "NORMAL":
                raise HTTPException(
                    status_code=400,
                    detail="Pick only from NORMAL zone. Line location is not NORMAL.",
                )
            line.picked_qty = float(Decimal(str(line.picked_qty or 0)) + need)
            docs_to_refresh.add(line.document_id)
            db.add(
                StockMovementModel(
                    product_id=line.product_id,
                    lot_id=line.lot_id,
                    location_id=line.location_id,
                    qty_change=-need,
                    movement_type="pick",
                    source_document_type="document",
                    source_document_id=line.document_id,
                    created_by_user_id=user.id,
                )
            )
            db.add(
                StockMovementModel(
                    product_id=line.product_id,
                    lot_id=line.lot_id,
                    location_id=line.location_id,
                    qty_change=-need,
                    movement_type="unallocate",
                    source_document_type="document",
                    source_document_id=line.document_id,
                    created_by_user_id=user.id,
                )
            )
            if first_picked_line_id is None:
                first_picked_line_id = line.id
            remaining -= need

        for doc_id in docs_to_refresh:
            document = (
                db.query(DocumentModel)
                .options(selectinload(DocumentModel.lines))
                .filter(DocumentModel.id == doc_id)
                .with_for_update()
                .one_or_none()
            )
            if document:
                _refresh_document_status(document, document.lines)
                if document.order_id:
                    order = (
                        db.query(OrderModel)
                        .options(selectinload(OrderModel.wms_state))
                        .filter(OrderModel.id == document.order_id)
                        .with_for_update()
                        .one_or_none()
                    )
                    if order and order.wms_state and order.wms_state.status in {"allocated", "ready_for_picking"}:
                        order.wms_state.status = "picking"
        if first_picked_line_id is not None:
            db.add(PickRequest(request_id=payload.request_id, line_id=first_picked_line_id))
        db.commit()
        try:
            return await get_consolidated(db=db, user=user)
        except Exception as e:
            logger.exception("get_consolidated after consolidated_pick: %s", e)
            raise HTTPException(
                status_code=500,
                detail="Yig'ish saqlandi, lekin yangi ro'yxat yuklanmadi. " + (str(e).strip() or type(e).__name__),
            ) from e
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("consolidated_pick error: %s", e)
        raise HTTPException(
            status_code=400,
            detail=f"Terish saqlanmadi. Sabab: {str(e).strip() or type(e).__name__}",
        ) from e


@router.get("/controllers", response_model=List[ControllerUser], summary="List controllers (inventory_controller)")
@router.get("/controllers/", response_model=List[ControllerUser], summary="List controllers")
async def list_controllers(
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:read")),
):
    controllers = (
        db.query(UserModel)
        .filter(UserModel.role == "inventory_controller", UserModel.is_active.is_(True))
        .order_by(UserModel.full_name, UserModel.username)
        .all()
    )
    return [
        ControllerUser(id=u.id, username=u.username, full_name=u.full_name)
        for u in controllers
    ]


@router.get("/pickers", response_model=List[PickerUser], summary="List pickers (for assign return / send to picker)")
@router.get("/pickers/", response_model=List[PickerUser], summary="List pickers")
async def list_pickers(
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:read")),
):
    pickers = (
        db.query(UserModel)
        .filter(UserModel.role == "picker", UserModel.is_active.is_(True))
        .order_by(UserModel.full_name, UserModel.username)
        .all()
    )
    return [
        PickerUser(id=u.id, username=u.username, full_name=u.full_name)
        for u in pickers
    ]


@router.get("/my-stats", response_model=MyPickerStatsResponse, summary="My completed pick documents (for dashboard)")
@router.get("/my-stats/", response_model=MyPickerStatsResponse, summary="My completed pick documents")
async def get_my_picker_stats(
    days: int = 7,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:read")),
):
    today = datetime.now(timezone.utc).date()
    total_completed = (
        db.query(func.count(DocumentModel.id))
        .filter(
            DocumentModel.doc_type == "SO",
            DocumentModel.status == "completed",
            (DocumentModel.assigned_to_user_id == user.id) | (DocumentModel.controlled_by_user_id == user.id),
        )
        .scalar()
        or 0
    )
    completed_today = (
        db.query(func.count(DocumentModel.id))
        .filter(
            DocumentModel.doc_type == "SO",
            DocumentModel.status == "completed",
            (DocumentModel.assigned_to_user_id == user.id) | (DocumentModel.controlled_by_user_id == user.id),
            func.date(DocumentModel.updated_at) == today,
        )
        .scalar()
        or 0
    )
    days = max(1, min(31, days))
    start_date = today - timedelta(days=days - 1)
    rows = (
        db.query(func.date(DocumentModel.updated_at).label("d"), func.count(DocumentModel.id).label("c"))
        .filter(
            DocumentModel.doc_type == "SO",
            DocumentModel.status == "completed",
            (DocumentModel.assigned_to_user_id == user.id) | (DocumentModel.controlled_by_user_id == user.id),
            func.date(DocumentModel.updated_at) >= start_date,
            func.date(DocumentModel.updated_at) <= today,
        )
        .group_by(func.date(DocumentModel.updated_at))
        .order_by(func.date(DocumentModel.updated_at))
        .all()
    )
    by_date = {str(r.d): r.c for r in rows}
    by_day = [
        MyPickerStatsDay(date=(start_date + timedelta(days=i)).isoformat(), count=by_date.get((start_date + timedelta(days=i)).isoformat(), 0))
        for i in range(days)
    ]
    return MyPickerStatsResponse(
        total_completed=total_completed,
        completed_today=completed_today,
        by_day=by_day,
    )


@router.post("/fcm-token", status_code=status.HTTP_204_NO_CONTENT, summary="Register FCM token for push notifications")
async def register_fcm_token(
    payload: FCMTokenRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if not payload.token or not payload.token.strip():
        raise HTTPException(status_code=400, detail="token is required")
    token = payload.token.strip()
    existing = db.query(UserFCMToken).filter(UserFCMToken.token == token).one_or_none()
    if existing:
        existing.user_id = user.id
        existing.device_id = payload.device_id
    else:
        db.add(UserFCMToken(user_id=user.id, token=token, device_id=payload.device_id))
    db.commit()
    return None


@router.post(
    "/documents/{document_id}/send-to-controller",
    response_model=PickingDocument,
    summary="Send picked document to controller",
)
async def send_to_controller(
    document_id: UUID,
    payload: SendToControllerRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:send_to_controller")),
):
    document = (
        db.query(DocumentModel)
        .options(selectinload(DocumentModel.lines))
        .filter(DocumentModel.id == document_id)
        .with_for_update()
        .one_or_none()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.assigned_to_user_id != user.id:
        raise HTTPException(status_code=403, detail="Document not assigned to you")
    if document.status != "picked":
        raise HTTPException(status_code=409, detail="Document must be in picked status")
    if document.controlled_by_user_id is not None:
        raise HTTPException(status_code=409, detail="Already sent to controller")
    controller = (
        db.query(UserModel)
        .filter(
            UserModel.id == payload.controller_user_id,
            UserModel.role == "inventory_controller",
            UserModel.is_active.is_(True),
        )
        .one_or_none()
    )
    if not controller:
        raise HTTPException(status_code=400, detail="Invalid controller")
    document.controlled_by_user_id = payload.controller_user_id
    db.commit()
    return _to_picking_document(document)


@router.post(
    "/lines/{line_id}/pick",
    response_model=PickLineResponse,
    summary="Pick line qty",
)
async def pick_line(
    line_id: UUID,
    payload: PickLineRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:pick")),
):
    try:
        return _pick_line_impl(line_id, payload, db, user)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("pick_line error: %s", e)
        err_msg = str(e).strip() or type(e).__name__
        raise HTTPException(
            status_code=400,
            detail=f"Terish saqlanmadi. Sabab: {err_msg}",
        ) from e


def _pick_line_impl(line_id: UUID, payload: PickLineRequest, db: Session, user):
    existing_request = (
        db.query(PickRequest).filter(PickRequest.request_id == payload.request_id).one_or_none()
    )
    if existing_request:
        line = (
            db.query(DocumentLineModel)
            .options(selectinload(DocumentLineModel.document))
            .filter(DocumentLineModel.id == existing_request.line_id)
            .one_or_none()
        )
        if not line:
            raise HTTPException(status_code=404, detail="Line not found")
        document = (
            db.query(DocumentModel)
            .options(selectinload(DocumentModel.lines))
            .filter(DocumentModel.id == line.document_id)
            .one_or_none()
        )
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")
        if user.role == "picker" and document.assigned_to_user_id != user.id:
            raise HTTPException(status_code=403, detail="Forbidden")
        return PickLineResponse(
            line=_to_picking_line(line),
            progress=_calculate_progress(document.lines),
            document_status=document.status,
        )

    line = (
        db.query(DocumentLineModel)
        .filter(DocumentLineModel.id == line_id)
        .with_for_update()
        .one_or_none()
    )
    if not line:
        raise HTTPException(status_code=404, detail="Line not found")

    document = (
        db.query(DocumentModel)
        .filter(DocumentModel.id == line.document_id)
        .with_for_update()
        .one_or_none()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if user.role == "picker" and document.assigned_to_user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    next_qty = line.picked_qty + payload.delta
    if next_qty < 0:
        raise HTTPException(status_code=400, detail="qty_picked cannot be below 0")
    if next_qty > line.required_qty:
        raise HTTPException(status_code=400, detail="qty_picked cannot exceed qty_required")

    if not line.product_id or not line.lot_id or not line.location_id:
        raise HTTPException(
            status_code=409,
            detail="Pick line missing allocation details (product/lot/location). Allocate the order first.",
        )
    loc = db.query(LocationModel).filter(LocationModel.id == line.location_id).one_or_none()
    if not loc or loc.zone_type != "NORMAL":
        raise HTTPException(
            status_code=400,
            detail="Pick only from NORMAL zone. Line location is not NORMAL.",
        )

    line.picked_qty = next_qty
    qty_delta = Decimal(str(payload.delta))

    # Ortiqcha terishni oldini olish: hujjat bo'yicha (product+lot+location) jami terilgan
    # required_qty dan oshmasin (takroriy pick / ikki marta yozilishini bloklash)
    total_picked = (
        db.query(func.coalesce(func.sum(StockMovementModel.qty_change), 0))
        .filter(
            StockMovementModel.movement_type == "pick",
            StockMovementModel.source_document_type == "document",
            StockMovementModel.source_document_id == document.id,
            StockMovementModel.product_id == line.product_id,
            StockMovementModel.lot_id == line.lot_id,
            StockMovementModel.location_id == line.location_id,
        )
        .scalar()
    )
    max_required = (
        db.query(func.coalesce(func.sum(DocumentLineModel.required_qty), 0))
        .filter(
            DocumentLineModel.document_id == document.id,
            DocumentLineModel.product_id == line.product_id,
            DocumentLineModel.lot_id == line.lot_id,
            DocumentLineModel.location_id == line.location_id,
        )
        .scalar()
    )
    if total_picked is None:
        total_picked = 0
    if max_required is None:
        max_required = 0
    # total_picked va qty_delta manfiy (pick -1); kerak: total_picked + (-qty_delta) >= -max_required
    if float(total_picked) - float(qty_delta) < -float(max_required):
        raise HTTPException(
            status_code=400,
            detail="Terish miqdori buyurtma bo'yicha kerak miqdordan oshib ketdi. Ehtimol allaqachon terilgan.",
        )

    try:
        db.add(
            StockMovementModel(
                product_id=line.product_id,
                lot_id=line.lot_id,
                location_id=line.location_id,
                qty_change=-qty_delta,
                movement_type="pick",
                source_document_type="document",
                source_document_id=document.id,
                created_by_user_id=user.id,
            )
        )
        db.add(
            StockMovementModel(
                product_id=line.product_id,
                lot_id=line.lot_id,
                location_id=line.location_id,
                qty_change=-qty_delta,
                movement_type="unallocate",
                source_document_type="document",
                source_document_id=document.id,
                created_by_user_id=user.id,
            )
        )
        if document.order_id:
            order = (
                db.query(OrderModel)
                .options(selectinload(OrderModel.wms_state))
                .filter(OrderModel.id == document.order_id)
                .with_for_update()
                .one_or_none()
            )
            if order and order.wms_state and order.wms_state.status in {"allocated", "ready_for_picking"}:
                order.wms_state.status = "picking"
        db.add(PickRequest(request_id=payload.request_id, line_id=line.id))
        db.flush()
    except IntegrityError as e:
        db.rollback()
        logger.warning("pick_line IntegrityError: %s", e)
        stored = (
            db.query(PickRequest)
            .filter(PickRequest.request_id == payload.request_id)
            .one_or_none()
        )
        if stored:
            line = (
                db.query(DocumentLineModel)
                .options(selectinload(DocumentLineModel.document))
                .filter(DocumentLineModel.id == stored.line_id)
                .one_or_none()
            )
            if not line:
                raise HTTPException(status_code=404, detail="Line not found")
            document = (
                db.query(DocumentModel)
                .options(selectinload(DocumentModel.lines))
                .filter(DocumentModel.id == line.document_id)
                .one_or_none()
            )
            if not document:
                raise HTTPException(status_code=404, detail="Document not found")
            return PickLineResponse(
                line=_to_picking_line(line),
                progress=_calculate_progress(document.lines),
                document_status=document.status,
            )
        raise HTTPException(
            status_code=409,
            detail="Pick conflict (duplicate or constraint). Try again.",
        ) from e

    lines = (
        db.query(DocumentLineModel)
        .filter(DocumentLineModel.document_id == document.id)
        .with_for_update()
        .all()
    )
    _refresh_document_status(document, lines)
    db.commit()

    return PickLineResponse(
        line=_to_picking_line(line),
        progress=_calculate_progress(lines),
        document_status=document.status,
    )


class SkipLineRequest(BaseModel):
    reason: str


@router.post(
    "/lines/{line_id}/skip",
    response_model=PickLineResponse,
    summary="Skip line with reason (picked_qty -> 0, reverse stock)",
)
async def skip_line(
    line_id: UUID,
    payload: SkipLineRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:pick")),
):
    if not payload.reason or payload.reason.strip() not in INCOMPLETE_REASON_CODES:
        raise HTTPException(
            status_code=400,
            detail=f"reason must be one of: {list(INCOMPLETE_REASON_CODES)}",
        )
    reason = payload.reason.strip()

    line = (
        db.query(DocumentLineModel)
        .options(selectinload(DocumentLineModel.document))
        .filter(DocumentLineModel.id == line_id)
        .with_for_update()
        .one_or_none()
    )
    if not line:
        raise HTTPException(status_code=404, detail="Line not found")
    document = line.document
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if user.role == "picker" and document.assigned_to_user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if line.picked_qty <= 0:
        raise HTTPException(status_code=400, detail="Line has no picked qty to skip")

    if not line.product_id or not line.lot_id or not line.location_id:
        raise HTTPException(
            status_code=400,
            detail="Line missing product/lot/location",
        )

    qty_to_reverse = Decimal(str(line.picked_qty))

    # Reverse stock: return picked qty to location (pick + unallocate with positive qty)
    db.add(
        StockMovementModel(
            product_id=line.product_id,
            lot_id=line.lot_id,
            location_id=line.location_id,
            qty_change=qty_to_reverse,
            movement_type="pick",
            source_document_type="document",
            source_document_id=document.id,
            created_by_user_id=user.id,
        )
    )
    db.add(
        StockMovementModel(
            product_id=line.product_id,
            lot_id=line.lot_id,
            location_id=line.location_id,
            qty_change=qty_to_reverse,
            movement_type="unallocate",
            source_document_type="document",
            source_document_id=document.id,
            created_by_user_id=user.id,
        )
    )

    line.picked_qty = 0
    line.skip_reason = reason

    lines = (
        db.query(DocumentLineModel)
        .filter(DocumentLineModel.document_id == document.id)
        .all()
    )
    _refresh_document_status(document, lines)
    db.commit()
    db.refresh(line)
    lines_after = (
        db.query(DocumentLineModel)
        .filter(DocumentLineModel.document_id == document.id)
        .all()
    )
    db.refresh(document)

    return PickLineResponse(
        line=_to_picking_line(line),
        progress=_calculate_progress(lines_after),
        document_status=document.status,
    )


@router.post(
    "/documents/{document_id}/complete",
    response_model=PickingDocument,
    summary="Complete picking document (picker: -> picked; controller: -> completed)",
)
async def complete_picking_document(
    document_id: UUID,
    body: Optional[CompletePickingRequest] = Body(None),
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:complete")),
):
    document = (
        db.query(DocumentModel)
        .filter(DocumentModel.id == document_id)
        .with_for_update()
        .one_or_none()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    lines = (
        db.query(DocumentLineModel)
        .filter(DocumentLineModel.document_id == document.id)
        .with_for_update()
        .all()
    )
    incomplete = [line.id for line in lines if line.picked_qty < line.required_qty]
    incomplete_reason = (body or CompletePickingRequest()).incomplete_reason if body else None
    # Faqat yig'uvchi to'liq yig'maganda sabab talab qilinadi; controller allaqachon sabab bilan yuborilgan hujjatni yakunlaydi
    if incomplete and user.role != "inventory_controller":
        if not incomplete_reason or incomplete_reason not in INCOMPLETE_REASON_CODES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"message": "Incomplete lines", "lines": incomplete},
            )
        document.incomplete_reason = incomplete_reason

    if user.role == "inventory_controller":
        if document.controlled_by_user_id != user.id:
            raise HTTPException(status_code=403, detail="Document not assigned to you")
        if document.status == "completed":
            response = _to_picking_document_with_lines(document, lines)
            db.commit()
            return response
        if document.status != "picked":
            raise HTTPException(status_code=409, detail="Document must be in picked status")
        document.status = "completed"
        if document.order_id:
            order = (
                db.query(OrderModel)
                .options(selectinload(OrderModel.wms_state))
                .filter(OrderModel.id == document.order_id)
                .with_for_update()
                .one_or_none()
            )
            if order and order.wms_state and order.wms_state.status in {"picked", "picking", "allocated"}:
                order.wms_state.status = "completed"
    else:
        if document.assigned_to_user_id != user.id:
            raise HTTPException(status_code=403, detail="Document not assigned to you")
        document.status = "picked"
        if document.order_id:
            order = (
                db.query(OrderModel)
                .options(selectinload(OrderModel.wms_state))
                .filter(OrderModel.id == document.order_id)
                .with_for_update()
                .one_or_none()
            )
            if order and order.wms_state and order.wms_state.status in {"picking", "allocated"}:
                order.wms_state.status = "picked"
    # Javobni commit dan oldin yig‘ib olamiz (commit dan keyin session expired bo‘ladi)
    response = _to_picking_document_with_lines(document, lines)
    db.commit()
    return response
