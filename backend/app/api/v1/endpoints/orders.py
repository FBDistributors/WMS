from __future__ import annotations

import logging
import os
from datetime import date, timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Query, status

from app.core.expiry import first_day_of_current_month, min_expiry_date_from_months
from app.services.vip_service import get_vip_customer_expiry_months
from pydantic import BaseModel, Field
from decimal import Decimal
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import get_current_user, require_any_permission, require_permission
from app.db import get_db
from app.services.audit_service import ACTION_CREATE, ACTION_UPDATE, get_client_ip, log_action
from app.services.push_notifications import send_push_to_user
from app.integrations.smartup.client import SmartupClient
from app.integrations.smartup.importer import delete_stale_orders, filter_orders_b_w, import_orders
from app.integrations.smartup.mfm_movement import export_mfm_movements
from app.integrations.smartup.sync_lock import smartup_sync_lock
from app.models.document import Document as DocumentModel
from app.models.document import DocumentLine as DocumentLineModel
from app.models.order import Order as OrderModel
from app.models.order import OrderLine as OrderLineModel
from app.models.order import OrderWmsState as OrderWmsStateModel
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
    "B#W",
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
    has_so: bool = False
    from_warehouse_code: Optional[str] = None
    to_warehouse_code: Optional[str] = None
    movement_note: Optional[str] = None
    delivery_date: Optional[date] = None


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
    from_warehouse_code: Optional[str] = None
    to_warehouse_code: Optional[str] = None
    movement_note: Optional[str] = None
    delivery_date: Optional[date] = None


class OrdersListResponse(BaseModel):
    items: List[OrderListItem]
    total: int
    limit: int
    offset: int


class SmartupSyncRequest(BaseModel):
    begin_deal_date: Optional[date] = Field(None, description="YYYY-MM-DD")
    end_deal_date: Optional[date] = Field(None, description="YYYY-MM-DD")
    filial_code: Optional[str] = None
    filial_id: Optional[str] = None
    order_source: Optional[str] = Field(None, description="diller, orikzor yoki boshqa manba; saqlanadi Order.source da")


class SmartupSyncResponse(BaseModel):
    created: int
    updated: int
    skipped: int
    detail: Optional[str] = None  # birinchi import xatosi
    errors_count: Optional[int] = None  # import xatolari soni
    error: Optional[str] = None  # UI sariq qutida ko'rsatiladigan xato (import exception va h.k.)
    debug: Optional[dict] = None  # raw_count, dict_count, filtered_count, inserted_count, updated_count, skipped_count, skipped_by_reason, preview


class SendToPickingRequest(BaseModel):
    assigned_to_user_id: UUID


class SendToPickingResponse(BaseModel):
    pick_task_id: UUID
    assigned_to: UUID


class MovementItemLine(BaseModel):
    product_code: Optional[str] = None
    quantity: float = Field(..., ge=0)
    name: Optional[str] = None


class MovementPayload(BaseModel):
    movement_id: Optional[str] = None
    barcode: Optional[str] = None
    from_warehouse_code: Optional[str] = None
    to_warehouse_code: Optional[str] = None
    note: Optional[str] = None
    movement_items: List[MovementItemLine] = Field(default_factory=list)


class SendMovementToPickingRequest(BaseModel):
    source: str = Field(..., description="diller yoki orikzor")
    movement_id: str = Field(..., min_length=1)
    movement: MovementPayload
    assigned_to_user_id: UUID


class OrderStatusUpdateRequest(BaseModel):
    status: str = Field(..., description="picked, packed, shipped yoki boshqa ruxsat etilgan status")
    controller_user_id: Optional[UUID] = Field(None, description="Tekshiruvda: controllerga yuborish uchun controller user id")


ALLOWED_ADMIN_ORDER_STATUSES = {"imported", "B#W", "allocated", "ready_for_picking", "picking", "picked", "completed", "packed", "shipped", "cancelled"}


def _normalize_status_for_write(status_value: str) -> str:
    return (status_value or "").strip()


def _expand_status_filters(status_values: list[str]) -> list[str]:
    return list({(s or "").strip() for s in status_values if (s or "").strip()})


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


