from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any, List, Optional
import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Query, status
from fastapi.responses import JSONResponse

from app.core.expiry import first_day_of_current_month, min_expiry_date_from_months
from app.services.stock_availability import (
    PHYSICAL_ON_HAND_MOVEMENT_TYPES,
    compute_lot_location_available,
    lock_lot_location,
    require_sufficient_available,
)
from app.services.vip_service import resolve_vip_min_expiry_months
from pydantic import BaseModel, Field
from decimal import Decimal
from sqlalchemy import and_, case, exists, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import get_current_user, require_any_permission, require_permission, require_role
from app.db import get_db
from app.services.audit_service import ACTION_CREATE, ACTION_DELETE, ACTION_UPDATE, get_client_ip, log_action
from app.services.push_notifications import send_push_to_user
from app.services.safe_cancel_return_service import initiate_safe_cancel_return
from app.integrations.smartup.client import SmartupClient
from app.integrations.smartup.importer import delete_stale_orders, import_orders
from app.integrations.smartup.mfm_movement import (
    export_mfm_movements,
    resolve_movement_export_date_range,
    _mfm_send_status_in_export_body,
)
from app.integrations.smartup.orikzor import export_movements_from_smartup
from app.integrations.smartup.sync_lock import diller_sync_lock, orikzor_sync_lock, smartup_sync_lock
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
from app.models.idempotency_key import IdempotencyKey as IdempotencyKeyModel
from app.auth.permissions import get_permissions_for_role
from app.models.user import User
from app.constants.order_wms_status import (
    CANONICAL_ORDER_WMS_STATUSES,
    normalize_list_status_filter_token,
    normalize_order_wms_status_for_storage,
)
from app.services.order_transition_policy import get_transition_rule

router = APIRouter()
logger = logging.getLogger(__name__)
_IDEMPOTENCY_TTL_HOURS = 24

# Barcha DB da uchraydigan WMS statuslar (canonical)
ORDER_STATUSES = CANONICAL_ORDER_WMS_STATUSES


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
    so_document_status: Optional[str] = Field(None, description="SO terish hujjati statusi (bo'lsa)")
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
    lines_editable: bool = Field(
        False,
        description="Terish hujjati yaratilmaguncha qatorlarni tahrirlash mumkin",
    )


class OrderLineCreateBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    qty: float = Field(..., gt=0)
    sku: Optional[str] = Field(None, max_length=64)
    barcode: Optional[str] = Field(None, max_length=64)
    uom: Optional[str] = Field(None, max_length=32)


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
    delivery_number: Optional[str] = Field(None, max_length=64)
    movement_items: List[MovementItemLine] = Field(default_factory=list)


class SendMovementToPickingRequest(BaseModel):
    source: str = Field(..., description="diller yoki orikzor")
    movement_id: str = Field(..., min_length=1)
    movement: MovementPayload
    assigned_to_user_id: UUID


class EnsureMovementOrderRequest(BaseModel):
    """Tashkiliy/O'rikzor harakati uchun DB da Order (movement:{{id}}) yaratish yoki mavjudini qaytarish."""

    source: str = Field(..., description="diller yoki orikzor")
    movement_id: str = Field(..., min_length=1)
    movement: MovementPayload


class OrderStatusUpdateRequest(BaseModel):
    status: str = Field(..., description="picked, packed, shipped yoki boshqa ruxsat etilgan status")
    controller_user_id: Optional[UUID] = Field(None, description="Tekshiruvda: controllerga yuborish uchun controller user id")


ALLOWED_ADMIN_ORDER_STATUSES = frozenset(
    {
        "imported",
        "allocated",
        "picking",
        "picked",
        "completed",
        "packed",
        "shipped",
        "cancelled",
    }
)


def _normalize_status_for_write(status_value: str) -> str:
    return (status_value or "").strip()


