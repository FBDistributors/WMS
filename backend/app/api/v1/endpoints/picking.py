from decimal import Decimal
from typing import List, Literal, Optional
from uuid import UUID

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

logger = logging.getLogger(__name__)

from app.auth.deps import require_permission
from app.db import get_db
from app.models.document import Document as DocumentModel
from app.models.document import DocumentLine as DocumentLineModel
from app.models.order import Order as OrderModel
from app.models.picking import PickRequest
from app.models.stock import StockMovement as StockMovementModel
from app.models.user import User as UserModel

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


class SendToControllerRequest(BaseModel):
    controller_user_id: UUID


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
    return PickingDocument(
        id=doc.id,
        reference_number=doc.doc_no,
        status=doc.status,
        lines=[_to_picking_line(line) for line in doc.lines],
        progress=_calculate_progress(doc.lines),
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
    query = db.query(DocumentModel).options(selectinload(DocumentModel.lines))
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

    line.picked_qty = next_qty
    qty_delta = Decimal(str(payload.delta))
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
    if incomplete:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": "Incomplete lines", "lines": incomplete},
        )

    if user.role == "inventory_controller":
        if document.controlled_by_user_id != user.id:
            raise HTTPException(status_code=403, detail="Document not assigned to you")
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
    db.commit()

    document.lines = lines
    return _to_picking_document(document)