def _fefo_available_lots(db: Session, product_id: UUID, min_expiry_date: date | None = None):
    filters = [
        StockLotModel.product_id == product_id,
        LocationModel.zone_type == "NORMAL",
        LocationModel.is_active.is_(True),
        (StockLotModel.expiry_date.is_(None) | (StockLotModel.expiry_date >= first_day_of_current_month())),
    ]
    if min_expiry_date is not None:
        filters.append(
            (StockLotModel.expiry_date.is_(None) | (StockLotModel.expiry_date >= min_expiry_date))
        )
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
        .filter(*filters)
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
        status=order.wms_state.status,
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
        from_warehouse_code=getattr(order, "from_warehouse_code", None),
        to_warehouse_code=getattr(order, "to_warehouse_code", None),
        movement_note=getattr(order, "movement_note", None),
        delivery_date=order.delivery_date.date() if getattr(order, "delivery_date", None) else None,
    )


def _allocate_order(
    db: Session,
    order: OrderModel,
    user_id: UUID,
) -> tuple[list[DocumentLineModel], list[AllocationShortage]]:
    shortages: list[AllocationShortage] = []
    document_lines: list[DocumentLineModel] = []

    vip_map = get_vip_customer_expiry_months(db)
    min_expiry_date: date | None = None
    if order.customer_id and order.customer_id in vip_map:
        min_expiry_date = min_expiry_date_from_months(vip_map[order.customer_id])

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

        product = db.get(ProductModel, product_id)
        product_name = (product.name if product else None) or line.name or ""

        remaining = Decimal(str(line.qty))
        allocated_total = Decimal("0")
        available_lots = _fefo_available_lots(db, product_id, min_expiry_date=min_expiry_date)

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
                    product_name=product_name,
                    barcode=line.barcode or (product.barcode if product else None),
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
    brand_ids: Optional[str] = Query(None, description="Filter by brands: comma-separated UUIDs (orders that contain products of any of these brands)"),
    order_source: Optional[str] = Query(None, description="diller, orikzor va h.k. — Order.source bo'yicha filtrlash"),
    search_fields: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500, description="Max items per page (tashkiliy harakat API bilan bir xil)"),
    offset: int = Query(0, ge=0, description="Skip N items"),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:read")),
):
    # List uchun lines yuklanmaydi; faqat wms_state. lines_total keyin alohida count querydan olinadi.
    query = db.query(OrderModel).options(selectinload(OrderModel.wms_state))

    if order_source and order_source.strip():
        query = query.filter(OrderModel.source == order_source.strip())

    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        valid = [s for s in statuses if s in ORDER_STATUSES]
        if not valid:
            raise HTTPException(status_code=400, detail="Invalid status")
        valid = _expand_status_filters(valid)
        query = query.join(OrderWmsStateModel, OrderModel.id == OrderWmsStateModel.order_id)
        if len(valid) == 1:
            query = query.filter(OrderWmsStateModel.status == valid[0])
            # B#W: barcha buyurtmalar ko'rinsin (SO bor bo'lganlar ham); has_so orqali aniqlanadi
        else:
            query = query.filter(OrderWmsStateModel.status.in_(valid))

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
        order_id_from_so = (
            db.query(DocumentModel.order_id)
            .filter(
                DocumentModel.doc_type == "SO",
                DocumentModel.order_id.isnot(None),
                DocumentModel.doc_no.ilike(term),
            )
            .distinct()
            .all()
        )
        order_ids_so = [r[0] for r in order_id_from_so if r[0]]
        if order_ids_so:
            query = query.filter(
                or_(
                    *[field.ilike(term) for field in fields],
                    OrderModel.id.in_(order_ids_so),
                )
            )
        else:
            query = query.filter(or_(*[field.ilike(term) for field in fields]))

    # Filial filter: order_source berilganda filial default qo‘llanmaydi (manba bo‘yicha filtr yetarli)
    if filial_id and filial_id.strip() and filial_id.strip().lower() == "all":
        pass  # Barcha filiallar (Buyurtma statuslari sahifasi)
    elif filial_id and filial_id.strip():
        query = query.filter(OrderModel.filial_id == filial_id.strip())
    elif not (order_source and order_source.strip()):
        default_filial = os.getenv("WMS_DEFAULT_FILIAL_ID", "3788131").strip()
        if default_filial:
            query = query.filter(OrderModel.filial_id == default_filial)

    # Sana filtri — Yetkazib berish sanasi (delivery_date) bo'yicha
    if date_from:
        query = query.filter(func.date(OrderModel.delivery_date) >= date_from)
    if date_to:
        query = query.filter(func.date(OrderModel.delivery_date) <= date_to)

    if brand_ids and brand_ids.strip():
        try:
            brand_id_list = [UUID(b.strip()) for b in brand_ids.split(",") if b.strip()]
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid brand_ids")
        if brand_id_list:
            query = (
                query.join(OrderLineModel, OrderModel.id == OrderLineModel.order_id)
                .join(ProductModel, OrderLineModel.sku == ProductModel.sku)
                .filter(ProductModel.brand_id.in_(brand_id_list))
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
    else:
        total = (
            query.with_entities(func.count(OrderModel.id))
            .order_by(None)
            .scalar()
            or 0
        )
        orders = query.order_by(OrderModel.created_at.desc()).offset(offset).limit(limit).all()

    order_ids = [o.id for o in orders]
    # Ro'yxat uchun lines_total: bitta GROUP BY query (lines list yuklanmagan)
    lines_by_order: dict[UUID, int] = {}
    if order_ids:
        lines_rows = (
            db.query(OrderLineModel.order_id, func.count(OrderLineModel.id))
            .filter(OrderLineModel.order_id.in_(order_ids))
            .group_by(OrderLineModel.order_id)
            .all()
        )
        lines_by_order = {r[0]: r[1] for r in lines_rows}
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
        has_so = doc is not None
        items.append(
            OrderListItem(
                id=order.id,
                order_number=order.order_number,
                source_external_id=order.source_external_id,
                status=order.wms_state.status,
                filial_id=order.filial_id,
                customer_id=order.customer_id,
                customer_name=order.customer_name,
                agent_id=order.agent_id,
                agent_name=order.agent_name,
                total_amount=order.total_amount,
                created_at=order.created_at.date(),
                lines_total=lines_by_order.get(order.id, 0),
                from_warehouse_code=getattr(order, "from_warehouse_code", None),
                to_warehouse_code=getattr(order, "to_warehouse_code", None),
                movement_note=getattr(order, "movement_note", None),
                picker_name=_picker_name(doc),
                controller_name=_controller_name(doc),
                is_incomplete=is_incomplete,
                has_so=has_so,
                delivery_date=order.delivery_date.date() if getattr(order, "delivery_date", None) else None,
            )
        )

    return OrdersListResponse(items=items, total=total, limit=limit, offset=offset)


class OrderCheckMatch(BaseModel):
    id: UUID
    order_number: str
    source_external_id: Optional[str] = None
    filial_id: Optional[str] = None


class OrderCheckResponse(BaseModel):
    total_b_s: int
    total_b_s_all_filial: int
    match_by_order_number: List[OrderCheckMatch]
    match_by_source_external_id: List[OrderCheckMatch]
    match_by_so_doc_no: List[dict]


@router.get("/check", response_model=OrderCheckResponse, summary="Baza va jadval yuklashni tekshirish (qidiruv natijasi)")
async def orders_check(
    q: Optional[str] = Query(None, description="Qidiruv so'zi (masalan 86918 yoki 233898517)"),
    filial_id: Optional[str] = Query(None, description="Filial ID (bo'sh = default 3788131, 'all' = barcha)"),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:read")),
):
    """Bazada B#W soni va q bo'yicha topiladigan buyurtmalarni ko'rsatadi. Jadval ro'yxati bilan solishtirish uchun."""
    default_filial = os.getenv("WMS_DEFAULT_FILIAL_ID", "3788131").strip()
    filial = (filial_id or "").strip() or default_filial
    base = db.query(OrderModel).join(OrderWmsStateModel, OrderModel.id == OrderWmsStateModel.order_id)
    total_b_s_all_filial = base.filter(OrderWmsStateModel.status == "B#W").count()
    total_b_s = (
        base.filter(OrderWmsStateModel.status == "B#W")
        .filter(OrderModel.filial_id == filial)
        .count()
    )
    if filial_id and str(filial_id).strip().lower() == "all":
        total_b_s = total_b_s_all_filial

    def to_match(o: OrderModel) -> OrderCheckMatch:
        return OrderCheckMatch(
            id=o.id,
            order_number=o.order_number,
            source_external_id=o.source_external_id,
            filial_id=o.filial_id,
        )

    match_by_order_number: List[OrderCheckMatch] = []
    match_by_source_external_id: List[OrderCheckMatch] = []
    match_by_so_doc_no: List[dict] = []

    if q and q.strip():
        term = f"%{q.strip()}%"
        by_order = (
            db.query(OrderModel)
            .join(OrderWmsStateModel, OrderModel.id == OrderWmsStateModel.order_id)
            .filter(OrderWmsStateModel.status == "B#W", OrderModel.order_number.ilike(term))
            .limit(10)
            .all()
        )
        match_by_order_number = [to_match(o) for o in by_order]
        by_ext = (
            db.query(OrderModel)
            .join(OrderWmsStateModel, OrderModel.id == OrderWmsStateModel.order_id)
            .filter(OrderWmsStateModel.status == "B#W", OrderModel.source_external_id.ilike(term))
            .limit(10)
            .all()
        )
        match_by_source_external_id = [to_match(o) for o in by_ext]
        so_docs = (
            db.query(DocumentModel.order_id, DocumentModel.doc_no, OrderModel.order_number)
            .join(OrderModel, DocumentModel.order_id == OrderModel.id)
            .filter(DocumentModel.doc_type == "SO", DocumentModel.doc_no.ilike(term))
            .limit(10)
            .all()
        )
        match_by_so_doc_no = [
            {"order_id": str(r[0]), "doc_no": r[1], "order_number": r[2]} for r in so_docs
        ]

    return OrderCheckResponse(
        total_b_s=total_b_s,
        total_b_s_all_filial=total_b_s_all_filial,
        match_by_order_number=match_by_order_number,
        match_by_source_external_id=match_by_source_external_id,
        match_by_so_doc_no=match_by_so_doc_no,
    )


@router.get("/pickers", response_model=List[PickerUser], summary="List picker users")
async def list_picker_users(
    db: Session = Depends(get_db),
    _user=Depends(require_any_permission(["picking:assign", "orders:send_to_picking"])),
):
    users = db.query(User).filter(User.role == "picker", User.is_active.is_(True)).order_by(User.full_name, User.username).all()
    return [PickerUser(id=user.id, name=user.full_name or user.username) for user in users]


class ControllerUser(BaseModel):
    id: UUID
    name: str


@router.get("/controllers", response_model=List[ControllerUser], summary="List controller users")
async def list_controller_users(
    db: Session = Depends(get_db),
    _user=Depends(require_permission("documents:edit_status")),
):
    users = (
        db.query(User)
        .filter(User.role == "inventory_controller", User.is_active.is_(True))
        .order_by(User.full_name, User.username)
        .all()
    )
    return [ControllerUser(id=user.id, name=user.full_name or user.username) for user in users]


@router.get("/{order_id}", response_model=OrderDetails, summary="Get order")
async def get_order(
    order_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:read")),
):
    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.lines), selectinload(OrderModel.wms_state))
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
    normalized_status = _normalize_status_for_write(payload.status)
    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.lines), selectinload(OrderModel.wms_state))
        .filter(OrderModel.id == order_id)
        .one_or_none()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    old_status = order.wms_state.status
    order.wms_state.status = normalized_status

    if normalized_status == "picked" and payload.controller_user_id is not None:
        doc = (
            db.query(DocumentModel)
            .filter(DocumentModel.order_id == order.id, DocumentModel.doc_type == "SO")
            .one_or_none()
        )
        if doc:
            controller_user = (
                db.query(User)
                .filter(
                    User.id == payload.controller_user_id,
                    User.role == "inventory_controller",
                    User.is_active.is_(True),
                )
                .one_or_none()
            )
            if not controller_user:
                raise HTTPException(status_code=400, detail="Invalid controller")
            doc.controlled_by_user_id = payload.controller_user_id

    if normalized_status == "completed":
        doc = (
            db.query(DocumentModel)
            .filter(DocumentModel.order_id == order.id, DocumentModel.doc_type == "SO")
            .one_or_none()
        )
        if doc:
            doc.status = "completed"

    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="order",
        entity_id=str(order_id),
        old_data={"status": old_status},
        new_data={"status": normalized_status},
        ip_address=get_client_ip(request),
    )
    db.commit()
    return _to_order_details(order)