def _idempotency_payload_hash(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _run_with_idempotency(
    *,
    db: Session,
    user_id: UUID,
    key: str | None,
    scope: str,
    payload: dict[str, Any],
    expected_status: int,
    run: callable,
):
    if key is None or not key.strip():
        return run()

    clean_key = key.strip()
    req_hash = _idempotency_payload_hash(payload)
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    existing = (
        db.query(IdempotencyKeyModel)
        .filter(
            IdempotencyKeyModel.scope == scope,
            IdempotencyKeyModel.user_id == user_id,
            IdempotencyKeyModel.key == clean_key,
        )
        .one_or_none()
    )
    if existing is not None and existing.expires_at >= now_utc:
        if existing.request_hash != req_hash:
            raise HTTPException(status_code=409, detail="Idempotency-Key already used with different payload")
        if existing.response_status == 0 or not existing.response_body:
            raise HTTPException(status_code=409, detail="Duplicate request in progress. Try again.")
        return JSONResponse(status_code=existing.response_status, content=json.loads(existing.response_body))
    if existing is not None and existing.expires_at < now_utc:
        db.delete(existing)
        db.flush()

    idem = IdempotencyKeyModel(
        key=clean_key,
        scope=scope,
        user_id=user_id,
        request_hash=req_hash,
        response_status=0,
        response_body="",
        expires_at=now_utc + timedelta(hours=_IDEMPOTENCY_TTL_HOURS),
    )
    db.add(idem)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Duplicate request in progress. Try again.")

    result = run()
    if isinstance(result, BaseModel):
        body = result.model_dump(mode="json")
    else:
        body = result
    idem.response_status = expected_status
    idem.response_body = json.dumps(body, ensure_ascii=False, default=str)
    db.commit()
    return JSONResponse(status_code=expected_status, content=body)


def _reject_transition(
    *,
    request: Request,
    db: Session,
    user_id: UUID,
    order_id: UUID,
    from_status: str,
    to_status: str,
    reason: str,
):
    log_action(
        db,
        user_id=user_id,
        action=ACTION_UPDATE,
        entity_type="order",
        entity_id=str(order_id),
        old_data={"status": from_status},
        new_data={"status": to_status, "policy_reject": True, "reason": reason},
        ip_address=get_client_ip(request),
    )
    db.commit()
    raise HTTPException(status_code=409, detail=reason)


def _enforce_transition_or_reject(
    *,
    request: Request,
    db: Session,
    user_id: UUID,
    order_id: UUID,
    from_status: str,
    to_status: str,
):
    rule = get_transition_rule(from_status, to_status)
    if rule is None:
        _reject_transition(
            request=request,
            db=db,
            user_id=user_id,
            order_id=order_id,
            from_status=from_status,
            to_status=to_status,
            reason=f"Core-flow transition blocked: {from_status} -> {to_status}",
        )
    return rule


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


class SendToPickingValidationFailure(BaseModel):
    order_id: UUID
    order_number: str = ""
    code: str
    message: Optional[str] = None
    shortages: list[AllocationShortage] = Field(default_factory=list)


class ValidateSendToPickingRequest(BaseModel):
    order_ids: list[UUID] = Field(..., min_length=1, max_length=50)


class ValidateSendToPickingResponse(BaseModel):
    ok: bool
    failures: list[SendToPickingValidationFailure] = Field(default_factory=list)


class _DryRunAllocationEnd(Exception):
    """begin_nested ichida allocate qilib, savepoint ni rollback qilish uchun."""

    __slots__ = ("shortages", "n_lines")

    def __init__(self, shortages: list[AllocationShortage], n_lines: int) -> None:
        self.shortages = shortages
        self.n_lines = n_lines


def _dry_run_allocate_for_order(db: Session, order: OrderModel, user_id: UUID) -> tuple[list[AllocationShortage], int]:
    """_allocate_order ni savepoint ichida chaqiradi, barcha allocate yozuvlarini rollback qiladi."""
    try:
        with db.begin_nested():
            document_lines, shortages = _allocate_order(db, order, user_id)
            raise _DryRunAllocationEnd(shortages, len(document_lines))
    except _DryRunAllocationEnd as e:
        return e.shortages, e.n_lines


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


def _fefo_available_lots(
    db: Session,
    product_id: UUID,
    min_expiry_date: date | None = None,
    zone_types: list[str] | None = None,
    skip_expiry_floor: bool = False,
):
    if zone_types is None:
        zone_types = ["NORMAL"]
    on_hand_expr = func.sum(
        case(
            (
                StockMovementModel.movement_type.in_(PHYSICAL_ON_HAND_MOVEMENT_TYPES),
                StockMovementModel.qty_change,
            ),
            else_=0,
        )
    )
    reserved_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(("allocate", "unallocate")), StockMovementModel.qty_change),
            else_=0,
        )
    )
    filters = [
        StockLotModel.product_id == product_id,
        LocationModel.zone_type.in_(zone_types),
        LocationModel.is_active.is_(True),
    ]
    if not skip_expiry_floor:
        filters.append(
            (StockLotModel.expiry_date.is_(None) | (StockLotModel.expiry_date >= first_day_of_current_month()))
        )
    if min_expiry_date is not None:
        filters.append(
            (StockLotModel.expiry_date.is_(None) | (StockLotModel.expiry_date >= min_expiry_date))
        )
    return (
        db.query(
            StockMovementModel.lot_id,
            StockMovementModel.location_id,
            (func.coalesce(on_hand_expr, 0) - func.coalesce(reserved_expr, 0)).label("qty"),
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
        .having(func.coalesce(on_hand_expr, 0) - func.coalesce(reserved_expr, 0) > 0)
        .order_by(StockLotModel.expiry_date.asc().nullslast(), LocationModel.code.asc())
        .all()
    )


def _physical_can_cover_remaining(
    db: Session,
    product_id: UUID,
    remaining: Decimal,
    alloc_scratch: dict[tuple[UUID, UUID], Decimal],
) -> bool:
    """VIP filtrsiz (lekin _fefo_available_lots umumiy qoidalari) zaxira `remaining` ni qoplaydimi — scratch o'qiladi, o'zgartirilmaydi."""
    if remaining <= 0:
        return True
    got = Decimal("0")
    for lot_row in _fefo_available_lots(db, product_id, min_expiry_date=None):
        available_qty = Decimal(str(lot_row.qty))
        if available_qty <= 0:
            continue
        lk = (lot_row.lot_id, lot_row.location_id)
        lock_lot_location(db, lk[0], lk[1])
        room = alloc_scratch[lk] if lk in alloc_scratch else compute_lot_location_available(db, lk[0], lk[1])
        take = min(available_qty, room)
        if take <= 0:
            continue
        got += take
        if got >= remaining:
            return True
    return False


def _to_order_details(order: OrderModel, db: Session) -> OrderDetails:
    has_pick_doc = (
        db.query(DocumentModel.id).filter(DocumentModel.order_id == order.id).limit(1).first() is not None
    )
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
        lines_editable=not has_pick_doc,
    )


