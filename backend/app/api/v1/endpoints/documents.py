from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import require_permission
from app.db import get_db
from app.services.audit_service import ACTION_CREATE, ACTION_UPDATE, get_client_ip, log_action
from app.models.document import Document as DocumentModel
from app.models.document import DocumentLine as DocumentLineModel

router = APIRouter()

DocumentStatus = Literal[
    "new",
    "smartup_created",
    "draft",
    "confirmed",
    "in_progress",
    "partial",
    "completed",
    "cancelled",
]
DocumentType = str

DOCUMENT_STATUSES = {
    "new",
    "smartup_created",
    "draft",
    "confirmed",
    "in_progress",
    "partial",
    "completed",
    "cancelled",
}
DOCUMENT_TYPES = {"SO", "PO", "TRANSFER"}


class DocumentListItem(BaseModel):
    id: UUID
    doc_type: DocumentType = Field(..., description="SO/PO/TRANSFER")
    reference_number: str
    status: DocumentStatus
    lines_total: int
    lines_done: int = 0
    source: Optional[str] = None
    source_external_id: Optional[str] = None
    created_at: datetime


class DocumentLine(BaseModel):
    line_id: UUID
    product_name: str
    sku: Optional[str] = None
    barcode: Optional[str] = None
    location_code: str
    qty_required: float
    qty_picked: float = 0


class DocumentDetails(BaseModel):
    id: UUID
    doc_type: DocumentType
    reference_number: str
    status: DocumentStatus
    lines_total: int
    lines_done: int
    lines: List[DocumentLine]


class DocumentLineCreate(BaseModel):
    product_name: str
    sku: Optional[str] = None
    barcode: Optional[str] = None
    location_code: str
    qty_required: float


class CreateDocumentRequest(BaseModel):
    doc_type: DocumentType
    reference_number: str
    lines: List[DocumentLineCreate]


def _to_list_item(doc: DocumentModel) -> DocumentListItem:
    lines_total = len(doc.lines)
    lines_done = sum(1 for line in doc.lines if line.picked_qty >= line.required_qty)
    return DocumentListItem(
        id=doc.id,
        doc_type=doc.doc_type,
        reference_number=doc.doc_no,
        status=doc.status,
        lines_total=lines_total,
        lines_done=lines_done,
        source=doc.source,
        source_external_id=doc.source_external_id,
        created_at=doc.created_at,
    )


def _to_line(line: DocumentLineModel) -> DocumentLine:
    return DocumentLine(
        line_id=line.id,
        product_name=line.product_name,
        sku=line.sku,
        barcode=line.barcode,
        location_code=line.location_code,
        qty_required=line.required_qty,
        qty_picked=line.picked_qty,
    )


def _to_document(doc: DocumentModel) -> DocumentDetails:
    lines_total = len(doc.lines)
    lines_done = sum(1 for line in doc.lines if line.picked_qty >= line.required_qty)
    return DocumentDetails(
        id=doc.id,
        doc_type=doc.doc_type,
        reference_number=doc.doc_no,
        status=doc.status,
        lines_total=lines_total,
        lines_done=lines_done,
        lines=[_to_line(line) for line in doc.lines],
    )


def _parse_status_filter(status: Optional[str]) -> Optional[List[DocumentStatus]]:
    if not status:
        return None
    tokens = [token.strip() for token in status.split(",") if token.strip()]
    invalid = [token for token in tokens if token not in DOCUMENT_STATUSES]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status values: {', '.join(invalid)}",
        )
    return tokens  # type: ignore[return-value]