@router.post("/sync-smartup", response_model=SmartupSyncResponse, summary="Sync orders from Smartup (Cross-organizational movement)")
async def sync_orders_from_smartup(
    payload: SmartupSyncRequest,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:sync")),
):
    if payload.order_source == "orikzor":
        raise HTTPException(
            status_code=400,
            detail="O'rikzor harakatlari alohida API. GET /api/v1/movements-orikzor dan foydalaning. Sync buyurtmalar jadvaliga yozilmaydi.",
        )
    if payload.order_source == "diller":
        raise HTTPException(
            status_code=400,
            detail="Tashkiliy harakatlar uchun GET /api/v1/movements dan foydalaning. Sync buyurtmalar jadvaliga yozilmaydi.",
        )
    today = date.today()
    if payload.order_source == "diller" and payload.begin_deal_date is None and payload.end_deal_date is None:
        begin_date = today - timedelta(days=30)
        end_date = today
    elif payload.begin_deal_date is None and payload.end_deal_date is None:
        # SmartUP buyurtmalar: default oxirgi 7 kun
        begin_date = today - timedelta(days=7)
        end_date = today
    else:
        begin_date = payload.begin_deal_date or today
        end_date = payload.end_deal_date or today
    if begin_date > end_date:
        raise HTTPException(status_code=400, detail="begin_deal_date must be <= end_deal_date")

    with smartup_sync_lock(db) as acquired:
        if not acquired:
            raise HTTPException(
                status_code=409,
                detail="SmartUp sync already in progress (worker or another request). Try again later.",
            )
        try:
            if payload.order_source == "diller":
                # Tashkiliy harakat: cross-organizational movement (mfm movement$export), order'dan emas
                response = export_mfm_movements(
                    begin_date=begin_date,
                    end_date=end_date,
                    filial_id=(payload.filial_id or "").strip() or None,
                )
                filial_override = (payload.filial_id or "").strip() or None
                items_to_import = response.items
            else:
                # Oddiy buyurtmalar: order$export (savdo buyurtmalari). Oxirgi 7 kun o'zgartirilganlari (modified_on).
                client = SmartupClient(filial_id=(payload.filial_id or "").strip() or None)
                response = client.export_orders(
                    begin_deal_date=begin_date.strftime("%d.%m.%Y"),
                    end_deal_date=end_date.strftime("%d.%m.%Y"),
                    filial_code=payload.filial_code,
                    begin_modified_on=begin_date.strftime("%d.%m.%Y"),
                    end_modified_on=end_date.strftime("%d.%m.%Y"),
                )
                filial_override = (payload.filial_id or "").strip() or None
                items_to_import = filter_orders_b_w(response.items)
            created, updated, skipped, import_errors, _ = import_orders(
                db, items_to_import, order_source=payload.order_source, filial_id_override=filial_override
            )
            if payload.order_source != "diller":
                delete_stale_orders(db, list(items_to_import))
            detail = import_errors[0].reason if import_errors else None
            errors_count = len(import_errors) if import_errors else None
            return SmartupSyncResponse(
                created=created, updated=updated, skipped=skipped, detail=detail, errors_count=errors_count
            )
        except RuntimeError as exc:
            msg = str(exc)
            if "400" in msg or "не найдена" in msg or "organization" in msg.lower():
                raise HTTPException(status_code=400, detail=msg) from exc
            raise HTTPException(status_code=500, detail=msg) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Smartup export failed: {exc}") from exc