def _allocate_order(
    db: Session,
    order: OrderModel,
    user_id: UUID,
) -> tuple[list[DocumentLineModel], list[AllocationShortage]]:
    shortages: list[AllocationShortage] = []
    document_lines: list[DocumentLineModel] = []
    # Bir tranzaksiyada xuddi shu lot+joyga ikkinchi marta ajratishda "available" DB formula o‘zgarmasligi mumkin;
    # scratch bilan joriy ajratishdan keyin qolgan xonani hisoblaymiz.
    alloc_scratch: dict[tuple[UUID, UUID], Decimal] = {}

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
        brand_id = product.brand_id if product else None
        vip_months = resolve_vip_min_expiry_months(db, order.customer_id, brand_id)
        min_expiry_date = min_expiry_date_from_months(vip_months) if vip_months > 0 else None

        remaining = Decimal(str(line.qty))
        allocated_total = Decimal("0")
        is_promo = (getattr(line, "line_source", None) or "product") in ("gift", "action")

        if is_promo:
            lot_phases = [
                _fefo_available_lots(db, product_id, min_expiry_date=min_expiry_date, zone_types=["EXPIRED"], skip_expiry_floor=True),
                _fefo_available_lots(db, product_id, min_expiry_date=min_expiry_date),
            ]
        else:
            lot_phases = [
                _fefo_available_lots(db, product_id, min_expiry_date=min_expiry_date),
            ]

        for available_lots in lot_phases:
            if remaining <= 0:
                break
            for lot_row in available_lots:
                if remaining <= 0:
                    break
                available_qty = Decimal(str(lot_row.qty))
                if available_qty <= 0:
                    continue
                lk = (lot_row.lot_id, lot_row.location_id)
                lock_lot_location(db, lk[0], lk[1])
                if lk not in alloc_scratch:
                    alloc_scratch[lk] = compute_lot_location_available(db, lk[0], lk[1])
                room = alloc_scratch[lk]
                allocate_qty = min(available_qty, remaining, room)
                if allocate_qty <= 0:
                    continue
                alloc_scratch[lk] -= allocate_qty

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
                        is_vip_expiry_informational=False,
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
            remaining_need = Decimal(str(line.qty)) - allocated_total
            if (
                vip_months > 0
                and _physical_can_cover_remaining(db, product_id, remaining_need, alloc_scratch)
            ):
                document_lines.append(
                    DocumentLineModel(
                        product_id=product_id,
                        lot_id=None,
                        location_id=None,
                        sku=line.sku,
                        product_name=product_name,
                        barcode=line.barcode or (product.barcode if product else None),
                        location_code="",
                        batch=None,
                        expiry_date=None,
                        required_qty=float(remaining_need),
                        picked_qty=0,
                        is_vip_expiry_informational=True,
                    )
                )
            else:
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
    created_from: Optional[datetime] = Query(None, description="Order created_at >= timestamp (ISO datetime)"),
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
    filter_finalized_so_for_main = False

    if order_source and order_source.strip():
        query = query.filter(OrderModel.source == order_source.strip())

    if status:
        statuses = [normalize_list_status_filter_token(s) for s in status.split(",") if s.strip()]
        valid = [s for s in statuses if s in ORDER_STATUSES]
        if not valid:
            raise HTTPException(status_code=400, detail="Invalid status")
        valid = _expand_status_filters(valid)
        filter_finalized_so_for_main = (
            bool(order_source and order_source.strip().lower() == "smartup")
            and "imported" in valid
        )
        query = query.join(OrderWmsStateModel, OrderModel.id == OrderWmsStateModel.order_id)
        if len(valid) == 1:
            query = query.filter(OrderWmsStateModel.status == valid[0])
            # imported: barcha yangi navbat buyurtmalar (SO bor bo'lganlar ham); has_so orqali aniqlanadi
        else:
            query = query.filter(OrderWmsStateModel.status.in_(valid))

    if filter_finalized_so_for_main:
        query = query.filter(
            ~exists().where(
                and_(
                    DocumentModel.order_id == OrderModel.id,
                    DocumentModel.doc_type == "SO",
                    DocumentModel.status != "cancelled",
                )
            )
        )

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

    if created_from:
        query = query.filter(OrderModel.created_at >= created_from)

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
        so_doc_status = doc.status if doc else None
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
                so_document_status=so_doc_status,
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
    """Bazada imported (yangi navbat) soni va q bo'yicha topiladigan buyurtmalarni ko'rsatadi."""
    default_filial = os.getenv("WMS_DEFAULT_FILIAL_ID", "3788131").strip()
    filial = (filial_id or "").strip() or default_filial
    base = db.query(OrderModel).join(OrderWmsStateModel, OrderModel.id == OrderWmsStateModel.order_id)
    total_b_s_all_filial = base.filter(OrderWmsStateModel.status == "imported").count()
    total_b_s = (
        base.filter(OrderWmsStateModel.status == "imported")
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
            .filter(OrderWmsStateModel.status == "imported", OrderModel.order_number.ilike(term))
            .limit(10)
            .all()
        )
        match_by_order_number = [to_match(o) for o in by_order]
        by_ext = (
            db.query(OrderModel)
            .join(OrderWmsStateModel, OrderModel.id == OrderWmsStateModel.order_id)
            .filter(OrderWmsStateModel.status == "imported", OrderModel.source_external_id.ilike(term))
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
    return _to_order_details(order, db)


def _assert_order_lines_editable(db: Session, order_id: UUID) -> OrderModel:
    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.lines), selectinload(OrderModel.wms_state))
        .filter(OrderModel.id == order_id)
        .one_or_none()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    existing_doc = (
        db.query(DocumentModel.id).filter(DocumentModel.order_id == order.id).limit(1).first()
    )
    if existing_doc is not None:
        raise HTTPException(
            status_code=409,
            detail="Terish vazifasi yaratilgan; buyurtma qatorlarini o'zgartirib bo'lmaydi.",
        )
    return order