@router.post("", response_model=DocumentDetails, summary="Create Document")
@router.post("/", response_model=DocumentDetails, summary="Create Document")
async def create_document(
    request: Request,
    payload: CreateDocumentRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("documents:create")),
):
    if not payload.doc_type or not payload.doc_type.strip():
        raise HTTPException(status_code=400, detail="doc_type must not be empty")
    if payload.doc_type not in DOCUMENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid doc_type: {payload.doc_type}. Allowed: {', '.join(sorted(DOCUMENT_TYPES))}",
        )
    if not payload.reference_number or not payload.reference_number.strip():
        raise HTTPException(status_code=400, detail="reference_number must not be empty")
    if not payload.lines:
        raise HTTPException(status_code=400, detail="lines must not be empty")

    existing = (
        db.query(DocumentModel)
        .options(selectinload(DocumentModel.lines))
        .filter(
            DocumentModel.doc_no == payload.reference_number,
            DocumentModel.doc_type == payload.doc_type,
        )
        .one_or_none()
    )
    if existing:
        return _to_document(existing)

    document = DocumentModel(
        doc_no=payload.reference_number,
        doc_type=payload.doc_type,
        status="draft",
    )
    document.lines = []
    for line in payload.lines:
        if line.qty_required <= 0:
            raise HTTPException(status_code=400, detail="qty_required must be greater than 0")
        document.lines.append(
            DocumentLineModel(
                sku=line.sku,
                product_name=line.product_name,
                barcode=line.barcode,
                location_code=line.location_code,
                required_qty=line.qty_required,
                picked_qty=0,
            )
        )

    try:
        db.add(document)
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = (
            db.query(DocumentModel)
            .options(selectinload(DocumentModel.lines))
            .filter(
                DocumentModel.doc_no == payload.reference_number,
                DocumentModel.doc_type == payload.doc_type,
            )
            .one_or_none()
        )
        if existing:
            return _to_document(existing)
        raise HTTPException(status_code=409, detail="Document already exists")

    db.refresh(document)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_CREATE,
        entity_type="document",
        entity_id=str(document.id),
        new_data={"doc_no": document.doc_no, "doc_type": document.doc_type, "status": document.status},
        ip_address=get_client_ip(request),
    )
    db.commit()
    return _to_document(document)


@router.get("", response_model=List[DocumentListItem], summary="List Documents")
@router.get("/", response_model=List[DocumentListItem], summary="List Documents")
async def list_documents(
    status: Optional[str] = None,
    doc_type: Optional[str] = None,
    type_: Optional[str] = Query(None, alias="type"),
    source: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("documents:read")),
):
    query = db.query(DocumentModel).options(selectinload(DocumentModel.lines))
    status_filter = _parse_status_filter(status)
    if status_filter:
        query = query.filter(DocumentModel.status.in_(status_filter))

    resolved_type = doc_type or type_
    if resolved_type:
        if resolved_type not in DOCUMENT_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid doc_type: {resolved_type}")
        query = query.filter(DocumentModel.doc_type == resolved_type)

    if source:
        query = query.filter(DocumentModel.source == source)

    docs = query.offset(offset).limit(limit).all()
    return [_to_list_item(doc) for doc in docs]


@router.get("/{document_id}", response_model=DocumentDetails, summary="Get Document")
async def get_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("documents:read")),
):
    doc = (
        db.query(DocumentModel)
        .options(selectinload(DocumentModel.lines))
        .filter(DocumentModel.id == document_id)
        .one_or_none()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return _to_document(doc)


class DocumentStatusUpdate(BaseModel):
    status: Literal["cancelled"]


@router.patch("/{document_id}", response_model=DocumentListItem, summary="Update document status (cancel)")
async def update_document_status(
    request: Request,
    document_id: UUID,
    payload: DocumentStatusUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_permission("documents:edit_status")),
):
    """Cancel a document (e.g. test picking). Only transition to cancelled is allowed."""
    doc = (
        db.query(DocumentModel)
        .options(selectinload(DocumentModel.lines))
        .filter(DocumentModel.id == document_id)
        .one_or_none()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if payload.status != "cancelled":
        raise HTTPException(status_code=400, detail="Only status 'cancelled' is allowed")
    old_status = doc.status
    doc.status = "cancelled"
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="document",
        entity_id=str(document_id),
        old_data={"status": old_status},
        new_data={"status": "cancelled"},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(doc)
    return _to_list_item(doc)
