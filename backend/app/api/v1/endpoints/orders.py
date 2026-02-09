from __future__ import annotations

from datetime import date
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import require_permission
from app.db import get_db
from app.integrations.smartup.client import SmartupClient
from app.integrations.smartup.importer import import_orders
from app.models.document import Document as DocumentModel
from app.models.document import DocumentLine as DocumentLineModel
from app.models.order import Order as OrderModel
from app.models.order import OrderLine as OrderLineModel
from app.auth.permissions import get_permissions_for_role
from app.models.user import User

router = APIRouter()

ORDER_STATUSES = {
    "imported",
    "ready_for_picking",
    "picking",
    "picked",
    "packed",
    "shipped",
    "cancelled",
}


class OrderListItem(BaseModel):
    id: UUID
    order_number: str
    source_external_id: str
    status: str
    filial_id: Optional[str] = None
    customer_name: Optional[str] = None
    created_at: date
    lines_total: int


class OrderLineOut(BaseModel):
    id: UUID
    sku: Optional[str] = None
    barcode: Optional[str] = None
    name: str
    qty: float
    uom: Optional[str] = None


class OrderDetails(BaseModel):
    id: UUID
    order_number: str
    source_external_id: str
    status: str
    filial_id: Optional[str] = None
    customer_name: Optional[str] = None
    created_at: date
    lines: List[OrderLineOut]


class OrdersListResponse(BaseModel):
    items: List[OrderListItem]
    total: int
    limit: int
    offset: int


class SmartupSyncRequest(BaseModel):
    begin_deal_date: date = Field(..., description="YYYY-MM-DD")
    end_deal_date: date = Field(..., description="YYYY-MM-DD")
    filial_code: Optional[str] = None


class SmartupSyncResponse(BaseModel):
    created: int
    updated: int
    skipped: int


class SendToPickingRequest(BaseModel):
    assigned_to_user_id: UUID


class SendToPickingResponse(BaseModel):
    pick_task_id: UUID
    assigned_to: UUID


class PickerUser(BaseModel):
    id: UUID
    name: str


@router.get("", response_model=OrdersListResponse, summary="List orders")
@router.get("/", response_model=OrdersListResponse, summary="List orders")
async def list_orders(
    status: Optional[str] = None,
    q: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    filial_id: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:read")),
):
    query = db.query(OrderModel).options(selectinload(OrderModel.lines))

    if status:
        if status not in ORDER_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        query = query.filter(OrderModel.status == status)

    if q:
        term = f"%{q.strip()}%"
        query = query.filter(
            or_(
                OrderModel.order_number.ilike(term),
                OrderModel.source_external_id.ilike(term),
                OrderModel.customer_name.ilike(term),
            )
        )

    if filial_id:
        query = query.filter(OrderModel.filial_id == filial_id)

    if date_from:
        query = query.filter(func.date(OrderModel.created_at) >= date_from)
    if date_to:
        query = query.filter(func.date(OrderModel.created_at) <= date_to)

    total = (
        query.with_entities(func.count(OrderModel.id))
        .order_by(None)
        .scalar()
        or 0
    )
    orders = query.order_by(OrderModel.created_at.desc()).offset(offset).limit(limit).all()

    items = [
        OrderListItem(
            id=order.id,
            order_number=order.order_number,
            source_external_id=order.source_external_id,
            status=order.status,
            filial_id=order.filial_id,
            customer_name=order.customer_name,
            created_at=order.created_at.date(),
            lines_total=len(order.lines),
        )
        for order in orders
    ]

    return OrdersListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/{order_id}", response_model=OrderDetails, summary="Get order")
async def get_order(
    order_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:read")),
):
    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.lines))
        .filter(OrderModel.id == order_id)
        .one_or_none()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return OrderDetails(
        id=order.id,
        order_number=order.order_number,
        source_external_id=order.source_external_id,
        status=order.status,
        filial_id=order.filial_id,
        customer_name=order.customer_name,
        created_at=order.created_at.date(),
        lines=[
            OrderLineOut(
                id=line.id,
                sku=line.sku,
                barcode=line.barcode,
                name=line.name,
                qty=line.qty,
                uom=line.uom,
            )
            for line in order.lines
        ],
    )


@router.post("/sync-smartup", response_model=SmartupSyncResponse, summary="Sync orders from Smartup")
async def sync_orders_from_smartup(
    payload: SmartupSyncRequest,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:sync")),
):
    if payload.begin_deal_date > payload.end_deal_date:
        raise HTTPException(status_code=400, detail="begin_deal_date must be <= end_deal_date")

    try:
        client = SmartupClient()
        response = client.export_orders(
            begin_deal_date=payload.begin_deal_date.strftime("%d.%m.%Y"),
            end_deal_date=payload.end_deal_date.strftime("%d.%m.%Y"),
            filial_code=payload.filial_code,
        )
        created, updated, skipped, _errors = import_orders(db, response.items)
        return SmartupSyncResponse(created=created, updated=updated, skipped=skipped)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Smartup export failed: {exc}") from exc


@router.get("/pickers", response_model=List[PickerUser], summary="List picker users")
async def list_picker_users(
    db: Session = Depends(get_db),
    _user=Depends(require_permission("picking:assign")),
):
    users = db.query(User).filter(User.role == "picker", User.is_active.is_(True)).all()
    return [PickerUser(id=user.id, name=user.full_name or user.username) for user in users]


@router.post("/{order_id}/send-to-picking", response_model=SendToPickingResponse, summary="Send order to picking")
async def send_order_to_picking(
    order_id: UUID,
    payload: SendToPickingRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:send_to_picking")),
):
    if "picking:assign" not in get_permissions_for_role(user.role):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.lines))
        .filter(OrderModel.id == order_id)
        .one_or_none()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.status not in {"imported", "ready_for_picking"}:
        raise HTTPException(status_code=409, detail="Order cannot be sent to picking")

    existing = db.query(DocumentModel).filter(DocumentModel.order_id == order.id).one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Picking task already created")

    assigned_user = db.query(User).filter(User.id == payload.assigned_to_user_id).one_or_none()
    if not assigned_user or assigned_user.role != "picker":
        raise HTTPException(status_code=400, detail="Invalid picker selection")

    document = DocumentModel(
        doc_no=order.order_number,
        doc_type="SO",
        status="new",
        source="orders",
        source_external_id=order.source_external_id,
        order_id=order.id,
        assigned_to_user_id=payload.assigned_to_user_id,
    )
    document.lines = [
        DocumentLineModel(
            sku=line.sku,
            product_name=line.name,
            barcode=line.barcode,
            location_code="",
            required_qty=line.qty,
            picked_qty=0,
        )
        for line in order.lines
    ]

    db.add(document)
    order.status = "picking"
    db.commit()
    db.refresh(document)

    return SendToPickingResponse(pick_task_id=document.id, assigned_to=payload.assigned_to_user_id)
