from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Literal, Optional
from uuid import UUID

import logging

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel
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
from app.models.picking import PickRequest
from app.models.stock import StockMovement as StockMovementModel
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


class PickingListItem(BaseModel):
    id: UUID
    reference_number: str
    status: str
    lines_total: int
    lines_done: int
    controlled_by_user_id: Optional[UUID] = None


class PickLineRequest(BaseModel):
    delta: Literal[-1, 1]
    request_id: str


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
    required = sum(line.required_qty for line in lines)
    picked = sum(line.picked_qty for line in lines)
    return PickingProgress(picked=picked, required=required)


def _to_picking_line(line: DocumentLineModel) -> PickingLine:
    return PickingLine(
        id=line.id,
        product_name=line.product_name,
        sku=line.sku,
        barcode=line.barcode,
        location_code=line.location_code,
        batch=line.batch,
        expiry_date=line.expiry_date.isoformat() if line.expiry_date else None,
        qty_required=line.required_qty,
        qty_picked=line.picked_qty,
    )


def _to_picking_document(doc: DocumentModel) -> PickingDocument:
    lines = getattr(doc, "lines", None) or []
    return PickingDocument(
        id=doc.id,
        reference_number=doc.doc_no,
        status=doc.status,
        lines=[_to_picking_line(line) for line in lines],
        progress=_calculate_progress(lines),
        incomplete_reason=getattr(doc, "incomplete_reason", None),
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
    )


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
        .options(selectinload(DocumentModel.lines))
        .filter(DocumentModel.id == document_id)
        .one_or_none()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if user.role == "picker" and document.assigned_to_user_id != user.id:
        raise HTTPException(status_code=404, detail="Document not found")
    if user.role == "inventory_controller" and document.controlled_by_user_id != user.id:
        raise HTTPException(status_code=404, detail="Document not found")
    return _to_picking_document(document)


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
    ORDER_HIDDEN_STATUSES = ("packed", "shipped", "cancelled")
    query = (
        db.query(DocumentModel)
        .options(selectinload(DocumentModel.lines))
        .outerjoin(OrderModel, DocumentModel.order_id == OrderModel.id)
        .filter(
            or_(
                OrderModel.id.is_(None),
                OrderModel.status.notin_(ORDER_HIDDEN_STATUSES),
            )
        )
    )
    if user.role == "picker":
        query = query.filter(DocumentModel.assigned_to_user_id == user.id)
    elif user.role == "inventory_controller":
        query = query.filter(
            DocumentModel.controlled_by_user_id == user.id,
            DocumentModel.status == "picked",
        )
    if not include_cancelled:
        query = query.filter(DocumentModel.status != "cancelled")
    docs = query.order_by(DocumentModel.created_at.desc()).offset(offset).limit(limit).all()
    return [_to_picking_list_item(doc) for doc in docs]


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
                .filter(OrderModel.id == document.order_id)
                .with_for_update()
                .one_or_none()
            )
            if order and order.status in {"allocated", "ready_for_picking"}:
                order.status = "picking"
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
    if incomplete:
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
    else:
        if document.assigned_to_user_id != user.id:
            raise HTTPException(status_code=403, detail="Document not assigned to you")
        document.status = "picked"
        if document.order_id:
            order = (
                db.query(OrderModel)
                .filter(OrderModel.id == document.order_id)
                .with_for_update()
                .one_or_none()
            )
            if order and order.status in {"picking", "allocated"}:
                order.status = "picked"
    # Javobni commit dan oldin yig‘ib olamiz (commit dan keyin session expired bo‘ladi)
    response = _to_picking_document_with_lines(document, lines)
    db.commit()
    return response