def _get_or_create_order_from_movement(
    db: Session,
    source: str,
    movement_id: str,
    movement: MovementPayload,
) -> OrderModel:
    """Movement dan Order topadi yoki yaratadi. source_external_id = movement:{movement_id} (max 128)."""
    external_id = f"movement:{movement_id}"[:128]
    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.lines))
        .filter(OrderModel.source_external_id == external_id)
        .one_or_none()
    )
    if order:
        return order
    if not movement.movement_items:
        raise HTTPException(status_code=400, detail="movement_items bo'sh bo'lmasligi kerak")
    order = OrderModel(
        source=source.strip(),
        source_external_id=external_id,
        order_number=movement_id[:64],
        from_warehouse_code=(movement.from_warehouse_code or "")[:64] or None,
        to_warehouse_code=(movement.to_warehouse_code or "")[:64] or None,
        movement_note=(movement.note or "")[:512] or None,
    )
    order.wms_state = OrderWmsStateModel(status="B#W")
    db.add(order)
    db.flush()
    for item in movement.movement_items:
        sku = (item.product_code or "").strip() or None
        name = (item.name or item.product_code or "").strip()[:255] or "—"
        line = OrderLineModel(
            order_id=order.id,
            sku=sku,
            name=name,
            qty=float(item.quantity),
        )
        db.add(line)
    db.flush()
    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.lines))
        .filter(OrderModel.id == order.id)
        .one()
    )
    return order