@router.post(
    "/{order_id}/lines",
    response_model=OrderDetails,
    summary="Admin: buyurtmaga qator qo'shish (terish hujjati yo'q bo'lsa)",
)
async def add_order_line(
    request: Request,
    order_id: UUID,
    payload: OrderLineCreateBody,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:write")),
):
    order = _assert_order_lines_editable(db, order_id)
    sku = (payload.sku or "").strip() or None
    barcode = (payload.barcode or "").strip() or None
    name = (payload.name or "").strip()
    uom = (payload.uom or "").strip() or None
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    new_line = OrderLineModel(
        id=uuid.uuid4(),
        order_id=order.id,
        sku=sku,
        barcode=barcode,
        name=name,
        qty=float(payload.qty),
        uom=uom,
        raw_json=None,
    )
    db.add(new_line)
    log_action(
        db,
        user_id=user.id,
        action=ACTION_CREATE,
        entity_type="order_line",
        entity_id=str(new_line.id),
        new_data={
            "order_id": str(order.id),
            "name": name,
            "qty": payload.qty,
            "sku": sku,
            "barcode": barcode,
        },
        ip_address=get_client_ip(request),
    )
    db.commit()
    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.lines), selectinload(OrderModel.wms_state))
        .filter(OrderModel.id == order_id)
        .one()
    )
    return _to_order_details(order, db)


@router.delete(
    "/{order_id}/lines/{line_id}",
    response_model=OrderDetails,
    summary="Admin: buyurtma qatorini o'chirish (terish hujjati yo'q bo'lsa)",
)
async def delete_order_line(
    request: Request,
    order_id: UUID,
    line_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:write")),
):
    order = _assert_order_lines_editable(db, order_id)
    line = (
        db.query(OrderLineModel)
        .filter(OrderLineModel.id == line_id, OrderLineModel.order_id == order.id)
        .one_or_none()
    )
    if not line:
        raise HTTPException(status_code=404, detail="Line not found")
    log_action(
        db,
        user_id=user.id,
        action=ACTION_DELETE,
        entity_type="order_line",
        entity_id=str(line_id),
        old_data={"order_id": str(order.id), "name": line.name, "qty": line.qty},
        ip_address=get_client_ip(request),
    )
    db.delete(line)
    db.commit()
    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.lines), selectinload(OrderModel.wms_state))
        .filter(OrderModel.id == order_id)
        .one()
    )
    return _to_order_details(order, db)


