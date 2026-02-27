from __future__ import annotations

import logging
import os
from datetime import date
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Query, status
from pydantic import BaseModel, Field
from decimal import Decimal
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import get_current_user, require_any_permission, require_permission
from app.db import get_db
from app.services.audit_service import ACTION_CREATE, ACTION_UPDATE, get_client_ip, log_action
from app.services.push_notifications import send_push_to_user
from app.integrations.smartup.client import SmartupClient
from app.integrations.smartup.importer import import_orders
from app.models.document import Document as DocumentModel
from app.models.document import DocumentLine as DocumentLineModel
from app.models.order import Order as OrderModel
from app.models.order import OrderLine as OrderLineModel
from app.models.product import Product as ProductModel
from app.models.product import ProductBarcode
from app.models.location import Location as LocationModel
from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel
from app.auth.permissions import get_permissions_for_role
from app.models.user import User

router = APIRouter()

ORDER_STATUSES = {
    "imported",
    "B#S",
    "allocated",
    "ready_for_picking",
    "picking",
    "picked",
    "completed",
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
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    total_amount: Optional[Decimal] = None
    created_at: date
    lines_total: int
    picker_name: Optional[str] = None
    controller_name: Optional[str] = None
    is_incomplete: bool = False


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
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    total_amount: Optional[Decimal] = None
    created_at: date
    lines: List[OrderLineOut]


class OrdersListResponse(BaseModel):
    items: List[OrderListItem]
    total: int
    limit: int
    offset: int


class SmartupSyncRequest(BaseModel):
    begin_deal_date: Optional[date] = Field(None, description="YYYY-MM-DD")
    end_deal_date: Optional[date] = Field(None, description="YYYY-MM-DD")
    filial_code: Optional[str] = None
    order_source: Optional[str] = Field(None, description="diller, orikzor yoki boshqa manba; saqlanadi Order.source da")


class SmartupSyncResponse(BaseModel):
    created: int
    updated: int
    skipped: int


class SendToPickingRequest(BaseModel):
    assigned_to_user_id: UUID


class SendToPickingResponse(BaseModel):
    pick_task_id: UUID
    assigned_to: UUID


class OrderStatusUpdateRequest(BaseModel):
    status: str = Field(..., description="picked, packed, shipped yoki boshqa ruxsat etilgan status")


ALLOWED_ADMIN_ORDER_STATUSES = {"imported", "B#S", "allocated", "ready_for_picking", "picking", "picked", "completed", "packed", "shipped", "cancelled"}


class PickerUser(BaseModel):
    id: UUID
    name: str


class AllocationShortage(BaseModel):
    line_id: UUID
    sku: Optional[str] = None
    barcode: Optional[str] = None
    required_qty: float
    allocated_qty: float


def _resolve_product_id(db: Session, line: OrderLineModel) -> UUID | None:
    if line.sku:
        product = db.query(ProductModel.id).filter(ProductModel.sku == line.sku).one_or_none()
        if product:
            return product.id
    if line.barcode:
        product = (
            db.query(ProductModel.id)
            .join(ProductBarcode, ProductBarcode.product_id == ProductModel.id)
            .filter(ProductBarcode.barcode == line.barcode)
            .one_or_none()
        )
        if product:
            return product.id
    return None


def _fefo_available_lots(db: Session, product_id: UUID):
    return (
        db.query(
            StockMovementModel.lot_id,
            StockMovementModel.location_id,
            func.sum(StockMovementModel.qty_change).label("qty"),
            StockLotModel.batch,
            StockLotModel.expiry_date,
            LocationModel.code.label("location_code"),
        )
        .join(StockLotModel, StockLotModel.id == StockMovementModel.lot_id)
        .join(LocationModel, LocationModel.id == StockMovementModel.location_id)
        .filter(
            StockLotModel.product_id == product_id,
            LocationModel.zone_type == "NORMAL",
            LocationModel.is_active.is_(True),
            (StockLotModel.expiry_date.is_(None) | (StockLotModel.expiry_date >= date.today())),
        )
        .group_by(
            StockMovementModel.lot_id,
            StockMovementModel.location_id,
            StockLotModel.batch,
            StockLotModel.expiry_date,
            LocationModel.code,
        )
        .having(func.sum(StockMovementModel.qty_change) > 0)
        .order_by(StockLotModel.expiry_date.asc().nullslast(), LocationModel.code.asc())
        .all()
    )


def _to_order_details(order: OrderModel) -> OrderDetails:
    return OrderDetails(
        id=order.id,
        order_number=order.order_number,
        source_external_id=order.source_external_id,
        status=order.status,
        filial_id=order.filial_id,
        customer_id=order.customer_id,
        customer_name=order.customer_name,
        agent_id=order.agent_id,
        agent_name=order.agent_name,
        total_amount=order.total_amount,
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


def _allocate_order(
    db: Session,
    order: OrderModel,
    user_id: UUID,
) -> tuple[list[DocumentLineModel], list[AllocationShortage]]:
    shortages: list[AllocationShortage] = []
    document_lines: list[DocumentLineModel] = []

    for line in order.lines:
        product_id = _resolve_product_id(db, line)
        if not product_id:
            shortages.append(
                AllocationShortage(
                    line_id=line.id,
                    sku=line.sku,
                    barcode=line.barcode,
                    required_qty=line.qty,
                    allocated_qty=0,
                )
            )
            continue

        remaining = Decimal(str(line.qty))
        allocated_total = Decimal("0")
        available_lots = _fefo_available_lots(db, product_id)

        for lot_row in available_lots:
            if remaining <= 0:
                break
            available_qty = Decimal(str(lot_row.qty))
            if available_qty <= 0:
                continue
            allocate_qty = min(available_qty, remaining)

            document_lines.append(
                DocumentLineModel(
                    product_id=product_id,
                    lot_id=lot_row.lot_id,
                    location_id=lot_row.location_id,
                    sku=line.sku,
                    product_name=line.name,
                    barcode=line.barcode,
                    location_code=lot_row.location_code or "",
                    batch=lot_row.batch,
                    expiry_date=lot_row.expiry_date,
                    required_qty=float(allocate_qty),
                    picked_qty=0,
                )
            )
            db.add(
                StockMovementModel(
                    product_id=product_id,
                    lot_id=lot_row.lot_id,
                    location_id=lot_row.location_id,
                    qty_change=allocate_qty,
                    movement_type="allocate",
                    source_document_type="order",
                    source_document_id=order.id,
                    created_by_user_id=user_id,
                )
            )

            allocated_total += allocate_qty
            remaining -= allocate_qty

        if allocated_total < Decimal(str(line.qty)):
            shortages.append(
                AllocationShortage(
                    line_id=line.id,
                    sku=line.sku,
                    barcode=line.barcode,
                    required_qty=line.qty,
                    allocated_qty=float(allocated_total),
                )
            )

    return document_lines, shortages


@router.get("", response_model=OrdersListResponse, summary="List orders")
@router.get("/", response_model=OrdersListResponse, summary="List orders")
async def list_orders(
    status: Optional[str] = None,
    q: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    filial_id: Optional[str] = None,
    brand_id: Optional[UUID] = Query(None, description="Filter by brand (orders that contain products of this brand)"),
    order_source: Optional[str] = Query(None, description="diller, orikzor va h.k. — Order.source bo'yicha filtrlash"),
    search_fields: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:read")),
):
    query = db.query(OrderModel).options(selectinload(OrderModel.lines))

    if order_source and order_source.strip():
        query = query.filter(OrderModel.source == order_source.strip())

    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        valid = [s for s in statuses if s in ORDER_STATUSES]
        if not valid:
            raise HTTPException(status_code=400, detail="Invalid status")
        if len(valid) == 1:
            query = query.filter(OrderModel.status == valid[0])
        else:
            query = query.filter(OrderModel.status.in_(valid))

    if q:
        allowed_fields = {
            "order_number": OrderModel.order_number,
            "external_id": OrderModel.source_external_id,
            "customer": OrderModel.customer_name,
            "customer_id": OrderModel.customer_id,
            "agent": OrderModel.agent_name,
        }
        if search_fields:
            requested_fields = [field.strip() for field in search_fields.split(",") if field.strip()]
            invalid = [field for field in requested_fields if field not in allowed_fields]
            if invalid:
                raise HTTPException(status_code=400, detail="Invalid search fields")
            fields = [allowed_fields[field] for field in requested_fields]
        else:
            fields = [
                OrderModel.order_number,
                OrderModel.source_external_id,
                OrderModel.customer_name,
            ]
        term = f"%{q.strip()}%"
        query = query.filter(or_(*[field.ilike(term) for field in fields]))

    # Filial filter: order_source berilganda filial default qo‘llanmaydi (manba bo‘yicha filtr yetarli)
    if not (order_source and order_source.strip()):
        if filial_id and filial_id.strip().lower() == "all":
            pass  # no filial filter
        elif filial_id and filial_id.strip():
            query = query.filter(OrderModel.filial_id == filial_id.strip())
        else:
            default_filial = os.getenv("WMS_DEFAULT_FILIAL_ID", "3788131").strip()
            if default_filial:
                query = query.filter(OrderModel.filial_id == default_filial)

    if date_from:
        query = query.filter(func.date(OrderModel.created_at) >= date_from)
    if date_to:
        query = query.filter(func.date(OrderModel.created_at) <= date_to)

    if brand_id:
        query = (
            query.join(OrderLineModel, OrderModel.id == OrderLineModel.order_id)
            .join(ProductModel, OrderLineModel.sku == ProductModel.sku)
            .filter(ProductModel.brand_id == brand_id)
            .distinct()
        )
        total = query.with_entities(OrderModel.id).count()
        orders = query.order_by(OrderModel.created_at.desc()).offset(offset).limit(limit).all()
    else:
        total = (
            query.with_entities(func.count(OrderModel.id))
            .order_by(None)
            .scalar()
            or 0
        )
        orders = query.order_by(OrderModel.created_at.desc()).offset(offset).limit(limit).all()

    order_ids = [o.id for o in orders]
    doc_by_order: dict[UUID, DocumentModel] = {}
    if order_ids:
        docs = (
            db.query(DocumentModel)
            .filter(DocumentModel.order_id.in_(order_ids), DocumentModel.doc_type == "SO")
            .options(
                selectinload(DocumentModel.assigned_to_user),
                selectinload(DocumentModel.controlled_by_user),
            )
            .all()
        )
        doc_by_order = {d.order_id: d for d in docs if d.order_id}

    def _picker_name(doc: DocumentModel | None) -> Optional[str]:
        if not doc or not doc.assigned_to_user:
            return None
        u = doc.assigned_to_user
        return u.full_name or u.username

    def _controller_name(doc: DocumentModel | None) -> Optional[str]:
        if not doc or not doc.controlled_by_user:
            return None
        u = doc.controlled_by_user
        return u.full_name or u.username

    items = []
    for order in orders:
        doc = doc_by_order.get(order.id)
        is_incomplete = doc is not None and doc.incomplete_reason is not None
        items.append(
            OrderListItem(
                id=order.id,
                order_number=order.order_number,
                source_external_id=order.source_external_id,
                status=order.status,
                filial_id=order.filial_id,
                customer_id=order.customer_id,
                customer_name=order.customer_name,
                agent_id=order.agent_id,
                agent_name=order.agent_name,
                total_amount=order.total_amount,
                created_at=order.created_at.date(),
                lines_total=len(order.lines),
                picker_name=_picker_name(doc),
                controller_name=_controller_name(doc),
                is_incomplete=is_incomplete,
            )
        )

    return OrdersListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/pickers", response_model=List[PickerUser], summary="List picker users")
async def list_picker_users(
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["picking:assign", "orders:send_to_picking"])),
):
    users = db.query(User).filter(User.role == "picker", User.is_active.is_(True)).order_by(User.full_name, User.username).all()
    return [PickerUser(id=user.id, name=user.full_name or user.username) for user in users]


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
    return _to_order_details(order)


