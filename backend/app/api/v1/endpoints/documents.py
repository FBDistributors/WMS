from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Literal, Optional
from uuid import UUID, uuid4
import random

router = APIRouter()

DocumentStatus = Literal[
    "draft",
    "confirmed",
    "in_progress",
    "partial",
    "completed",
    "cancelled",
]
DocumentType = str

DOCUMENT_STATUSES = {"draft", "confirmed", "in_progress", "partial", "completed", "cancelled"}
DOCUMENT_TYPES = {"SO", "PO", "TRANSFER"}


class DocumentListItem(BaseModel):
    id: UUID
    doc_type: DocumentType = Field(..., description="SO/PO/TRANSFER")
    reference_number: str
    status: DocumentStatus
    lines_total: int
    lines_done: int = 0


class DocumentLine(BaseModel):
    line_id: UUID
    product_id: UUID
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
    product_id: UUID
    product_name: str
    barcode: Optional[str] = None
    location_code: str
    qty_required: float


class CreateDocumentRequest(BaseModel):
    doc_type: DocumentType
    reference_number: str
    lines: List[DocumentLineCreate]


_SAMPLE_PRODUCTS = [
    {
        "name": "Shampun 250ml",
        "sku": "SKU-0001",
        "barcode": "8600000000011",
        "location_code": "A-01-01",
    },
    {
        "name": "Krem 50ml",
        "sku": "SKU-0002",
        "barcode": "8600000000028",
        "location_code": "A-01-02",
    },
    {
        "name": "Gel 200ml",
        "sku": "SKU-0003",
        "barcode": "8600000000035",
        "location_code": "B-02-01",
    },
    {
        "name": "Sabun 100g",
        "sku": "SKU-0004",
        "barcode": "8600000000042",
        "location_code": "B-02-03",
    },
]


def _generate_lines(count: int, status: DocumentStatus) -> List[DocumentLine]:
    lines: List[DocumentLine] = []
    for _ in range(count):
        product = random.choice(_SAMPLE_PRODUCTS)
        qty_required = random.randint(1, 20)
        qty_picked = 0
        if status == "completed":
            qty_picked = qty_required
        elif status in {"in_progress", "partial"}:
            qty_picked = random.randint(0, max(qty_required - 1, 0))
            if status == "partial" and qty_picked == 0:
                qty_picked = 1 if qty_required > 1 else 0

        lines.append(
            DocumentLine(
                line_id=uuid4(),
                product_id=uuid4(),
                product_name=product["name"],
                sku=product["sku"],
                barcode=product["barcode"],
                location_code=product["location_code"],
                qty_required=qty_required,
                qty_picked=qty_picked,
            )
        )
    return lines


def _to_list_item(doc: DocumentDetails) -> DocumentListItem:
    lines_total = len(doc.lines)
    lines_done = sum(1 for line in doc.lines if line.qty_picked >= line.qty_required)
    return DocumentListItem(
        id=doc.id,
        doc_type=doc.doc_type,
        reference_number=doc.reference_number,
        status=doc.status,
        lines_total=lines_total,
        lines_done=lines_done,
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


# -----------------------
# FAKE DATA (MVP uchun)
# -----------------------
DOC1 = uuid4()
DOC2 = uuid4()

_DOC1_LINES = _generate_lines(count=2, status="confirmed")
_DOC2_LINES = _generate_lines(count=1, status="in_progress")

_FAKE_DOCS: List[DocumentDetails] = [
    DocumentDetails(
        id=DOC1,
        doc_type="SO",
        reference_number="SO-0001",
        status="confirmed",
        lines_total=len(_DOC1_LINES),
        lines_done=sum(1 for line in _DOC1_LINES if line.qty_picked >= line.qty_required),
        lines=_DOC1_LINES,
    ),
    DocumentDetails(
        id=DOC2,
        doc_type="SO",
        reference_number="SO-0002",
        status="in_progress",
        lines_total=len(_DOC2_LINES),
        lines_done=sum(1 for line in _DOC2_LINES if line.qty_picked >= line.qty_required),
        lines=_DOC2_LINES,
    ),
]


@router.post("/", response_model=DocumentDetails, summary="Create Document (FAKE)")
async def create_document(payload: CreateDocumentRequest):
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

    lines: List[DocumentLine] = []
    for line in payload.lines:
        if line.qty_required <= 0:
            raise HTTPException(status_code=400, detail="qty_required must be greater than 0")
        lines.append(
            DocumentLine(
                line_id=uuid4(),
                product_id=line.product_id,
                product_name=line.product_name,
                barcode=line.barcode,
                location_code=line.location_code,
                qty_required=line.qty_required,
                qty_picked=0,
            )
        )

    document = DocumentDetails(
        id=uuid4(),
        doc_type=payload.doc_type,
        reference_number=payload.reference_number,
        status="draft",
        lines_total=len(lines),
        lines_done=sum(1 for line in lines if line.qty_picked >= line.qty_required),
        lines=lines,
    )
    _FAKE_DOCS.append(document)
    return document


@router.get("/", response_model=List[DocumentListItem], summary="List Documents (FAKE)")
async def list_documents(
    status: Optional[str] = None,
    doc_type: Optional[str] = None,
    type_: Optional[str] = Query(None, alias="type"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    docs = _FAKE_DOCS
    status_filter = _parse_status_filter(status)
    if status_filter:
        docs = [doc for doc in docs if doc.status in status_filter]

    resolved_type = doc_type or type_
    if resolved_type:
        if resolved_type not in DOCUMENT_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid doc_type: {resolved_type}")
        docs = [doc for doc in docs if doc.doc_type == resolved_type]

    docs = docs[offset : offset + limit]
    return [_to_list_item(doc) for doc in docs]


@router.get("/{document_id}", response_model=DocumentDetails, summary="Get Document (FAKE)")
async def get_document(document_id: UUID):
    for doc in _FAKE_DOCS:
        if doc.id == document_id:
            return doc
    raise HTTPException(status_code=404, detail="Document not found")