@router.patch("/{order_id}/status", response_model=OrderDetails, summary="Admin: buyurtma statusini o'zgartirish")
async def update_order_status(
    request: Request,
    order_id: UUID,
    payload: OrderStatusUpdateRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role(["warehouse_admin"])),
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

    if normalized_status == "cancelled":
        doc_so = (
            db.query(DocumentModel)
            .options(selectinload(DocumentModel.lines))
            .filter(DocumentModel.order_id == order.id, DocumentModel.doc_type == "SO")
            .one_or_none()
        )
        if (
            doc_so
            and old_status == "picking"
            and any(float(ln.picked_qty or 0) > 0 for ln in doc_so.lines)
        ):
            _enforce_transition_or_reject(
                request=request,
                db=db,
                user_id=user.id,
                order_id=order_id,
                from_status=old_status,
                to_status="cancelling_in_progress",
            )
            session = initiate_safe_cancel_return(db, order=order, document=doc_so, admin_user_id=user.id)
            if doc_so.assigned_to_user_id:
                send_push_to_user(
                    db,
                    doc_so.assigned_to_user_id,
                    title="DIQQAT: Buyurtma bekor qilindi",
                    body="Terishni to'xtating va mahsulotlarni joyiga qaytaring.",
                    data={
                        "type": "safe_cancel_return_required",
                        "taskId": str(doc_so.id),
                        "returnSessionId": str(session.id),
                        "orderId": str(order.id),
                    },
                )
            log_action(
                db,
                user_id=user.id,
                action=ACTION_UPDATE,
                entity_type="order",
                entity_id=str(order_id),
                old_data={"status": old_status},
                new_data={
                    "status": "cancelling_in_progress",
                    "note": "safe_cancel_return_initiated",
                },
                ip_address=get_client_ip(request),
            )
            db.commit()
            order = (
                db.query(OrderModel)
                .options(selectinload(OrderModel.lines), selectinload(OrderModel.wms_state))
                .filter(OrderModel.id == order_id)
                .one()
            )
            return _to_order_details(order, db)
        _enforce_transition_or_reject(
            request=request,
            db=db,
            user_id=user.id,
            order_id=order_id,
            from_status=old_status,
            to_status="cancelled",
        )
        order.wms_state.status = "cancelled"
        if doc_so and doc_so.status != "cancelled":
            doc_so.status = "cancelled"
        log_action(
            db,
            user_id=user.id,
            action=ACTION_UPDATE,
            entity_type="order",
            entity_id=str(order_id),
            old_data={"status": old_status},
            new_data={"status": "cancelled", "note": "direct_cancel_no_picked_qty"},
            ip_address=get_client_ip(request),
        )
        db.commit()
        order = (
            db.query(OrderModel)
            .options(selectinload(OrderModel.lines), selectinload(OrderModel.wms_state))
            .filter(OrderModel.id == order_id)
            .one()
        )
        return _to_order_details(order, db)

    _enforce_transition_or_reject(
        request=request,
        db=db,
        user_id=user.id,
        order_id=order_id,
        from_status=old_status,
        to_status=normalized_status,
    )

    order.wms_state.status = normalize_order_wms_status_for_storage(normalized_status)

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
            doc.sent_to_controller_at = datetime.now(timezone.utc)

    if normalized_status == "completed":
        doc = (
            db.query(DocumentModel)
            .filter(DocumentModel.order_id == order.id, DocumentModel.doc_type == "SO")
            .one_or_none()
        )
        if doc:
            doc.status = "completed"

    if normalized_status == "cancelled":
        doc = (
            db.query(DocumentModel)
            .filter(DocumentModel.order_id == order.id, DocumentModel.doc_type == "SO")
            .one_or_none()
        )
        if doc:
            doc.status = "cancelled"

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
    return _to_order_details(order, db)


@router.post("/sync-smartup", response_model=SmartupSyncResponse, summary="Sync orders from Smartup (Cross-organizational movement)")
async def sync_orders_from_smartup(
    payload: SmartupSyncRequest,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("orders:sync")),
):
    source = (payload.order_source or "").strip().lower()

    if source == "diller":
        return await _sync_diller(db, payload)
    if source == "orikzor":
        return await _sync_orikzor(db, payload)
    return await _sync_asosiy(db, payload)


async def _sync_asosiy(db: Session, payload: SmartupSyncRequest) -> SmartupSyncResponse:
    with smartup_sync_lock(db) as acquired:
        if not acquired:
            raise HTTPException(
                status_code=409,
                detail="SmartUp sync already in progress (worker or another request). Try again later.",
            )
        try:
            client = SmartupClient(filial_id=(payload.filial_id or "").strip() or None)
            response = client.export_orders(filial_code=payload.filial_code)
            filial_override = (payload.filial_id or "").strip() or None
            items_b_w = [
                item for item in response.items
                if (item.status or "").strip().upper() == "B#W"
            ]
            filtered_out = max(0, len(response.items) - len(items_b_w))
            if filtered_out:
                logger.info("sync-smartup: skipped non-B#W items=%s", filtered_out)
            items_to_import = items_b_w
            created, updated, skipped, import_errors, skipped_by_reason = import_orders(
                db, items_to_import, order_source=payload.order_source, filial_id_override=filial_override
            )
            delete_stale_orders(db, list(items_to_import))
            skipped += filtered_out
            return _build_sync_response(created, updated, skipped, import_errors, skipped_by_reason)
        except RuntimeError as exc:
            msg = str(exc)
            if "400" in msg or "не найдена" in msg or "organization" in msg.lower():
                raise HTTPException(status_code=400, detail=msg) from exc
            raise HTTPException(status_code=500, detail=msg) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Smartup export failed: {exc}") from exc