@router.patch("/{order_id}/status", response_model=OrderDetails, summary="Admin: buyurtma statusini o'zgartirish")
async def update_order_status(
    request: Request,
    order_id: UUID,
    payload: OrderStatusUpdateRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("documents:edit_status")),
):
    if payload.status not in ALLOWED_ADMIN_ORDER_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Status must be one of: {', '.join(sorted(ALLOWED_ADMIN_ORDER_STATUSES))}",
        )
    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.lines))
        .filter(OrderModel.id == order_id)
        .one_or_none()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    old_status = order.status
    order.status = payload.status
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="order",
        entity_id=str(order_id),
        old_data={"status": old_status},
        new_data={"status": payload.status},
        ip_address=get_client_ip(request),
    )
    db.commit()
    return _to_order_details(order)


@router.post("/sync-smartup", response_model=SmartupSyncResponse, summary="Sync orders from Smartup")
async def sync_orders_from_smartup(
    payload: SmartupSyncRequest,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:sync")),
):
    today = date.today()
    begin_date = payload.begin_deal_date or today
    end_date = payload.end_deal_date or today
    if begin_date > end_date:
        raise HTTPException(status_code=400, detail="begin_deal_date must be <= end_deal_date")

    try:
        # O'rikzor: alohida export URL (movement$export) va header'lar (project_code anor bo'lishi mumkin)
        is_orikzor = payload.order_source == "orikzor"
        # Render'da SMARTUP_ORIKZOR_URL yoki SMARTUP_ORIKZOR_EXPORT_URL ishlatiladi
        orikzor_export_url = (
            (os.getenv("SMARTUP_ORIKZOR_URL") or os.getenv("SMARTUP_ORIKZOR_EXPORT_URL") or "https://smartup.online/b/anor/mxsx/mkw/movement$export").strip()
            if is_orikzor else None
        )
        if is_orikzor:
            # movement$export: 401 bo'lsa SMARTUP_ORIKZOR_BASIC_USER / SMARTUP_ORIKZOR_BASIC_PASS ni o'rnating (alohida login)
            project_code = (os.getenv("SMARTUP_ORIKZOR_PROJECT_CODE") or "mkw").strip()
            filial_id = (os.getenv("SMARTUP_ORIKZOR_FILIAL_ID") or "").strip()
            orikzor_user = (os.getenv("SMARTUP_ORIKZOR_BASIC_USER") or "").strip() or None
            orikzor_pass = (os.getenv("SMARTUP_ORIKZOR_BASIC_PASS") or "").strip() or None
            client = SmartupClient(
                project_code=project_code,
                filial_id=filial_id,
                username=orikzor_user,
                password=orikzor_pass,
            )
        else:
            client = SmartupClient()
        response = client.export_orders(
            begin_deal_date=begin_date.strftime("%d.%m.%Y"),
            end_deal_date=end_date.strftime("%d.%m.%Y"),
            filial_code=payload.filial_code,
            export_url=orikzor_export_url,
        )
        created, updated, skipped, _errors = import_orders(
            db, response.items, order_source=payload.order_source
        )
        if is_orikzor:
            logger = logging.getLogger(__name__)
            logger.info(
                "O'rikzor sync: created=%s updated=%s skipped=%s items_from_api=%s",
                created, updated, skipped, len(response.items),
            )
        return SmartupSyncResponse(created=created, updated=updated, skipped=skipped)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Smartup export failed: {exc}") from exc