@router.post("/from-movement/send-to-picking", response_model=SendToPickingResponse, summary="Send movement (Tashkiliy/O'rikzor) to picking")
async def send_movement_to_picking(
    request: Request,
    payload: SendMovementToPickingRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:send_to_picking")),
):
    if "picking:assign" not in get_permissions_for_role(user.role):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    if payload.source.strip().lower() not in ("diller", "orikzor"):
        raise HTTPException(status_code=400, detail="source diller yoki orikzor bo'lishi kerak")
    if not payload.movement.movement_items:
        raise HTTPException(status_code=400, detail="movement_items bo'sh bo'lmasligi kerak")
    assigned_user = db.query(User).filter(User.id == payload.assigned_to_user_id).one_or_none()
    if not assigned_user or assigned_user.role != "picker":
        raise HTTPException(status_code=400, detail="Invalid picker selection")

    try:
        order = _get_or_create_order_from_movement(
            db, payload.source.strip(), payload.movement_id.strip(), payload.movement
        )
    except HTTPException:
        raise
    db.refresh(order)
    if not order.lines:
        raise HTTPException(status_code=409, detail="Order has no lines")

    existing = db.query(DocumentModel).filter(DocumentModel.order_id == order.id).one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Picking task already created")

    if order.wms_state.status not in {"imported", "B#W", "ready_for_picking", "allocated"}:
        raise HTTPException(status_code=409, detail="Order cannot be sent to picking")

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
    old_status = order.wms_state.status
    order.wms_state.status = "allocated"
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="order",
        entity_id=str(order.id),
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
        .options(selectinload(OrderModel.lines), selectinload(OrderModel.wms_state))
        .filter(OrderModel.id == order_id)
        .one_or_none()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.wms_state.status not in {"imported", "B#W", "ready_for_picking", "allocated"}:
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
    old_status = order.wms_state.status
    order.wms_state.status = "allocated"
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
        .options(selectinload(OrderModel.lines), selectinload(OrderModel.wms_state))
        .filter(OrderModel.id == order_id)
        .one_or_none()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.wms_state.status not in ("picked", "completed"):
        raise HTTPException(status_code=409, detail="Order must be picked or completed before packing")

    document = (
        db.query(DocumentModel)
        .filter(DocumentModel.order_id == order.id)
        .one_or_none()
    )
    if document and document.status not in ("picked", "completed"):
        raise HTTPException(status_code=409, detail="Picking document must be picked or completed")

    old_status = order.wms_state.status
    order.wms_state.status = "packed"
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
        .options(selectinload(OrderModel.lines), selectinload(OrderModel.wms_state))
        .filter(OrderModel.id == order_id)
        .one_or_none()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.wms_state.status != "packed":
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

    old_status = order.wms_state.status
    order.wms_state.status = "shipped"
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