async def _sync_diller(db: Session, payload: SmartupSyncRequest) -> SmartupSyncResponse:
    with diller_sync_lock(db) as acquired:
        if not acquired:
            raise HTTPException(
                status_code=409,
                detail="Diller sync already in progress (worker or another request). Try again later.",
            )
        try:
            begin, end = resolve_movement_export_date_range(
                payload.begin_deal_date,
                payload.end_deal_date,
            )
            if begin > end:
                raise HTTPException(
                    status_code=400,
                    detail="begin_deal_date must be <= end_deal_date",
                )
            filial_override = (payload.filial_id or "").strip() or None
            response = export_mfm_movements(begin, end, filial_id=filial_override)
            items = response.items
            logger.info(
                "sync-smartup(diller): mfm javobdan %s ta order import qilishga yuboriladi "
                "(sana=%s..%s filial_override=%s)",
                len(items),
                begin,
                end,
                filial_override or "-",
            )
            logging.getLogger("uvicorn").info(
                "WMS diller: mfm_items=%s dates=%s..%s filial=%s",
                len(items),
                begin,
                end,
                filial_override or "-",
            )
            created, updated, skipped, import_errors, skipped_by_reason = import_orders(
                db, items, order_source="diller"
            )
            breakdown = {k: v for k, v in skipped_by_reason.items() if v}
            logger.info(
                "sync-smartup(diller): import_orders natija created=%s updated=%s skipped=%s errors=%s skipped_by=%s",
                created,
                updated,
                skipped,
                len(import_errors),
                breakdown,
            )
            logging.getLogger("uvicorn").info(
                "WMS diller: import created=%s updated=%s skipped=%s errors=%s skipped_by=%s",
                created,
                updated,
                skipped,
                len(import_errors),
                breakdown,
            )
            if import_errors:
                for err in import_errors[:10]:
                    logger.warning(
                        "sync-smartup(diller) import xato: external_id=%s reason=%s",
                        err.external_id,
                        err.reason,
                    )
            return _build_sync_response(
                created,
                updated,
                skipped,
                import_errors,
                skipped_by_reason,
                extra_debug={
                    "diller_items_from_smartup": len(items),
                    "diller_begin_date": str(begin),
                    "diller_end_date": str(end),
                    "mfm_send_status_in_body": _mfm_send_status_in_export_body(),
                    "import_skipped_by_reason": breakdown,
                },
            )
        except RuntimeError as exc:
            msg = str(exc)
            if "400" in msg or "не найдена" in msg or "organization" in msg.lower():
                raise HTTPException(status_code=400, detail=msg) from exc
            raise HTTPException(status_code=500, detail=msg) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Diller sync failed: {exc}") from exc


async def _sync_orikzor(db: Session, payload: SmartupSyncRequest) -> SmartupSyncResponse:
    with orikzor_sync_lock(db) as acquired:
        if not acquired:
            raise HTTPException(
                status_code=409,
                detail="O'rikzor sync already in progress (worker or another request). Try again later.",
            )
        try:
            begin, end = resolve_movement_export_date_range(
                payload.begin_deal_date,
                payload.end_deal_date,
            )
            if begin > end:
                raise HTTPException(
                    status_code=400,
                    detail="begin_deal_date must be <= end_deal_date",
                )
            response = export_movements_from_smartup(begin, end)
            items = response.items
            logger.info("sync-smartup(orikzor): %d ta harakat (mkw movement$export)", len(items))
            created, updated, skipped, import_errors, skipped_by_reason = import_orders(
                db, items, order_source="orikzor"
            )
            return _build_sync_response(created, updated, skipped, import_errors, skipped_by_reason)
        except RuntimeError as exc:
            msg = str(exc)
            if "400" in msg or "не найдена" in msg or "organization" in msg.lower():
                raise HTTPException(status_code=400, detail=msg) from exc
            raise HTTPException(status_code=500, detail=msg) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"O'rikzor sync failed: {exc}") from exc


def _build_sync_response(
    created: int,
    updated: int,
    skipped: int,
    import_errors: list,
    skipped_by_reason: dict,
    extra_debug: dict | None = None,
) -> SmartupSyncResponse:
    completed_match_skipped = int(skipped_by_reason.get("completed_match_skipped", 0))
    detail = import_errors[0].reason if import_errors else None
    if not detail and completed_match_skipped > 0:
        detail = (
            f"Skipped {completed_match_skipped} finalized orders: "
            "incoming payload fully matched existing completed/packed/shipped lines."
        )
    errors_count = len(import_errors) if import_errors else None
    debug: dict = {"skipped_by_reason": skipped_by_reason}
    if extra_debug:
        debug.update(extra_debug)
    return SmartupSyncResponse(
        created=created,
        updated=updated,
        skipped=skipped,
        detail=detail,
        errors_count=errors_count,
        debug=debug,
    )


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
    dn = (movement.delivery_number or "").strip()[:64] or None
    if order:
        if dn:
            order.delivery_number = dn
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
        delivery_number=dn,
    )
    order.wms_state = OrderWmsStateModel(status="imported")
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


@router.post(
    "/from-movement/ensure",
    response_model=OrderDetails,
    summary="Movement uchun Order yaratish yoki qaytarish (qatorlarni tahrirlash / yig'ishdan oldin)",
)
async def ensure_movement_order(
    payload: EnsureMovementOrderRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:write")),
):
    if payload.source.strip().lower() not in ("diller", "orikzor"):
        raise HTTPException(status_code=400, detail="source diller yoki orikzor bo'lishi kerak")
    if not payload.movement.movement_items:
        raise HTTPException(status_code=400, detail="movement_items bo'sh bo'lmasligi kerak")
    order = _get_or_create_order_from_movement(
        db,
        payload.source.strip(),
        payload.movement_id.strip(),
        payload.movement,
    )
    db.commit()
    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.lines), selectinload(OrderModel.wms_state))
        .filter(OrderModel.id == order.id)
        .one()
    )
    return _to_order_details(order, db)


