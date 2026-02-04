from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, List, Literal, Optional
from uuid import UUID

from app.api.v1.endpoints.documents import DocumentDetails, DocumentLine, _FAKE_DOCS

router = APIRouter()


class PickingLine(BaseModel):
    id: UUID
    product_name: str
    sku: Optional[str] = None
    barcode: Optional[str] = None
    location_code: str
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


class PickLineRequest(BaseModel):
    delta: Literal[-1, 1]
    request_id: str


class PickLineResponse(BaseModel):
    line: PickingLine
    progress: PickingProgress
    document_status: str


_REQUEST_IDS: Dict[str, UUID] = {}


def _find_document(document_id: UUID) -> DocumentDetails:
    for doc in _FAKE_DOCS:
        if doc.id == document_id:
            return doc
    raise HTTPException(status_code=404, detail="Document not found")


def _find_line(line_id: UUID) -> tuple[DocumentDetails, DocumentLine]:
    for doc in _FAKE_DOCS:
        for line in doc.lines:
            if line.line_id == line_id:
                return doc, line
    raise HTTPException(status_code=404, detail="Line not found")


def _calculate_progress(lines: List[DocumentLine]) -> PickingProgress:
    required = sum(line.qty_required for line in lines)
    picked = sum(line.qty_picked for line in lines)
    return PickingProgress(picked=picked, required=required)


def _to_picking_line(line: DocumentLine) -> PickingLine:
    return PickingLine(
        id=line.line_id,
        product_name=line.product_name,
        sku=line.sku,
        barcode=line.barcode,
        location_code=line.location_code,
        qty_required=line.qty_required,
        qty_picked=line.qty_picked,
    )


def _to_picking_document(doc: DocumentDetails) -> PickingDocument:
    return PickingDocument(
        id=doc.id,
        reference_number=doc.reference_number,
        status=doc.status,
        lines=[_to_picking_line(line) for line in doc.lines],
        progress=_calculate_progress(doc.lines),
    )


def _refresh_document_status(doc: DocumentDetails) -> None:
    if all(line.qty_picked >= line.qty_required for line in doc.lines):
        doc.status = "completed"
    elif any(line.qty_picked > 0 for line in doc.lines):
        doc.status = "in_progress"


@router.get("/documents/{document_id}", response_model=PickingDocument, summary="Picking document")
async def get_picking_document(document_id: UUID):
    document = _find_document(document_id)
    return _to_picking_document(document)


@router.post(
    "/lines/{line_id}/pick",
    response_model=PickLineResponse,
    summary="Pick line qty",
)
async def pick_line(line_id: UUID, payload: PickLineRequest):
    # Idempotent: repeat request_id returns current state without re-applying.
    if payload.request_id in _REQUEST_IDS:
        stored_line_id = _REQUEST_IDS[payload.request_id]
        document, existing_line = _find_line(stored_line_id)
        return PickLineResponse(
            line=_to_picking_line(existing_line),
            progress=_calculate_progress(document.lines),
            document_status=document.status,
        )

    document, line = _find_line(line_id)
    next_qty = line.qty_picked + payload.delta
    if next_qty < 0:
        raise HTTPException(status_code=400, detail="qty_picked cannot be below 0")
    if next_qty > line.qty_required:
        raise HTTPException(status_code=400, detail="qty_picked cannot exceed qty_required")

    line.qty_picked = next_qty
    _refresh_document_status(document)
    _REQUEST_IDS[payload.request_id] = line_id

    return PickLineResponse(
        line=_to_picking_line(line),
        progress=_calculate_progress(document.lines),
        document_status=document.status,
    )


@router.post(
    "/documents/{document_id}/complete",
    response_model=PickingDocument,
    summary="Complete picking document",
)
async def complete_picking_document(document_id: UUID):
    document = _find_document(document_id)
    incomplete = [
        line.line_id
        for line in document.lines
        if line.qty_picked < line.qty_required
    ]
    if incomplete:
        raise HTTPException(
            status_code=409,
            detail={"message": "Incomplete lines", "lines": incomplete},
        )

    document.status = "completed"
    return _to_picking_document(document)