@router.post("/{order_id}/send-to-picking", response_model=SendToPickingResponse, summary="Send order to picking")
async def send_order_to_picking(
    request: Request,
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

    if order.status not in {"imported", "B#S", "ready_for_picking", "allocated"}:
        raise HTTPException(status_code=409, detail="Order cannot be sent to picking")

    if not order.lines:
        raise HTTPException(status_code=409, detail="Order has no lines")

    existing = db.query(DocumentModel).filter(DocumentModel.order_id == order.id).one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Picking task already created")

    assigned_user = db.query(User).filter(User.id == payload.assigned_to_user_id).one_or_none()
    if not assigned_user or assigned_user.role != "picker":
        raise HTTPException(status_code=400, detail="Invalid picker selection")

    document_lines, shortages = _allocate_order(db, order, user.id)
    if not document_lines:
        raise HTTPException(status_code=409, detail="Insufficient stock to allocate")

    document = DocumentModel(
        doc_no=order.order_number,
        doc_type="SO",
        status="partial" if shortages else "new",
        source="orders",
        source_external_id=order.source_external_id,
        order_id=order.id,
        assigned_to_user_id=payload.assigned_to_user_id,
    )
    document.lines = document_lines

    db.add(document)
    old_status = order.status
    order.status = "allocated"
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="order",
        entity_id=str(order_id),
        old_data={"status": old_status},
        new_data={"status": "allocated", "document_id": str(document.id)},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(document)

    try:
        send_push_to_user(
            db,
            payload.assigned_to_user_id,
            "Yangi buyurtma",
            f"Terish buyurtmasi: {document.doc_no}. Ilovani oching.",
            data={"taskId": str(document.id), "type": "new_pick_task"},
        )
    except Exception:
        pass

    return SendToPickingResponse(pick_task_id=document.id, assigned_to=payload.assigned_to_user_id)


@router.post("/{order_id}/pack", response_model=OrderDetails, summary="Mark order as packed")
async def pack_order(
    request: Request,
    order_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_permission("documents:edit_status")),
):
    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.lines))
        .filter(OrderModel.id == order_id)
        .one_or_none()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status not in ("picked", "completed"):
        raise HTTPException(status_code=409, detail="Order must be picked or completed before packing")

    document = (
        db.query(DocumentModel)
        .filter(DocumentModel.order_id == order.id)
        .one_or_none()
    )
    if document and document.status not in ("picked", "completed"):
        raise HTTPException(status_code=409, detail="Picking document must be picked or completed")

    old_status = order.status
    order.status = "packed"
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="order",
        entity_id=str(order_id),
        old_data={"status": old_status},
        new_data={"status": "packed"},
        ip_address=get_client_ip(request),
    )
    db.commit()
    return _to_order_details(order)