@router.post("/from-movement/send-to-picking", response_model=SendToPickingResponse, summary="Send movement (Tashkiliy/O'rikzor) to picking")
async def send_movement_to_picking(
    request: Request,
    payload: SendMovementToPickingRequest,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
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

    def _run_send():
        order = _get_or_create_order_from_movement(
            db, payload.source.strip(), payload.movement_id.strip(), payload.movement
        )
        db.refresh(order)
        if not order.lines:
            raise HTTPException(status_code=409, detail="Order has no lines")

        existing = (
            db.query(DocumentModel)
            .filter(
                DocumentModel.order_id == order.id,
                DocumentModel.doc_type == "SO",
                DocumentModel.status != "cancelled",
            )
            .one_or_none()
        )
        if existing:
            raise HTTPException(status_code=409, detail="Picking task already created")

        _enforce_transition_or_reject(
            request=request,
            db=db,
            user_id=user.id,
            order_id=order.id,
            from_status=order.wms_state.status,
            to_status="allocated",
        )

        document_lines, shortages = _allocate_order(db, order, user.id)
        if shortages:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "INSUFFICIENT_STOCK",
                    "order_id": str(order.id),
                    "order_number": order.order_number,
                    "shortages": [s.model_dump(mode="json") for s in shortages],
                },
            )
        if not document_lines:
            raise HTTPException(status_code=409, detail="Insufficient stock to allocate")

        document = DocumentModel(
            doc_no=order.order_number,
            doc_type="SO",
            status="new",
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

    return _run_with_idempotency(
        db=db,
        user_id=user.id,
        key=idempotency_key,
        scope="orders:send_to_picking_movement",
        payload={
            "source": payload.source.strip().lower(),
            "movement_id": payload.movement_id.strip(),
            "assigned_to_user_id": str(payload.assigned_to_user_id),
        },
        expected_status=200,
        run=_run_send,
    )


def _validate_one_order_send_to_picking(
    db: Session,
    *,
    user_id: UUID,
    order_id: UUID,
) -> SendToPickingValidationFailure | None:
    """None = yuborish mumkin; aks holda sabab."""
    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.lines), selectinload(OrderModel.wms_state))
        .filter(OrderModel.id == order_id)
        .one_or_none()
    )
    if not order:
        return SendToPickingValidationFailure(
            order_id=order_id,
            order_number="",
            code="order_not_found",
            message="Order not found",
        )
    if not order.wms_state:
        return SendToPickingValidationFailure(
            order_id=order.id,
            order_number=order.order_number,
            code="no_wms_state",
            message="Order has no WMS state",
        )
    if not order.lines:
        return SendToPickingValidationFailure(
            order_id=order.id,
            order_number=order.order_number,
            code="no_order_lines",
            message="Order has no lines",
        )
    existing = (
        db.query(DocumentModel)
        .filter(
            DocumentModel.order_id == order.id,
            DocumentModel.doc_type == "SO",
            DocumentModel.status != "cancelled",
        )
        .one_or_none()
    )
    if existing:
        return SendToPickingValidationFailure(
            order_id=order.id,
            order_number=order.order_number,
            code="picking_exists",
            message="Picking task already created",
        )
    if get_transition_rule(order.wms_state.status, "allocated") is None:
        return SendToPickingValidationFailure(
            order_id=order.id,
            order_number=order.order_number,
            code="transition_blocked",
            message=f"Cannot transition from {order.wms_state.status} to allocated",
        )
    shortages, n_lines = _dry_run_allocate_for_order(db, order, user_id)
    if shortages:
        return SendToPickingValidationFailure(
            order_id=order.id,
            order_number=order.order_number,
            code="insufficient_stock",
            shortages=shortages,
        )
    if n_lines == 0:
        return SendToPickingValidationFailure(
            order_id=order.id,
            order_number=order.order_number,
            code="zero_allocated_lines",
            message="Insufficient stock to allocate",
        )
    return None


@router.post(
    "/validate-send-to-picking",
    response_model=ValidateSendToPickingResponse,
    summary="Yig'ishga yuborishdan oldin zaxira va holat tekshiruvi",
)
async def validate_send_to_picking(
    payload: ValidateSendToPickingRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:send_to_picking")),
):
    if "picking:assign" not in get_permissions_for_role(user.role):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    failures: list[SendToPickingValidationFailure] = []
    seen: set[UUID] = set()
    for oid in payload.order_ids:
        if oid in seen:
            continue
        seen.add(oid)
        fail = _validate_one_order_send_to_picking(db, user_id=user.id, order_id=oid)
        if fail is not None:
            failures.append(fail)
    return ValidateSendToPickingResponse(ok=len(failures) == 0, failures=failures)


@router.post("/{order_id}/send-to-picking", response_model=SendToPickingResponse, summary="Send order to picking")
async def send_order_to_picking(
    request: Request,
    order_id: UUID,
    payload: SendToPickingRequest,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:send_to_picking")),
):
    if "picking:assign" not in get_permissions_for_role(user.role):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    def _run_send():
        order = (
            db.query(OrderModel)
            .options(selectinload(OrderModel.lines), selectinload(OrderModel.wms_state))
            .filter(OrderModel.id == order_id)
            .one_or_none()
        )
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")

        if not order.lines:
            raise HTTPException(status_code=409, detail="Order has no lines")

        existing = (
            db.query(DocumentModel)
            .filter(
                DocumentModel.order_id == order.id,
                DocumentModel.doc_type == "SO",
                DocumentModel.status != "cancelled",
            )
            .one_or_none()
        )
        if existing:
            raise HTTPException(status_code=409, detail="Picking task already created")

        assigned_user = db.query(User).filter(User.id == payload.assigned_to_user_id).one_or_none()
        if not assigned_user or assigned_user.role != "picker":
            raise HTTPException(status_code=400, detail="Invalid picker selection")

        _enforce_transition_or_reject(
            request=request,
            db=db,
            user_id=user.id,
            order_id=order_id,
            from_status=order.wms_state.status,
            to_status="allocated",
        )

        document_lines, shortages = _allocate_order(db, order, user.id)
        if shortages:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "INSUFFICIENT_STOCK",
                    "order_id": str(order.id),
                    "order_number": order.order_number,
                    "shortages": [s.model_dump(mode="json") for s in shortages],
                },
            )
        if not document_lines:
            raise HTTPException(status_code=409, detail="Insufficient stock to allocate")

        document = DocumentModel(
            doc_no=order.order_number,
            doc_type="SO",
            status="new",
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

    return _run_with_idempotency(
        db=db,
        user_id=user.id,
        key=idempotency_key,
        scope="orders:send_to_picking",
        payload={
            "order_id": str(order_id),
            "assigned_to_user_id": str(payload.assigned_to_user_id),
        },
        expected_status=200,
        run=_run_send,
    )


_REASSIGN_PICKER_BLOCKED_DOC_STATUSES = frozenset(
    {"picked", "completed", "packed", "shipped", "cancelled", "cancelling"}
)


@router.post(
    "/{order_id}/reassign-picker",
    response_model=SendToPickingResponse,
    summary="Reassign picker before any pick (SO document unchanged)",
)
async def reassign_order_picker(
    request: Request,
    order_id: UUID,
    payload: SendToPickingRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders:send_to_picking")),
):
    """Change assigned picker while no lines have been picked and document not sent to controller."""
    if "picking:assign" not in get_permissions_for_role(user.role):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.wms_state))
        .filter(OrderModel.id == order_id)
        .one_or_none()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if not order.wms_state:
        raise HTTPException(status_code=409, detail="Order has no WMS state")

    if order.wms_state.status not in ("allocated", "picking"):
        raise HTTPException(
            status_code=409,
            detail="Picker can only be reassigned while order is allocated or picking with no picks yet",
        )

    document = (
        db.query(DocumentModel)
        .options(selectinload(DocumentModel.lines))
        .filter(
            DocumentModel.order_id == order.id,
            DocumentModel.doc_type == "SO",
            DocumentModel.status != "cancelled",
        )
        .with_for_update()
        .one_or_none()
    )
    if not document:
        raise HTTPException(status_code=409, detail="No active picking document for this order")

    if document.status in _REASSIGN_PICKER_BLOCKED_DOC_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="Cannot reassign picker: document already in picked, completed, or terminal state",
        )
    if document.controlled_by_user_id is not None:
        raise HTTPException(status_code=409, detail="Cannot reassign after document was sent to controller")

    for line in document.lines:
        if (line.picked_qty or 0) > 0:
            raise HTTPException(status_code=409, detail="Cannot reassign after picking has started")
        if line.skip_reason:
            raise HTTPException(status_code=409, detail="Cannot reassign: a line was already skipped")

    new_picker = db.query(User).filter(User.id == payload.assigned_to_user_id).one_or_none()
    if not new_picker or new_picker.role != "picker":
        raise HTTPException(status_code=400, detail="Invalid picker selection")

    old_id = document.assigned_to_user_id
    if old_id == payload.assigned_to_user_id:
        db.commit()
        return SendToPickingResponse(pick_task_id=document.id, assigned_to=payload.assigned_to_user_id)

    document.assigned_to_user_id = payload.assigned_to_user_id
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="order",
        entity_id=str(order_id),
        old_data={"assigned_to_user_id": str(old_id) if old_id else None},
        new_data={
            "assigned_to_user_id": str(payload.assigned_to_user_id),
            "document_id": str(document.id),
            "action": "reassign_picker",
        },
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
    _enforce_transition_or_reject(
        request=request,
        db=db,
        user_id=user.id,
        order_id=order_id,
        from_status=old_status,
        to_status="packed",
    )
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
    return _to_order_details(order, db)


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
        require_sufficient_available(
            db,
            line.product_id,
            line.lot_id,
            line.location_id,
            Decimal(str(line.picked_qty)),
            lock=True,
        )
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
    _enforce_transition_or_reject(
        request=request,
        db=db,
        user_id=user.id,
        order_id=order_id,
        from_status=old_status,
        to_status="shipped",
    )
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
    return _to_order_details(order, db)