@router.post("/{order_id}/ship", response_model=OrderDetails, summary="Ship order")
async def ship_order(
    request: Request,
    order_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
    _guard=Depends(require_permission("documents:edit_status")),
):
    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.lines))
        .filter(OrderModel.id == order_id)
        .one_or_none()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "packed":
        raise HTTPException(status_code=409, detail="Order must be packed before shipping")

    document = (
        db.query(DocumentModel)
        .options(selectinload(DocumentModel.lines))
        .filter(DocumentModel.order_id == order.id)
        .one_or_none()
    )
    if not document or not document.lines:
        raise HTTPException(status_code=409, detail="Picking document not found")

    existing_ship = (
        db.query(StockMovementModel.id)
        .filter(
            StockMovementModel.movement_type == "ship",
            StockMovementModel.source_document_type == "order",
            StockMovementModel.source_document_id == order.id,
        )
        .first()
    )
    if existing_ship:
        raise HTTPException(status_code=409, detail="Order already shipped")

    shipped_any = False
    for line in document.lines:
        if line.picked_qty <= 0:
            continue
        if not line.product_id or not line.lot_id or not line.location_id:
            raise HTTPException(status_code=409, detail="Picking line missing allocation details")
        shipped_any = True
        db.add(
            StockMovementModel(
                product_id=line.product_id,
                lot_id=line.lot_id,
                location_id=line.location_id,
                qty_change=-Decimal(str(line.picked_qty)),
                movement_type="ship",
                source_document_type="order",
                source_document_id=order.id,
                created_by_user_id=user.id,
            )
        )

    if not shipped_any:
        raise HTTPException(status_code=409, detail="No picked quantities to ship")

    old_status = order.status
    order.status = "shipped"
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="order",
        entity_id=str(order_id),
        old_data={"status": old_status},
        new_data={"status": "shipped"},
        ip_address=get_client_ip(request),
    )
    db.commit()
    return _to_order_details(order)
