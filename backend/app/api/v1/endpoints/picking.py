import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Literal, Optional
from uuid import UUID

import logging

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, case, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

logger = logging.getLogger(__name__)

from app.auth.deps import get_current_user, require_permission
from app.core.business_time import BUSINESS_TZ, day_bounds_in_tz
from app.db import get_db
from app.models.document import Document as DocumentModel
from app.models.document import DocumentLine as DocumentLineModel
from app.models.location import Location as LocationModel
from app.models.order import Order as OrderModel
from app.models.order import OrderWmsState as OrderWmsStateModel
from app.models.picking import PickRequest
from app.models.settings_organization import SettingsOrganization
from app.models.stock import StockMovement as StockMovementModel
from app.models.product import Product as ProductModel
from app.models.user import User as UserModel
from app.models.safe_cancel_return import SafeCancelReturnLine as SafeCancelReturnLineModel
from app.models.safe_cancel_return import SafeCancelReturnSession as SafeCancelReturnSessionModel
from app.models.user_fcm_token import UserFCMToken
from app.models.stock import StockLot as StockLotModel
from app.models.location_box_placement import PLACEMENT_SEALED, LocationBoxPlacement
from app.models.product_box import ProductBox as ProductBoxModel
from app.api.v1.endpoints.picker_inventory import _get_lot_level_balances, _location_ids_for_warehouse
from app.constants.document_status import (
    ACTIVE_DOCUMENT_STATUSES,
    ACTIVE_PIPELINE_ORDER_STATUSES,
    ORDER_HIDDEN_STATUSES,
)
from app.services.order_reserve_release import release_document_reserve_on_cancel
from app.services.payroll_rates import load_rates, payroll_role_for
from app.services.order_source_group import (
    REGION_SOURCE,
    SOURCE_GROUP_CITY,
    SOURCE_GROUP_REGION,
    order_source_group,
    source_group_conditions,
)
from app.services.organization_labels import resolve_org_display
from app.services.stock_availability import require_sufficient_reserved
from app.services.audit_service import ACTION_CREATE, ACTION_UPDATE, get_client_ip, log_action
from app.services.box_location_service import (
    apply_hybrid_pick_side_effects,
    apply_scan_pick_side_effects,
    assert_box_invariant,
    breakdown_kwargs_for_pick,
    compute_consolidated_box_loose_plan,
    consolidated_remainders_by_document,
    remove_sealed_boxes_for_pick,
    require_sufficient_loose_for_unit_pick,
    validate_hybrid_pick_qty,
)
from app.services.stock_availability import lock_lot_location
from app.services.stock_box_gateway import record_pick, record_pick_rollback
from app.services.product_scan_resolve import (
    ProductScanResolve,
    is_explicit_box_pick,
    resolve_product_scan,
)
from app.services.warehouse_scope import (
    assert_location_allowed_for_pick,
    warehouse_scope_for_order,
)
from app.services.safe_cancel_return_service import (
    active_return_session_id_for_document,
    finish_safe_cancel_return,
    get_active_return_session_for_picker,
    list_session_lines_ordered,
    order_in_cancelling_flow,
    scan_return_location,
    scan_return_product,
)

router = APIRouter()


class PickingAlternateLocation(BaseModel):
    location_id: UUID
    location_code: str
    lot_id: UUID
    available_qty: float
    batch: Optional[str] = None
    expiry_date: Optional[str] = None
    is_primary: bool = False
    box_count: Optional[int] = None
    units_in_boxes: Optional[int] = None
    loose_units: Optional[int] = None


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
    product_id: Optional[UUID] = None
    alternate_locations: List[PickingAlternateLocation] = Field(default_factory=list)
    is_vip_expiry_informational: bool = False
    vip_expiry_information_key: Optional[str] = Field(
        default=None,
        description="Mijoz uchun i18n kalit, masalan vip_expiry_not_picked",
    )
    line_source: Optional[str] = Field(
        default="product",
        description="product | action | gift — SmartUP buyurtma qatori manbasi",
    )
    picked_box_barcode: Optional[str] = None
    picked_at: Optional[datetime] = Field(
        default=None,
        description="Yig'uvchi skanerlab miqdorni tasdiqlagan oxirgi vaqt (UTC)",
    )


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
    controlled_by_user_id: Optional[UUID] = None
    controlled_by_user_name: Optional[str] = None
    order_number: Optional[str] = None
    order_wms_status: Optional[str] = None
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    safe_cancel_return_session_id: Optional[UUID] = None
    source_group: str = Field(
        SOURCE_GROUP_CITY, description="Buyurtma manbasi guruhi: 'shahar' yoki 'region'"
    )
    sent_to_controller_at: Optional[datetime] = None
    controller_verification_started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    first_assigned_at: Optional[datetime] = None
    last_assigned_at: Optional[datetime] = None


class PickingListItem(BaseModel):
    id: UUID
    reference_number: str
    status: str
    lines_total: int
    lines_done: int
    picked_any: bool = False
    controlled_by_user_id: Optional[UUID] = None
    controlled_by_user_name: Optional[str] = None
    assigned_to_user_id: Optional[UUID] = None
    assigned_to_user_name: Optional[str] = None
    order_id: Optional[UUID] = None
    order_number: Optional[str] = None
    delivery_number: Optional[str] = None
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    order_wms_status: Optional[str] = None
    order_source: Optional[str] = Field(None, description="Buyurtma manbasi (smartup/orikzor/diller)")
    source_group: str = Field(
        SOURCE_GROUP_CITY, description="Buyurtma manbasi guruhi: 'shahar' yoki 'region'"
    )
    sent_to_controller_at: Optional[datetime] = None
    controller_verification_started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    updated_at: datetime
    first_assigned_at: Optional[datetime] = None
    last_assigned_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    cancelled_by_user_name: Optional[str] = None


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
    is_vip_expiry_informational: bool = False


class ConsolidatedProduct(BaseModel):
    """Product group: total required/picked + per-document lines."""
    barcode: Optional[str] = None
    sku: Optional[str] = None
    product_name: str
    product_id: Optional[UUID] = None
    total_required: float
    total_picked: float
    expiry_date: Optional[str] = None  # representative (e.g. first line's) for display
    alternate_locations: List[PickingAlternateLocation] = Field(default_factory=list)
    lines: List[ConsolidatedLineItem]
    suggested_box_count: int = 0
    suggested_loose_qty: int = 0


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
    box_count: Optional[int] = None
    box_barcode: Optional[str] = None

    @field_validator("box_count")
    @classmethod
    def box_count_bounded(cls, v: Optional[int]) -> Optional[int]:
        if v is None:
            return None
        if v < 1 or v > 500:
            raise ValueError("box_count must be between 1 and 500")
        return v

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


class ChangePickSourceRequest(BaseModel):
    location_id: UUID
    lot_id: UUID


class PickLineRequest(BaseModel):
    delta: int
    request_id: str
    barcode: str | None = None
    box_count: Optional[int] = None
    box_barcode: Optional[str] = None

    @field_validator("box_count")
    @classmethod
    def box_count_bounded(cls, v: Optional[int]) -> Optional[int]:
        if v is None:
            return None
        if v < 1 or v > 500:
            raise ValueError("box_count must be between 1 and 500")
        return v

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
    # Deprecated: controller endi tanlanmaydi — hujjat umumiy navbatga (pool) tushadi.
    # Eski mobil ilovalar bu maydonni yuborishda davom etadi; qabul qilinadi, lekin e'tiborsiz.
    controller_user_id: Optional[UUID] = None


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


def _lock_document_row(db: Session, document_id: UUID) -> None:
    """Hujjat qatorini qulflaydi (identity map tufayli mavjud obyekt o'zgarmaydi)."""
    db.query(DocumentModel).filter(DocumentModel.id == document_id).with_for_update().one()


def _is_in_controller_pool(document: DocumentModel) -> bool:
    """Hujjat umumiy navbatda: yig'uvchi yuborgan, lekin hali hech kim band qilmagan."""
    return document.sent_to_controller_at is not None and document.controlled_by_user_id is None


def _assert_controller_can_read(document: DocumentModel, user) -> None:
    """Controller hujjatni ko'ra oladimi: o'zi band qilgan yoki navbatda turgan bo'lsa."""
    if document.controlled_by_user_id == user.id:
        return
    if _is_in_controller_pool(document):
        return
    raise HTTPException(status_code=404, detail="Document not found")


def _claim_for_controller(document: DocumentModel, user) -> bool:
    """Controller hujjatni band qiladi (idempotent). True — shu chaqiruvda band qilindi.

    Navbatdagi hujjatni birinchi ochgan/skanlagan controller egalik qiladi, boshqasiga 409.
    Chaqiruvchi hujjatni `with_for_update()` bilan olgan bo'lishi kerak — shunda ikki
    controller bir vaqtda bosganda ham faqat bittasi yutadi.
    """
    if document.controlled_by_user_id == user.id:
        return False
    if document.controlled_by_user_id is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "controller_already_claimed",
                "message": "Bu hujjatni boshqa controller band qilgan",
            },
        )
    if document.sent_to_controller_at is None:
        raise HTTPException(status_code=409, detail="Document is not sent to controller yet")
    document.controlled_by_user_id = user.id
    document.controller_claimed_at = datetime.now(timezone.utc)
    return True


def _release_unpicked_reserve_on_controller_complete(
    db: Session,
    document: DocumentModel,
    lines: list[DocumentLineModel],
    user_id: UUID,
) -> int:
    """
    Controller hujjatni completed qilganda: terilmagan qism uchun rezervni yechish.
    Har terishda pick+unallocate bo'lgani kabi, bu yerda faqat unallocate (ombor joyida qoldiq qoladi).
    """
    return release_document_reserve_on_cancel(db, document, lines, user_id)


class ReturnScanBody(BaseModel):
    raw: str = Field(..., min_length=1, description="Skaner yoki qo'lda kiritilgan kod")


class SafeCancelReturnLineOut(BaseModel):
    id: UUID
    document_line_id: UUID
    expected_location_code: str
    product_name: str
    barcode: Optional[str] = None
    sku: Optional[str] = None
    qty_to_return: float
    location_confirmed: bool
    product_confirmed: bool


class SafeCancelReturnSessionOut(BaseModel):
    id: UUID
    document_id: UUID
    reference_number: str
    order_number: Optional[str] = None
    status: str = "returns_pending"
    lines: List[SafeCancelReturnLineOut]
    all_lines_complete: bool


class MyPickerStatsDay(BaseModel):
    date: str  # YYYY-MM-DD
    count: int


class MyPeriodStatsGroup(BaseModel):
    orders: int = 0
    positions: int = 0
    qty: float = 0.0
    amount: float = 0.0


class MyPeriodStatsDay(BaseModel):
    date: str  # YYYY-MM-DD
    orders: int
    positions: int
    qty: float
    amount: float = 0.0
    shahar: MyPeriodStatsGroup = MyPeriodStatsGroup()
    region: MyPeriodStatsGroup = MyPeriodStatsGroup()


class MyPeriodStatsTotals(BaseModel):
    orders: int
    positions: int
    qty: float
    amount: float = 0.0
    shahar: MyPeriodStatsGroup = MyPeriodStatsGroup()
    region: MyPeriodStatsGroup = MyPeriodStatsGroup()


class MyPeriodStatsResponse(BaseModel):
    period_from: str
    period_to: str
    rate_shahar: float = 0.0
    rate_region: float = 0.0
    days: List[MyPeriodStatsDay]
    totals: MyPeriodStatsTotals


class MyPickerStatsResponse(BaseModel):
    total_completed: int
    completed_today: int
    by_day: List[MyPickerStatsDay]


def _assert_pick_zone_allowed(loc: Optional[LocationModel], *, allow_expired: bool) -> None:
    """Terish manbasi zonasini tekshiradi.

    NORMAL doim ruxsat. EXPIRED faqat `allow_expired` bo'lganda — chegirmali
    (action_margins) / promo qatorlar ajratishda ataylab EXPIRED zonadan
    biriktiriladi (`_allocate_order`), shuning uchun ularni terib bo'lishi kerak.
    DAMAGED / QUARANTINE hech qachon terilmaydi.
    """
    zone = (loc.zone_type if loc else None) or ""
    allowed = ("NORMAL", "EXPIRED") if allow_expired else ("NORMAL",)
    if not loc or zone not in allowed:
        raise HTTPException(
            status_code=400,
            detail="Pick only from NORMAL zone. Line location is not NORMAL.",
        )


def _mark_line_picked(line: DocumentLineModel) -> None:
    """Skan + miqdor tasdig'i muvaffaqiyatli — tasdiqlash vaqtini yozamiz."""
    line.picked_at = datetime.now(timezone.utc)


def _clear_line_picked(line: DocumentLineModel) -> None:
    """Terilgan miqdor to'liq qaytarildi — tasdiqlash vaqti ham o'chadi."""
    line.picked_at = None


def _line_is_vip_expiry_informational(line: DocumentLineModel) -> bool:
    return bool(getattr(line, "is_vip_expiry_informational", False))


def _calculate_progress(lines: List[DocumentLineModel]) -> PickingProgress:
    required = 0.0
    picked = 0.0
    for line in lines:
        rq = float(line.required_qty) if line.required_qty is not None else 0.0
        pq = float(line.picked_qty) if line.picked_qty is not None else 0.0
        required += rq
        if _line_is_vip_expiry_informational(line):
            picked += rq
        else:
            picked += pq
    return PickingProgress(picked=picked, required=required)


def _safe_expiry_date(expiry_date) -> Optional[str]:
    if expiry_date is None:
        return None
    if hasattr(expiry_date, "isoformat"):
        return expiry_date.isoformat()
    return str(expiry_date) if expiry_date else None


def _breakdown_kwargs_map_for_pairs(
    db: Session,
    pairs: set[tuple[UUID, UUID]],
    balances: dict[tuple[UUID, UUID], tuple[float, float]],
) -> dict[tuple[UUID, UUID], dict]:
    """
    Terish alternate_locations: barcha (lot, lokatsiya) juftliklari uchun quti breakdown
    `get_breakdown_for_pick` bilan bir xil (on_hand asosida, reserved bilan ham).
    `balances`: (lot_id, location_id) -> (on_hand, available).
    """
    if not pairs:
        return {}
    box_rows = (
        db.query(
            LocationBoxPlacement.lot_id,
            LocationBoxPlacement.location_id,
            func.count(LocationBoxPlacement.id).label("box_count"),
            func.coalesce(func.sum(ProductBoxModel.units_per_box), 0).label("units"),
        )
        .join(ProductBoxModel, ProductBoxModel.id == LocationBoxPlacement.product_box_id)
        .filter(
            LocationBoxPlacement.lot_id.in_({p[0] for p in pairs}),
            LocationBoxPlacement.location_id.in_({p[1] for p in pairs}),
            LocationBoxPlacement.status == PLACEMENT_SEALED,
            ProductBoxModel.is_active.is_(True),
        )
        .group_by(LocationBoxPlacement.lot_id, LocationBoxPlacement.location_id)
        .all()
    )
    boxes = {
        (r.lot_id, r.location_id): (int(r.box_count), int(r.units)) for r in box_rows
    }
    out: dict[tuple[UUID, UUID], dict] = {}
    for key in pairs:
        on_hand, available = balances.get(key, (0.0, 0.0))
        box_count, units_in_boxes = boxes.get(key, (0, 0))
        out[key] = breakdown_kwargs_for_pick(
            int(on_hand),
            int(available),
            box_count,
            units_in_boxes,
        )
    return out


def _picking_expiry_urgency_days() -> int:
    """Kunlar: muddat <= bugun + N bo‘lsa 'yaqin tugash' guruhi (env WMS_PICKING_EXPIRY_URGENCY_DAYS, default 30)."""
    raw = (os.getenv("WMS_PICKING_EXPIRY_URGENCY_DAYS") or "30").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 30
    return max(0, min(366, n))


def _picking_route_order_by(*, urgency_cutoff_date: date):
    """
    Terish yo‘li: avval yaqin tugash guruhi, keyin Location.pick_sequence, keyin FEFO, keyin id.
    NULL muddat — yaqin emas (bucket 1). location.code alfavit tartibi ishlatilmaydi.
    """
    urgency_bucket = case(
        (
            DocumentLineModel.expiry_date.isnot(None)
            & (DocumentLineModel.expiry_date <= urgency_cutoff_date),
            0,
        ),
        else_=1,
    )
    return (
        urgency_bucket.asc(),
        LocationModel.pick_sequence.asc().nulls_last(),
        DocumentLineModel.expiry_date.asc().nulls_last(),
        DocumentLineModel.id.asc(),
    )


def _picking_urgency_cutoff_today() -> date:
    today = datetime.now(timezone.utc).date()
    return today + timedelta(days=_picking_expiry_urgency_days())


def _balance_rows_by_product(
    db: Session,
    product_ids: list[UUID],
    warehouse: Optional[str],
) -> dict[UUID, list[dict]]:
    """
    Mahsulot bo'yicha balans qatorlari: expiry_date ASC (NULL oxirida),
    bir xil muddatda available ASC (eng kam qoldiq), keyin location_code ASC.
    """
    if not product_ids:
        return {}
    loc_ids = _location_ids_for_warehouse(db, warehouse) if warehouse else None
    rows = _get_lot_level_balances(db, product_ids, location_ids=loc_ids)
    by_pid: dict[UUID, list[dict]] = {}
    for r in rows:
        pid = r["product_id"]
        by_pid.setdefault(pid, []).append(r)
    for pid, lst in by_pid.items():
        lst.sort(
            key=lambda x: (
                x["expiry_date"] is None,
                x["expiry_date"] or date.min,
                float(x["available"] or 0),
                x.get("location_code") or "",
            )
        )
    return by_pid


def _line_alternate_locations(
    line: DocumentLineModel,
    rows: list[dict],
    *,
    bd_map: dict[tuple[UUID, UUID], dict],
    primary_rows: list[dict],
    max_rows: int = 24,
) -> List[PickingAlternateLocation]:
    """
    Muqobil joylar — DB so'rovsiz, oldindan batch yuklangan xaritalardan:
    `bd_map` — (lot_id, location_id) -> quti breakdown kwargs;
    `primary_rows` — qatorning asosiy (product, location) balans qatorlari.
    """
    if not line.product_id:
        return []
    lid, lot_line = line.location_id, line.lot_id
    out: List[PickingAlternateLocation] = []
    for r in rows:
        if len(out) >= max_rows:
            break
        is_pri = lid is not None and lot_line is not None and r["location_id"] == lid and r["lot_id"] == lot_line
        av = float(r["available"] or 0)
        if av <= 0 and not is_pri:
            continue
        bd_kw = bd_map.get((r["lot_id"], r["location_id"]), {})
        out.append(
            PickingAlternateLocation(
                location_id=r["location_id"],
                location_code=r["location_code"] or "",
                lot_id=r["lot_id"],
                available_qty=av,
                batch=r.get("batch"),
                expiry_date=_safe_expiry_date(r.get("expiry_date")),
                is_primary=is_pri,
                **bd_kw,
            )
        )
    # Asosiy joy+lott — ombor filtri tufayli `rows`da bo‘lmasa ham, joriy lokatsiya bo‘yicha aniq balans.
    if lid and lot_line and line.product_id:
        pr = next((r for r in primary_rows if r["lot_id"] == lot_line), None)
        pri_bd = bd_map.get((lot_line, lid), {})
        if pr is not None:
            out = [x for x in out if not (x.location_id == lid and x.lot_id == lot_line)]
            out.insert(
                0,
                PickingAlternateLocation(
                    location_id=lid,
                    location_code=line.location_code or pr.get("location_code") or "",
                    lot_id=lot_line,
                    available_qty=float(pr["available"] or 0),
                    batch=pr.get("batch") or line.batch,
                    expiry_date=_safe_expiry_date(
                        pr.get("expiry_date") or getattr(line, "expiry_date", None)
                    ),
                    is_primary=True,
                    **pri_bd,
                ),
            )
        elif not any(x.is_primary for x in out):
            out.insert(
                0,
                PickingAlternateLocation(
                    location_id=lid,
                    location_code=line.location_code or "",
                    lot_id=lot_line,
                    available_qty=0.0,
                    batch=line.batch,
                    expiry_date=_safe_expiry_date(getattr(line, "expiry_date", None)),
                    is_primary=True,
                    **pri_bd,
                ),
            )
    return out[:max_rows]


def _to_picking_line(
    line: DocumentLineModel,
    *,
    alternate_locations: Optional[List[PickingAlternateLocation]] = None,
) -> PickingLine:
    is_vip_info = _line_is_vip_expiry_informational(line)
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
        product_id=line.product_id,
        alternate_locations=list(alternate_locations or []),
        is_vip_expiry_informational=is_vip_info,
        vip_expiry_information_key="vip_expiry_not_picked" if is_vip_info else None,
        line_source=(getattr(line, "line_source", None) or "product").strip(),
        picked_box_barcode=getattr(line, "picked_box_barcode", None),
        picked_at=getattr(line, "picked_at", None),
    )


def _picked_box_barcode_from_pick_payload(
    *,
    scan_barcode: str,
    box_barcode: str | None,
    box_count: int | None,
    resolved: ProductScanResolve | None,
) -> str | None:
    hybrid = (box_barcode or "").strip()
    if hybrid and box_count is not None:
        return hybrid
    code = scan_barcode.strip()
    if not code:
        return None
    if resolved and is_explicit_box_pick(resolved, box_count):
        return code
    if resolved and resolved.scan_kind == "box" and box_count is not None and int(box_count) >= 1:
        return code
    return None


def _fill_pick_balances_for_pairs(
    db: Session,
    pairs: set[tuple[UUID, UUID]],
    balances: dict[tuple[UUID, UUID], tuple[float, float]],
) -> None:
    """Terish breakdown: to'liq reserved (available=0) bo'lsa ham on_hand saqlansin."""
    from app.services.stock_availability import compute_lot_location_balances

    for lot_id, location_id in pairs:
        on_hand, _reserved, available = compute_lot_location_balances(
            db, lot_id, location_id
        )
        balances[(lot_id, location_id)] = (float(on_hand), float(available))


def _picking_lines_with_alternates(
    db: Session,
    document: DocumentModel,
    lines: List[DocumentLineModel],
) -> List[PickingLine]:
    order = getattr(document, "order", None)
    if order is None and document.order_id:
        order = db.query(OrderModel).filter(OrderModel.id == document.order_id).one_or_none()
    wh = warehouse_scope_for_order(order)
    pids = list({ln.product_id for ln in lines if ln.product_id})
    by_pid = _balance_rows_by_product(db, pids, wh)

    # Asosiy (qatordagi) lokatsiyalar balansi — bitta batch so'rov (oldin har qator uchun alohida edi).
    primary_loc_ids = list(
        {ln.location_id for ln in lines if ln.location_id and ln.lot_id and ln.product_id}
    )
    primary_rows_all = (
        _get_lot_level_balances(db, pids, location_ids=primary_loc_ids)
        if primary_loc_ids and pids
        else []
    )
    primary_by_key: dict[tuple[UUID, UUID], list[dict]] = {}
    for r in primary_rows_all:
        primary_by_key.setdefault((r["product_id"], r["location_id"]), []).append(r)

    # Quti breakdown — barcha (lot, lokatsiya) juftliklari uchun bitta so'rov
    # (oldin har bir muqobil joy uchun 3 tadan so'rov bajarilar edi).
    balances: dict[tuple[UUID, UUID], tuple[float, float]] = {}
    for rows_ in by_pid.values():
        for r in rows_:
            balances[(r["lot_id"], r["location_id"])] = (
                float(r["on_hand"] or 0),
                float(r["available"] or 0),
            )
    for r in primary_rows_all:
        balances[(r["lot_id"], r["location_id"])] = (
            float(r["on_hand"] or 0),
            float(r["available"] or 0),
        )
    pairs: set[tuple[UUID, UUID]] = set(balances.keys())
    for ln in lines:
        if ln.product_id and ln.lot_id and ln.location_id:
            pairs.add((ln.lot_id, ln.location_id))
    _fill_pick_balances_for_pairs(db, pairs, balances)
    bd_map = _breakdown_kwargs_map_for_pairs(db, pairs, balances)

    out: List[PickingLine] = []
    for ln in lines:
        if _line_is_vip_expiry_informational(ln):
            out.append(_to_picking_line(ln, alternate_locations=[]))
        else:
            out.append(
                _to_picking_line(
                    ln,
                    alternate_locations=_line_alternate_locations(
                        ln,
                        by_pid.get(ln.product_id, []),
                        bd_map=bd_map,
                        primary_rows=primary_by_key.get((ln.product_id, ln.location_id), []),
                    ),
                )
            )
    return out


def _picker_name(doc: DocumentModel) -> Optional[str]:
    user = getattr(doc, "assigned_to_user", None)
    if user is None:
        return None
    return getattr(user, "full_name", None) or getattr(user, "username", None)


def _controller_name(doc: DocumentModel) -> Optional[str]:
    user = getattr(doc, "controlled_by_user", None)
    if user is None:
        return None
    return getattr(user, "full_name", None) or getattr(user, "username", None)


def _cancelled_by_name(doc: DocumentModel) -> Optional[str]:
    order = getattr(doc, "order", None)
    if order is None:
        return None
    ws = getattr(order, "wms_state", None)
    if ws is None:
        return None
    user = getattr(ws, "cancelled_by_user", None)
    if user is None:
        return None
    return getattr(user, "full_name", None) or getattr(user, "username", None)


def _picking_cancel_meta(db: Optional[Session], doc: DocumentModel) -> tuple[Optional[str], Optional[UUID]]:
    if db is None or not doc.order_id:
        return None, None
    wms = (
        db.query(OrderWmsStateModel.status)
        .filter(OrderWmsStateModel.order_id == doc.order_id)
        .limit(1)
        .scalar()
    )
    sid = active_return_session_id_for_document(db, doc.id)
    return (str(wms) if wms is not None else None, sid)


def _to_picking_document(doc: DocumentModel, db: Optional[Session] = None) -> PickingDocument:
    lines = getattr(doc, "lines", None) or []
    org_names = _load_org_names(db) if db is not None else None
    wms, sid = _picking_cancel_meta(db, doc)
    return PickingDocument(
        id=doc.id,
        reference_number=doc.doc_no,
        status=doc.status,
        lines=[_to_picking_line(line) for line in lines],
        progress=_calculate_progress(lines),
        incomplete_reason=getattr(doc, "incomplete_reason", None),
        first_assigned_at=doc.first_assigned_at,
        last_assigned_at=doc.last_assigned_at,
        assigned_to_user_id=doc.assigned_to_user_id,
        assigned_to_user_name=_picker_name(doc),
        controlled_by_user_id=doc.controlled_by_user_id,
        controlled_by_user_name=_controller_name(doc),
        order_number=_order_number(doc),
        order_wms_status=wms,
        customer_id=_customer_id(doc),
        customer_name=_customer_name(doc, org_names),
        safe_cancel_return_session_id=sid,
        source_group=order_source_group(getattr(doc, "order", None)),
        sent_to_controller_at=doc.sent_to_controller_at,
        controller_verification_started_at=doc.controller_verification_started_at,
        completed_at=doc.completed_at,
    )


def _to_picking_document_with_lines(
    doc: DocumentModel,
    lines: List[DocumentLineModel],
    db: Optional[Session] = None,
) -> PickingDocument:
    """Commit dan keyin javob qaytarish uchun — doc.lines expired bo‘lishi mumkin."""
    if db is not None:
        plines = _picking_lines_with_alternates(db, doc, lines)
    else:
        plines = [_to_picking_line(line) for line in lines]
    org_names = _load_org_names(db) if db is not None else None
    wms, sid = _picking_cancel_meta(db, doc)
    return PickingDocument(
        id=doc.id,
        reference_number=doc.doc_no,
        status=doc.status,
        lines=plines,
        progress=_calculate_progress(lines),
        incomplete_reason=getattr(doc, "incomplete_reason", None),
        first_assigned_at=doc.first_assigned_at,
        last_assigned_at=doc.last_assigned_at,
        assigned_to_user_id=doc.assigned_to_user_id,
        assigned_to_user_name=_picker_name(doc),
        controlled_by_user_id=doc.controlled_by_user_id,
        controlled_by_user_name=_controller_name(doc),
        order_number=_order_number(doc),
        order_wms_status=wms,
        customer_id=_customer_id(doc),
        customer_name=_customer_name(doc, org_names),
        safe_cancel_return_session_id=sid,
        source_group=order_source_group(getattr(doc, "order", None)),
        sent_to_controller_at=doc.sent_to_controller_at,
        controller_verification_started_at=doc.controller_verification_started_at,
        completed_at=doc.completed_at,
    )


def _order_number(doc: DocumentModel) -> Optional[str]:
    order = getattr(doc, "order", None)
    return order.order_number if order else None


def _delivery_number(doc: DocumentModel) -> Optional[str]:
    order = getattr(doc, "order", None)
    if not order:
        return None
    dn = getattr(order, "delivery_number", None)
    return (dn or "").strip() or None


def _customer_id(doc: DocumentModel) -> Optional[str]:
    order = getattr(doc, "order", None)
    if not order:
        return None
    cid = getattr(order, "customer_id", None)
    if cid is None:
        return None
    s = str(cid).strip()
    return s or None


def _load_org_names(db: Session) -> dict[str, str]:
    """settings_organizations dan {org_id: name} xaritasi (kam yozuv, bir marta yuklanadi)."""
    rows = db.query(SettingsOrganization.org_id, SettingsOrganization.name).all()
    return {r[0]: r[1].strip() for r in rows if r[0] and r[1] and r[1].strip()}


def _customer_name(
    doc: DocumentModel, org_names: Optional[dict[str, str]] = None
) -> Optional[str]:
    order = getattr(doc, "order", None)
    if not order:
        return None
    cn = getattr(order, "customer_name", None)
    if cn is not None and str(cn).strip():
        return str(cn).strip()
    # Tashkiliy harakat (diller/MFM): mijoz yo'q — manzil tashkiloti nomi faqat
    # settings ID (org_id) orqali (admin ro'yxati bilan bir xil mantiq). ID
    # topilmasa bo'sh (fuzzy izoh-taxmini ishlatilmaydi).
    if org_names is None:
        return None
    return resolve_org_display(
        getattr(order, "filial_id", None),
        org_names,
        to_filial_code=getattr(order, "to_filial_code", None),
        movement_note=getattr(order, "movement_note", None),
    )


def _to_picking_list_item(
    doc: DocumentModel, org_names: Optional[dict[str, str]] = None
) -> PickingListItem:
    lines_total = len(doc.lines)
    lines_done = sum(
        1
        for line in doc.lines
        if _line_is_vip_expiry_informational(line)
        or line.picked_qty >= line.required_qty
        or bool(getattr(line, "skip_reason", None))
    )
    picked_any = any(
        (not _line_is_vip_expiry_informational(line)) and line.picked_qty > 0 for line in doc.lines
    )
    order = getattr(doc, "order", None)
    wms_status: Optional[str] = None
    cancelled_at: Optional[datetime] = None
    if order is not None:
        ws = getattr(order, "wms_state", None)
        if ws is not None:
            wms_status = getattr(ws, "status", None)
            cancelled_at = getattr(ws, "cancelled_at", None)
    return PickingListItem(
        id=doc.id,
        reference_number=doc.doc_no,
        status=doc.status,
        lines_total=lines_total,
        lines_done=lines_done,
        picked_any=picked_any,
        controlled_by_user_id=doc.controlled_by_user_id,
        controlled_by_user_name=_controller_name(doc),
        assigned_to_user_id=doc.assigned_to_user_id,
        assigned_to_user_name=_picker_name(doc),
        order_id=order.id if order is not None else None,
        order_number=_order_number(doc),
        delivery_number=_delivery_number(doc),
        customer_id=_customer_id(doc),
        customer_name=_customer_name(doc, org_names),
        order_wms_status=wms_status,
        order_source=getattr(order, "source", None) if order is not None else None,
        source_group=order_source_group(order),
        sent_to_controller_at=doc.sent_to_controller_at,
        controller_verification_started_at=doc.controller_verification_started_at,
        completed_at=doc.completed_at,
        updated_at=doc.updated_at,
        first_assigned_at=doc.first_assigned_at,
        last_assigned_at=doc.last_assigned_at,
        cancelled_at=cancelled_at,
        cancelled_by_user_name=_cancelled_by_name(doc),
    )


def _refresh_document_status(doc: DocumentModel, lines: List[DocumentLineModel]) -> None:
    if doc.status == "cancelling":
        return

    def _line_satisfied(ln: DocumentLineModel) -> bool:
        if _line_is_vip_expiry_informational(ln):
            return True
        if getattr(ln, "skip_reason", None):
            return True
        return ln.picked_qty >= ln.required_qty

    if all(_line_satisfied(line) for line in lines):
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
            selectinload(DocumentModel.controlled_by_user),
            selectinload(DocumentModel.order),
        )
        .filter(DocumentModel.id == document_id)
        .one_or_none()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if user.role == "picker" and document.assigned_to_user_id != user.id:
        raise HTTPException(status_code=404, detail="Document not found")
    if user.role == "inventory_controller":
        _assert_controller_can_read(document, user)
    cutoff = _picking_urgency_cutoff_today()
    lines = (
        db.query(DocumentLineModel)
        .outerjoin(LocationModel, DocumentLineModel.location_id == LocationModel.id)
        .filter(DocumentLineModel.document_id == document_id)
        .order_by(*_picking_route_order_by(urgency_cutoff_date=cutoff))
        .all()
    )
    return _to_picking_document_with_lines(document, lines, db)


@router.post(
    "/documents/{document_id}/cancel",
    response_model=PickingListItem,
    summary="Picker document cancel (disabled)",
)
async def cancel_picker_document(
    document_id: UUID,
    user=Depends(require_permission("picking:pick")),
):
    """Yig'uvchi ilovadan hujjatni bekor qilish o'chirilgan; bekor faqat ombor/admin oqimi orqali."""
    _ = (document_id, user)
    raise HTTPException(
        status_code=403,
        detail="Picker document cancel is disabled; cancel via warehouse admin.",
    )


@router.get("/documents", response_model=List[PickingListItem], summary="Picking documents")
@router.get("/documents/", response_model=List[PickingListItem], summary="Picking documents")
async def list_picking_documents(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    include_cancelled: bool = False,
    process_scope: Optional[Literal["active", "archived", "cancelled"]] = Query(
        default=None,
        description=(
            "active: admin Jarayon — buyurtma WMS allocated..picked va "
            "hujjat completed/packed/shipped emas (WMS kechiksa ham yakunlangan chiqmasin). "
            "archived: admin Arxiv — hujjat completed/packed/shipped. "
            "cancelled: admin Bekor qilingan — buyurtma WMS cancelled. "
            "picker/inventory_controller uchun e'tiborsiz."
        ),
    ),
    wms_group: Optional[Literal["yigishda", "tekshiruvda", "yakunlangan"]] = Query(
        default=None,
        description=(
            "Dashboard drill-down: buyurtma WMS statusi bo'yicha qo'shimcha filtr "
            "(yigishda=allocated|picking, tekshiruvda=picked, yakunlangan=completed|packed|shipped). "
            "picker/inventory_controller uchun e'tiborsiz."
        ),
    ),
    source_group: Optional[Literal["shahar", "region"]] = Query(
        default=None,
        description=(
            "Buyurtma manbasi guruhi bo'yicha filtr: shahar (smartup/orikzor) yoki "
            "region (diller). Bo'sh — hammasi."
        ),
    ),
    date_from: Optional[date] = Query(
        default=None,
        description=(
            "Sana filtri (ombor vaqti bo'yicha, shu kun kiritiladi). Qaysi ustun: "
            "archived — yakunlangan vaqt, cancelled — bekor qilingan vaqt, "
            "qolganlari — yaratilgan vaqt."
        ),
    ),
    date_to: Optional[date] = Query(default=None, description="Sana filtri oxiri (shu kun kiritiladi)."),
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:read")),
):
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(status_code=400, detail="date_from must be on or before date_to")
    effective_scope: Optional[str] = process_scope
    if user.role in ("picker", "inventory_controller"):
        effective_scope = None

    effective_wms_group: Optional[str] = wms_group
    if user.role in ("picker", "inventory_controller"):
        effective_wms_group = None

    query = (
        db.query(DocumentModel)
        .options(
            selectinload(DocumentModel.lines),
            selectinload(DocumentModel.assigned_to_user),
            selectinload(DocumentModel.controlled_by_user),
            selectinload(DocumentModel.order).selectinload(OrderModel.wms_state).selectinload(
                OrderWmsStateModel.cancelled_by_user
            ),
        )
        .outerjoin(OrderModel, DocumentModel.order_id == OrderModel.id)
        .outerjoin(OrderWmsStateModel, OrderModel.id == OrderWmsStateModel.order_id)
    )
    if effective_scope == "active":
        query = query.filter(
            and_(
                or_(
                    OrderModel.id.is_(None),
                    OrderWmsStateModel.status.in_(ACTIVE_PIPELINE_ORDER_STATUSES),
                    DocumentModel.status.in_(ACTIVE_DOCUMENT_STATUSES),
                ),
                DocumentModel.status.notin_(("completed", "packed", "shipped")),
                or_(
                    OrderModel.id.is_(None),
                    OrderWmsStateModel.status.is_(None),
                    OrderWmsStateModel.status.notin_(ORDER_HIDDEN_STATUSES),
                ),
            )
        )
    elif effective_scope == "archived":
        query = query.filter(DocumentModel.status.in_(("completed", "packed", "shipped")))
    elif effective_scope == "cancelled":
        # Qaytim jarayonidagi buyurtma ham shu tabda — aks holda mollar joyiga
        # qaytarilgunicha u hech qaysi ro'yxatda ko'rinmay qoladi.
        query = query.filter(
            OrderWmsStateModel.status.in_(("cancelled", "cancelling_in_progress"))
        )
    else:
        query = query.filter(
            or_(
                OrderModel.id.is_(None),
                OrderWmsStateModel.status.notin_(ORDER_HIDDEN_STATUSES),
            )
        )
    controller_queue = False
    if user.role == "picker":
        query = query.filter(DocumentModel.assigned_to_user_id == user.id)
        # Tekshiruv navbatiga yuborilgan hujjat yig'uvchi ro'yxatida ko'rinmasin
        query = query.filter(
            or_(
                DocumentModel.status != "picked",
                DocumentModel.sent_to_controller_at.is_(None),
            )
        )
        # Controller tekshirib yakunlagan hujjatlar yig'uvchi ro'yxatida ko'rinmasin
        query = query.filter(DocumentModel.status != "completed")
    elif user.role == "inventory_controller":
        # Navbatdagi (hech kim band qilmagan) + o'zi band qilgan hujjatlar.
        controller_queue = True
        query = query.filter(
            DocumentModel.status == "picked",
            or_(
                DocumentModel.controlled_by_user_id == user.id,
                and_(
                    DocumentModel.controlled_by_user_id.is_(None),
                    DocumentModel.sent_to_controller_at.isnot(None),
                ),
            ),
        )
    if source_group is not None:
        # partition=True — ro'yxat tablari hujjatni yo'qotmasligi uchun.
        query = query.filter(*source_group_conditions(source_group, partition=True))
    if not include_cancelled and effective_scope != "cancelled":
        query = query.filter(DocumentModel.status != "cancelled")
    if effective_wms_group == "yigishda":
        query = query.filter(OrderWmsStateModel.status.in_(("allocated", "picking")))
    elif effective_wms_group == "tekshiruvda":
        query = query.filter(OrderWmsStateModel.status == "picked")
    elif effective_wms_group == "yakunlangan":
        query = query.filter(OrderWmsStateModel.status.in_(("completed", "packed", "shipped")))
    if date_from is not None or date_to is not None:
        # Har tabda "sana" boshqa voqeani anglatadi; eski yozuvlarda maydon bo'sh
        # bo'lishi mumkin — coalesce filtrdan tushib qolmasligi uchun.
        if effective_scope == "archived":
            date_col = func.coalesce(DocumentModel.completed_at, DocumentModel.updated_at)
        elif effective_scope == "cancelled":
            date_col = func.coalesce(OrderWmsStateModel.cancelled_at, DocumentModel.updated_at)
        else:
            date_col = DocumentModel.created_at
        if date_from is not None:
            query = query.filter(date_col >= day_bounds_in_tz(date_from)[0])
        if date_to is not None:
            query = query.filter(date_col <= day_bounds_in_tz(date_to)[1])
    # Controller navbati FIFO: eng ko'p kutgan hujjat tepada.
    order_by = (
        (DocumentModel.sent_to_controller_at.asc(), DocumentModel.created_at.asc())
        if controller_queue
        else (DocumentModel.created_at.desc(),)
    )
    try:
        docs = query.order_by(*order_by).offset(offset).limit(limit).all()
        org_names = _load_org_names(db)
        return [_to_picking_list_item(doc, org_names) for doc in docs]
    except Exception as e:
        logger.exception("list_picking_documents error")
        raise HTTPException(status_code=500, detail="Internal error") from e


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
    # Exclude from consolidated view when picked AND sent to the controller queue.
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
                DocumentModel.sent_to_controller_at.is_(None),
            ),
            DocumentModel.status != "cancelled",
            DocumentModel.status != "completed",
            DocumentModel.status != "cancelling",
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


def _consolidated_product_group_key(line: DocumentLineModel) -> tuple:
    """Group key for umumiy yig'ish — bir mahsulot FEFO bo'lib 2+ qator bo'lsa ham bitta qator.

    Eski kalit (barcode/sku/nom) qatorlarda barcode bo'sh yoki farq qilsa bir xil product_id
    ikki marta chiqishi mumkin edi (masalan 10 + 20 alohida kartochkalar).
    """
    if line.product_id is not None:
        return ("product_id", str(line.product_id))
    first = (line.barcode or line.sku or "").strip()
    return (
        "fallback",
        first,
        (line.product_name or "").strip(),
        (line.sku or "").strip(),
    )


def _units_per_box_from_alternates(alt: List[PickingAlternateLocation]) -> Optional[int]:
    for a in alt:
        boxes = a.box_count
        units = a.units_in_boxes
        if boxes is not None and units is not None and boxes >= 1 and units >= 1:
            upb = units // boxes
            if upb >= 1:
                return upb
    return None


def _suggested_consolidated_pick_qty(
    lines_list: List[ConsolidatedLineItem],
    units_per_box: Optional[int],
) -> tuple[int, int]:
    remainders = consolidated_remainders_by_document(lines_list)
    if not remainders:
        return 0, 0
    total_rem = sum(remainders)
    if not units_per_box or units_per_box < 1:
        return 0, total_rem
    if len(remainders) >= 2:
        return compute_consolidated_box_loose_plan(remainders, units_per_box)
    return total_rem // units_per_box, total_rem % units_per_box


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

    cutoff = _picking_urgency_cutoff_today()
    lines_with_loc = (
        db.query(DocumentLineModel, LocationModel)
        .outerjoin(LocationModel, DocumentLineModel.location_id == LocationModel.id)
        .filter(DocumentLineModel.document_id.in_(doc_ids))
        .order_by(*_picking_route_order_by(urgency_cutoff_date=cutoff))
        .all()
    )
    # Group by product (product_id ustuvor); preserve order of first occurrence
    # Also build per-document line counts from lines_with_loc to avoid touching d.lines after commit (500 fix)
    product_order: List[tuple] = []  # (group_key, product_name, sku, expiry_display)
    groups: dict = {}
    first_line_attrs: dict = {}  # key -> (barcode, sku, product_id) from first line in group
    doc_line_stats: dict = {}  # doc_id -> {"total": int, "done": int}
    line_pick_meta: dict[UUID, tuple[Optional[UUID], Optional[UUID]]] = {}
    for line, loc in lines_with_loc:
        line_pick_meta[line.id] = (line.location_id, line.lot_id)
        doc_id = line.document_id
        doc_line_stats.setdefault(doc_id, {"total": 0, "done": 0})
        doc_line_stats[doc_id]["total"] += 1
        if _line_is_vip_expiry_informational(line) or (line.picked_qty or 0) >= (line.required_qty or 0):
            doc_line_stats[doc_id]["done"] += 1
        key = _consolidated_product_group_key(line)
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
                is_vip_expiry_informational=_line_is_vip_expiry_informational(line),
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
    all_pids = list({first_line_attrs[k][2] for k in first_line_attrs if first_line_attrs[k][2]})
    product_upb_map: dict = {}
    if all_pids:
        for row in (
            db.query(ProductBoxModel.product_id, ProductBoxModel.units_per_box)
            .filter(
                ProductBoxModel.product_id.in_(all_pids),
                ProductBoxModel.is_active.is_(True),
            )
            .all()
        ):
            if row.product_id not in product_upb_map and row.units_per_box and row.units_per_box >= 1:
                product_upb_map[row.product_id] = int(row.units_per_box)
    # Picker consolidated alternates should never suggest showroom bins by default.
    by_pid_consolidated = _balance_rows_by_product(db, all_pids, "main")
    balances: dict[tuple[UUID, UUID], tuple[float, float]] = {}
    for rows_ in by_pid_consolidated.values():
        for r in rows_:
            balances[(r["lot_id"], r["location_id"])] = (
                float(r["on_hand"] or 0),
                float(r["available"] or 0),
            )
    pairs: set[tuple[UUID, UUID]] = set(balances.keys())
    for line, _loc in lines_with_loc:
        if line.lot_id and line.location_id:
            pairs.add((line.lot_id, line.location_id))
    _fill_pick_balances_for_pairs(db, pairs, balances)
    consolidated_bd_map = _breakdown_kwargs_map_for_pairs(db, pairs, balances)
    products = []
    for key, product_name, sku, expiry_display in product_order:
        lines_list = groups[key]
        total_required = sum(l.qty_required for l in lines_list)
        total_picked = sum(
            (l.qty_required if l.is_vip_expiry_informational else l.qty_picked) for l in lines_list
        )
        first_barcode, first_sku, first_product_id = first_line_attrs.get(key, (None, None, None))
        barcode = (
            first_barcode if (first_barcode and str(first_barcode).strip()) else
            (product_barcode_map.get(first_product_id) if first_product_id else None)
        )
        primary_location_id: Optional[UUID] = None
        primary_lot_id: Optional[UUID] = None
        for li in lines_list:
            if li.is_vip_expiry_informational or li.qty_picked >= li.qty_required:
                continue
            loc_id, lot_id = line_pick_meta.get(li.line_id, (None, None))
            primary_location_id = loc_id
            primary_lot_id = lot_id
            break
        alt = (
            _product_level_alternates(
                by_pid_consolidated.get(first_product_id, []),
                bd_map=consolidated_bd_map,
                primary_location_id=primary_location_id,
                primary_lot_id=primary_lot_id,
            )
            if first_product_id
            else []
        )
        upb = product_upb_map.get(first_product_id) if first_product_id else None
        if not upb:
            upb = _units_per_box_from_alternates(alt)
        suggested_boxes, suggested_loose = _suggested_consolidated_pick_qty(lines_list, upb)
        products.append(
            ConsolidatedProduct(
                barcode=barcode if (barcode and str(barcode).strip()) else None,
                sku=first_sku if (first_sku and str(first_sku).strip()) else sku,
                product_name=product_name or "",
                product_id=first_product_id,
                total_required=total_required,
                total_picked=total_picked,
                expiry_date=expiry_display,
                alternate_locations=alt,
                lines=lines_list,
                suggested_box_count=suggested_boxes,
                suggested_loose_qty=suggested_loose,
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

    # Same as get_consolidated: exclude picked+sent-to-controller and completed.
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
                DocumentModel.sent_to_controller_at.is_(None),
            ),
            DocumentModel.status != "cancelled",
            DocumentModel.status != "completed",
            DocumentModel.status != "cancelling",
        )
    )
    doc_ids = [r[0] for r in docs_query.all()]
    if not doc_ids:
        raise HTTPException(status_code=404, detail="Mahsulot topilmadi yoki sizning vazifangizda yo'q")
    # Lines matching barcode (or sku), same sort order as consolidated view.
    # Two-step to avoid PostgreSQL "FOR UPDATE cannot be applied to the nullable side of an outer join":
    # 1) get ordered line IDs (join, no lock); 2) lock only document_lines by those IDs.
    cutoff = _picking_urgency_cutoff_today()
    resolved = resolve_product_scan(db, barcode)
    line_match_filter = (
        DocumentLineModel.product_id == resolved.product_id
        if resolved
        else or_(
            DocumentLineModel.barcode == barcode,
            DocumentLineModel.sku == barcode,
        )
    )
    ordered_ids_query = (
        db.query(DocumentLineModel.id)
        .outerjoin(LocationModel, DocumentLineModel.location_id == LocationModel.id)
        .filter(
            DocumentLineModel.document_id.in_(doc_ids),
            DocumentLineModel.is_vip_expiry_informational.is_(False),
            line_match_filter,
        )
        .order_by(*_picking_route_order_by(urgency_cutoff_date=cutoff))
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
    hybrid_box_barcode = (payload.box_barcode or "").strip()
    hybrid_pick = bool(hybrid_box_barcode) and payload.box_count is not None
    box_pick = not hybrid_pick and is_explicit_box_pick(resolved, payload.box_count)
    unit_pick = not hybrid_pick and resolved is not None and not box_pick
    units_per_box: Optional[Decimal] = None
    boxes_remaining = 0
    loose_remaining = Decimal("0")
    hybrid_upb: Optional[int] = None
    if hybrid_pick:
        if resolved is None or resolved.scan_kind != "unit":
            raise HTTPException(
                status_code=400,
                detail="Gibrid terish uchun mahsulot (dona) barcode kerak",
            )
        assert payload.box_count is not None
        box_units_total, loose_remaining = validate_hybrid_pick_qty(
            db,
            product_id=resolved.product_id,
            box_barcode=hybrid_box_barcode,
            box_count=payload.box_count,
            total_qty=remaining,
        )
        # upb ni qutidan to'g'ridan-to'g'ri olamiz: box_units_total==0 (miqdor bir
        # qutidan kam — quti ochib qutisiz olish) bo'lsa ham bo'linish/assert buzilmasin.
        hybrid_box = (
            db.query(ProductBoxModel)
            .filter(
                ProductBoxModel.box_barcode == hybrid_box_barcode,
                ProductBoxModel.is_active.is_(True),
            )
            .one_or_none()
        )
        if hybrid_box is None or int(hybrid_box.units_per_box) < 1:
            raise HTTPException(status_code=400, detail="Quti topilmadi yoki noto'g'ri")
        hybrid_upb = int(hybrid_box.units_per_box)
        # box_units_total==0 -> to'liq quti terilmaydi, faqat qutisiz (quti ochiladi).
        boxes_remaining = payload.box_count if box_units_total > 0 else 0
    elif box_pick:
        units_per_box = Decimal(str(resolved.units_per_scan))
        expected_qty = units_per_box * Decimal(str(payload.box_count))
        if remaining != expected_qty:
            raise HTTPException(
                status_code=400,
                detail=f"qty {int(remaining)} != box_count * units_per_box ({int(expected_qty)})",
            )
        boxes_remaining = payload.box_count
    first_picked_line_id: Optional[UUID] = None
    docs_to_refresh = set()
    doc_rows = (
        db.query(DocumentModel.id, DocumentModel.order_id)
        .filter(DocumentModel.id.in_(doc_ids))
        .all()
    )
    order_ids_for_pick = [r[1] for r in doc_rows if r[1] is not None]
    orders_by_id: dict[UUID, OrderModel] = {}
    if order_ids_for_pick:
        for o in db.query(OrderModel).filter(OrderModel.id.in_(order_ids_for_pick)).all():
            orders_by_id[o.id] = o
    doc_order_map: dict[UUID, Optional[OrderModel]] = {
        r[0]: orders_by_id.get(r[1]) if r[1] else None for r in doc_rows
    }
    try:
        for line in lines:
            if remaining <= 0:
                break
            line_remaining = Decimal(str(line.required_qty or 0)) - Decimal(str(line.picked_qty or 0))
            if line_remaining <= 0:
                continue
            if hybrid_pick:
                assert hybrid_upb is not None and hybrid_upb >= 1
                max_pick = min(remaining, line_remaining)
                line_boxes = min(boxes_remaining, int(max_pick // hybrid_upb))
                box_qty = Decimal(str(line_boxes * hybrid_upb))
                loose_qty = min(loose_remaining, max_pick - box_qty)
                need = box_qty + loose_qty
            elif box_pick:
                assert units_per_box is not None
                max_pick = min(remaining, line_remaining)
                line_boxes = min(boxes_remaining, int(max_pick // units_per_box))
                if line_boxes <= 0:
                    continue
                need = Decimal(str(line_boxes)) * units_per_box
            else:
                need = min(remaining, line_remaining)
            if need <= 0:
                continue
            if not line.product_id or not line.lot_id or not line.location_id:
                raise HTTPException(
                    status_code=409,
                    detail="Pick line missing allocation details (product/lot/location). Allocate the order first.",
                )
            loc = db.query(LocationModel).filter(LocationModel.id == line.location_id).one_or_none()
            # Qator ajratishda biriktirilgan joy — chegirmali qatorda EXPIRED bo'lishi mumkin.
            _assert_pick_zone_allowed(loc, allow_expired=True)
            assert_location_allowed_for_pick(
                db,
                line.location_id,
                order=doc_order_map.get(line.document_id),
            )
            # Ajratilgan (reserved) zaxiradan teriladi — available=0 bo‘lishi mumkin (waves pick bilan bir xil).
            require_sufficient_reserved(
                db,
                line.product_id,
                line.lot_id,
                line.location_id,
                need,
                lock=True,
            )
            if hybrid_pick:
                assert hybrid_upb is not None
                line_boxes = int(box_qty // hybrid_upb) if hybrid_upb else 0
                apply_hybrid_pick_side_effects(
                    db,
                    product_id=line.product_id,
                    lot_id=line.lot_id,
                    location_id=line.location_id,
                    user=user,
                    box_barcode=hybrid_box_barcode,
                    box_count=line_boxes,
                    box_units=box_qty,
                    loose_units=loose_qty,
                    source_document_id=line.document_id,
                )
                boxes_remaining -= line_boxes
                loose_remaining -= loose_qty
            elif box_pick:
                line_boxes = int(need // units_per_box)
                remove_sealed_boxes_for_pick(
                    db,
                    box_barcode=barcode,
                    location_id=line.location_id,
                    lot_id=line.lot_id,
                    user=user,
                    box_count=line_boxes,
                    pick_qty=need,
                    source_document_id=line.document_id,
                )
                boxes_remaining -= line_boxes
            elif unit_pick:
                apply_scan_pick_side_effects(
                    db,
                    resolved=resolved,
                    box_count=payload.box_count,
                    qty_delta=need,
                    product_id=line.product_id,
                    lot_id=line.lot_id,
                    location_id=line.location_id,
                    user=user,
                    scan_barcode=barcode,
                    source_document_id=line.document_id,
                )
            picked_box = _picked_box_barcode_from_pick_payload(
                scan_barcode=barcode,
                box_barcode=payload.box_barcode,
                box_count=payload.box_count,
                resolved=resolved,
            )
            if picked_box:
                line.picked_box_barcode = picked_box
            line.picked_qty = float(Decimal(str(line.picked_qty or 0)) + need)
            _mark_line_picked(line)
            docs_to_refresh.add(line.document_id)
            record_pick(
                db,
                product_id=line.product_id,
                lot_id=line.lot_id,
                location_id=line.location_id,
                qty=need,
                document_id=line.document_id,
                created_by_user_id=user.id,
            )
            if first_picked_line_id is None:
                first_picked_line_id = line.id
            remaining -= need

        if box_pick and (remaining > 0 or boxes_remaining > 0):
            raise HTTPException(
                status_code=409,
                detail="Quti terish: buyurtma qatorlarida yetarli joy yo'q",
            )

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
                    if order and order.wms_state and order.wms_state.status == "allocated":
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
    """Xodimning o'z ko'rsatkichi — admin paneldagi hisob bilan bir xil qoidada.

    Rolga qarab ajratiladi: yig'uvchi controllerga yuborgan paytdan sanaladi
    (controller yakunlashini kutmaydi, aks holda o'z ishini kun bo'yi 0 ko'rardi),
    controller esa yakunlagan paytdan. Kun chegarasi ombor vaqtida olinadi —
    kechqurungi ish ertangi kunga o'tib ketmasin.
    """
    days = max(1, min(31, days))
    is_controller = user.role == "inventory_controller"

    if is_controller:
        user_col = DocumentModel.controlled_by_user_id
        statuses = ("completed", "packed", "shipped")
        ts_col = func.coalesce(DocumentModel.completed_at, DocumentModel.updated_at)
    else:
        user_col = DocumentModel.assigned_to_user_id
        statuses = ("picked", "completed", "packed", "shipped")
        ts_col = func.coalesce(
            DocumentModel.sent_to_controller_at,
            DocumentModel.completed_at,
            DocumentModel.updated_at,
        )

    base_filters = [
        DocumentModel.doc_type == "SO",
        DocumentModel.status.in_(statuses),
        user_col == user.id,
    ]

    today = datetime.now(BUSINESS_TZ).date()
    start_date = today - timedelta(days=days - 1)
    window_start, _ = day_bounds_in_tz(start_date)
    _, window_end = day_bounds_in_tz(today)

    total_completed = (
        db.query(func.count(DocumentModel.id)).filter(and_(*base_filters)).scalar() or 0
    )
    window_rows = [
        r[0]
        for r in db.query(ts_col)
        .filter(and_(*base_filters, ts_col >= window_start, ts_col <= window_end))
        .all()
    ]

    # Bekor qilingan buyurtmadagi terish ham xodimning ishi (admin paneli ham
    # shunday sanaydi) — mobil raqam menejernikidan kam ko'rinmasligi kerak.
    if not is_controller:
        cancel_ts = func.coalesce(
            db.query(func.max(DocumentLineModel.picked_at))
            .filter(DocumentLineModel.document_id == DocumentModel.id)
            .scalar_subquery(),
            SafeCancelReturnSessionModel.created_at,
        )
        cancel_q = (
            db.query(cancel_ts)
            .join(DocumentModel, DocumentModel.id == SafeCancelReturnSessionModel.document_id)
            .filter(DocumentModel.assigned_to_user_id == user.id)
        )
        total_completed += cancel_q.count()
        window_rows.extend(
            r[0]
            for r in cancel_q.filter(cancel_ts >= window_start, cancel_ts <= window_end).all()
        )

    per_day: dict = defaultdict(int)
    for ts in window_rows:
        if ts is None:
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        per_day[ts.astimezone(BUSINESS_TZ).date()] += 1

    by_day = [
        MyPickerStatsDay(
            date=(start_date + timedelta(days=i)).isoformat(),
            count=per_day.get(start_date + timedelta(days=i), 0),
        )
        for i in range(days)
    ]
    return MyPickerStatsResponse(
        total_completed=total_completed,
        completed_today=per_day.get(today, 0),
        by_day=by_day,
    )


# Ish haqi davri kalendar oyi emas: 26-sanadan keyingi oyning 25-sanasigacha.
PAYROLL_PERIOD_START_DAY = 26


def _payroll_period_bounds(today: date, offset: int = 0) -> tuple[date, date]:
    """`offset` 0 — joriy davr, -1 — oldingi va h.k."""
    year, month = today.year, today.month
    if today.day < PAYROLL_PERIOD_START_DAY:
        month -= 1
    month += offset
    while month <= 0:
        month += 12
        year -= 1
    while month > 12:
        month -= 12
        year += 1
    start = date(year, month, PAYROLL_PERIOD_START_DAY)
    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    end = date(next_year, next_month, PAYROLL_PERIOD_START_DAY - 1)
    return start, end


@router.get(
    "/my-period-stats",
    response_model=MyPeriodStatsResponse,
    summary="Ish haqi davri bo'yicha kunma-kun ko'rsatkich (26 -> keyingi oy 25)",
)
async def get_my_period_stats(
    offset: int = 0,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:read")),
):
    """Davr ichida kunma-kun: buyurtma, pozitsiya, dona — shahar/viloyat bo'yicha.

    Summa serverda hisoblanadi: tarif bazada turadi, o'zgarsa hamma darrov bir
    xil raqamni ko'radi. Faqat ish bo'lgan kunlar qaytariladi.
    """
    offset = max(-24, min(0, offset))
    period_from, period_to = _payroll_period_bounds(datetime.now(BUSINESS_TZ).date(), offset)
    window_start, _ = day_bounds_in_tz(period_from)
    _, window_end = day_bounds_in_tz(period_to)

    is_controller = user.role == "inventory_controller"
    if is_controller:
        user_col = DocumentModel.controlled_by_user_id
        statuses = ("completed", "packed", "shipped")
        ts_col = func.coalesce(DocumentModel.completed_at, DocumentModel.updated_at)
    else:
        user_col = DocumentModel.assigned_to_user_id
        statuses = ("picked", "completed", "packed", "shipped")
        ts_col = func.coalesce(
            DocumentModel.sent_to_controller_at,
            DocumentModel.completed_at,
            DocumentModel.updated_at,
        )

    # Tarif davr boshiga qarab: to'langan oy keyingi tarifda qayta hisoblanmasin.
    rates = load_rates(db, payroll_role_for(user.role), period_from)

    line_agg = (
        db.query(
            DocumentLineModel.document_id.label("doc_id"),
            func.count(DocumentLineModel.id).label("poz"),
            func.coalesce(func.sum(DocumentLineModel.picked_qty), 0).label("dona"),
        )
        .group_by(DocumentLineModel.document_id)
        .subquery()
    )
    rows = (
        db.query(
            ts_col.label("ts"),
            func.coalesce(line_agg.c.poz, 0).label("poz"),
            func.coalesce(line_agg.c.dona, 0).label("dona"),
            OrderModel.source.label("source"),
        )
        .outerjoin(line_agg, line_agg.c.doc_id == DocumentModel.id)
        .outerjoin(OrderModel, OrderModel.id == DocumentModel.order_id)
        .filter(
            DocumentModel.doc_type == "SO",
            DocumentModel.status.in_(statuses),
            user_col == user.id,
            ts_col >= window_start,
            ts_col <= window_end,
        )
        .all()
    )

    def _empty_group() -> dict:
        return {"orders": 0, "positions": 0, "qty": 0.0}

    per_day: dict = defaultdict(
        lambda: {SOURCE_GROUP_CITY: _empty_group(), SOURCE_GROUP_REGION: _empty_group()}
    )

    def _add(ts, poz, dona, source) -> None:
        if ts is None:
            return
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        # Guruh ta'rifi admin paneldagi bilan bir xil: `diller` -> viloyat, qolgani shahar.
        group = (
            SOURCE_GROUP_REGION
            if (source or "").strip().lower() == REGION_SOURCE
            else SOURCE_GROUP_CITY
        )
        bucket = per_day[ts.astimezone(BUSINESS_TZ).date()][group]
        bucket["orders"] += 1
        bucket["positions"] += int(poz or 0)
        bucket["qty"] += float(dona or 0)

    for r in rows:
        _add(r.ts, r.poz, r.dona, r.source)

    # Bekor qilingan terish ham xodimning ishi (admin paneli ham shunday sanaydi).
    if not is_controller:
        cancel_lines = (
            db.query(
                SafeCancelReturnLineModel.session_id.label("sid"),
                func.count(SafeCancelReturnLineModel.id).label("poz"),
                func.coalesce(func.sum(SafeCancelReturnLineModel.qty_to_return), 0).label("dona"),
            )
            .group_by(SafeCancelReturnLineModel.session_id)
            .subquery()
        )
        cancel_ts = func.coalesce(
            db.query(func.max(DocumentLineModel.picked_at))
            .filter(DocumentLineModel.document_id == DocumentModel.id)
            .scalar_subquery(),
            SafeCancelReturnSessionModel.created_at,
        )
        cancel_rows = (
            db.query(
                cancel_ts.label("ts"),
                func.coalesce(cancel_lines.c.poz, 0).label("poz"),
                func.coalesce(cancel_lines.c.dona, 0).label("dona"),
                OrderModel.source.label("source"),
            )
            .join(DocumentModel, DocumentModel.id == SafeCancelReturnSessionModel.document_id)
            .outerjoin(cancel_lines, cancel_lines.c.sid == SafeCancelReturnSessionModel.id)
            .outerjoin(OrderModel, OrderModel.id == DocumentModel.order_id)
            .filter(
                DocumentModel.assigned_to_user_id == user.id,
                cancel_ts >= window_start,
                cancel_ts <= window_end,
            )
            .all()
        )
        for r in cancel_rows:
            _add(r.ts, r.poz, r.dona, r.source)

    def _group_out(raw: dict, group: str) -> MyPeriodStatsGroup:
        return MyPeriodStatsGroup(
            orders=raw["orders"],
            positions=raw["positions"],
            qty=round(raw["qty"], 3),
            # Ball pozitsiyaga hisoblanadi: mehnat buyurtma soniga emas, ichidagi
            # qatorlar soniga bog'liq.
            amount=float(Decimal(raw["positions"]) * rates[group]),
        )

    days: List[MyPeriodStatsDay] = []
    for day, groups in sorted(per_day.items()):
        city = _group_out(groups[SOURCE_GROUP_CITY], SOURCE_GROUP_CITY)
        region = _group_out(groups[SOURCE_GROUP_REGION], SOURCE_GROUP_REGION)
        days.append(
            MyPeriodStatsDay(
                date=day.isoformat(),
                orders=city.orders + region.orders,
                positions=city.positions + region.positions,
                qty=round(city.qty + region.qty, 3),
                amount=round(city.amount + region.amount, 2),
                shahar=city,
                region=region,
            )
        )

    def _sum(attr: str, group: str) -> float:
        return sum(getattr(getattr(d, group), attr) for d in days)

    totals_city = MyPeriodStatsGroup(
        orders=int(_sum("orders", "shahar")),
        positions=int(_sum("positions", "shahar")),
        qty=round(_sum("qty", "shahar"), 3),
        amount=round(_sum("amount", "shahar"), 2),
    )
    totals_region = MyPeriodStatsGroup(
        orders=int(_sum("orders", "region")),
        positions=int(_sum("positions", "region")),
        qty=round(_sum("qty", "region"), 3),
        amount=round(_sum("amount", "region"), 2),
    )
    return MyPeriodStatsResponse(
        period_from=period_from.isoformat(),
        period_to=period_to.isoformat(),
        rate_shahar=float(rates[SOURCE_GROUP_CITY]),
        rate_region=float(rates[SOURCE_GROUP_REGION]),
        days=days,
        totals=MyPeriodStatsTotals(
            orders=totals_city.orders + totals_region.orders,
            positions=totals_city.positions + totals_region.positions,
            qty=round(totals_city.qty + totals_region.qty, 3),
            amount=round(totals_city.amount + totals_region.amount, 2),
            shahar=totals_city,
            region=totals_region,
        ),
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
    summary="Send picked document to the controller queue (pool)",
)
async def send_to_controller(
    document_id: UUID,
    payload: Optional[SendToControllerRequest] = Body(None),
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:send_to_controller")),
):
    """Yig'uvchi hujjatni umumiy tekshiruv navbatiga yuboradi.

    Controller tanlanmaydi: hujjatni istalgan controller ro'yxatidan olib (claim qilib)
    tekshiradi. `controller_user_id` eski mobil ilovalar uchun qabul qilinadi, ishlatilmaydi.
    """
    _ = payload
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
    if document.status == "cancelling":
        raise HTTPException(
            status_code=409,
            detail="Buyurtma xavfsiz bekor rejimida: avval qaytarish tugallansin",
        )
    if document.status != "picked":
        raise HTTPException(status_code=409, detail="Document must be in picked status")
    if document.sent_to_controller_at is not None:
        raise HTTPException(status_code=409, detail="Already sent to controller")
    document.sent_to_controller_at = datetime.now(timezone.utc)
    db.commit()
    return _to_picking_document(document, db)


@router.post(
    "/documents/{document_id}/claim",
    response_model=PickingDocument,
    summary="Controller claims a document from the queue",
)
async def claim_document_for_controller(
    request: Request,
    document_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:read")),
):
    """Controller navbatdagi hujjatni o'ziga band qiladi; band bo'lsa 409.

    Takroriy chaqiruv (o'zi band qilgan hujjat) muvaffaqiyatli qaytadi.
    """
    if user.role != "inventory_controller":
        raise HTTPException(status_code=403, detail="Forbidden")
    document = (
        db.query(DocumentModel)
        .filter(DocumentModel.id == document_id)
        .with_for_update()
        .one_or_none()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.status != "picked":
        raise HTTPException(status_code=409, detail="Document must be in picked status")
    claimed = _claim_for_controller(document, user)
    if claimed:
        log_action(
            db,
            user_id=user.id,
            action=ACTION_UPDATE,
            entity_type="picking_document",
            entity_id=str(document.id),
            new_data={"event": "controller_claim", "controlled_by_user_id": str(user.id)},
            ip_address=get_client_ip(request),
        )
    db.commit()
    db.refresh(document)
    return _to_picking_document(document, db)


@router.post(
    "/documents/{document_id}/release",
    response_model=PickingDocument,
    summary="Controller releases a claimed document back to the queue",
)
async def release_document_to_pool(
    request: Request,
    document_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:read")),
):
    """Controller o'zi band qilgan hujjatni navbatga qaytaradi (skan boshlanmagan bo'lsa)."""
    if user.role != "inventory_controller":
        raise HTTPException(status_code=403, detail="Forbidden")
    document = (
        db.query(DocumentModel)
        .filter(DocumentModel.id == document_id)
        .with_for_update()
        .one_or_none()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.controlled_by_user_id != user.id:
        raise HTTPException(status_code=403, detail="Document not assigned to you")
    if document.status != "picked":
        raise HTTPException(status_code=409, detail="Document must be in picked status")
    if document.controller_verification_started_at is not None:
        raise HTTPException(
            status_code=409,
            detail="Tekshiruv boshlangan — navbatga qaytarib bo'lmaydi",
        )
    document.controlled_by_user_id = None
    document.controller_claimed_at = None
    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="picking_document",
        entity_id=str(document.id),
        old_data={"controlled_by_user_id": str(user.id)},
        new_data={"event": "controller_release", "controlled_by_user_id": None},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(document)
    return _to_picking_document(document, db)


@router.post(
    "/documents/{document_id}/controller-verification-started",
    response_model=PickingDocument,
    summary="Mark controller verification started (first scan/confirm)",
)
async def mark_controller_verification_started(
    document_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:read")),
):
    """Controller birinchi marta skan/tekshiruvni boshlaganda chaqiriladi; ochish (GET) yetarli emas.

    Hujjat hali navbatda bo'lsa — shu yerda avtomatik band qilinadi (eski ilovalar uchun).
    """
    if user.role != "inventory_controller":
        raise HTTPException(status_code=403, detail="Forbidden")
    document = (
        db.query(DocumentModel)
        .filter(DocumentModel.id == document_id)
        .with_for_update()
        .one_or_none()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.status != "picked":
        raise HTTPException(status_code=409, detail="Document must be in picked status")
    _claim_for_controller(document, user)
    if document.controller_verification_started_at is None:
        document.controller_verification_started_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(document)
    return _to_picking_document(document, db)


def _product_level_alternates(
    rows: list[dict],
    *,
    bd_map: dict[tuple[UUID, UUID], dict],
    primary_location_id: Optional[UUID] = None,
    primary_lot_id: Optional[UUID] = None,
    max_rows: int = 24,
) -> List[PickingAlternateLocation]:
    out: List[PickingAlternateLocation] = []
    for r in rows:
        if len(out) >= max_rows:
            break
        av = float(r["available"] or 0)
        is_pri = (
            primary_location_id is not None
            and primary_lot_id is not None
            and r["location_id"] == primary_location_id
            and r["lot_id"] == primary_lot_id
        )
        if av <= 0 and not is_pri:
            continue
        bd_kw = bd_map.get((r["lot_id"], r["location_id"]), {})
        out.append(
            PickingAlternateLocation(
                location_id=r["location_id"],
                location_code=r["location_code"] or "",
                lot_id=r["lot_id"],
                available_qty=av,
                batch=r.get("batch"),
                expiry_date=_safe_expiry_date(r.get("expiry_date")),
                is_primary=is_pri,
                **bd_kw,
            )
        )
    return out


@router.post(
    "/lines/{line_id}/change-pick-source",
    response_model=PickLineResponse,
    summary="Qolgan terishni boshqa NORMAL lokatsiya/partiyaga ko‘chirish (zaxira yozuvlari)",
)
async def change_pick_source(
    line_id: UUID,
    payload: ChangePickSourceRequest,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
    _guard=Depends(require_permission("picking:pick")),
):
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
        .options(selectinload(DocumentModel.order))
        .filter(DocumentModel.id == line.document_id)
        .with_for_update()
        .one_or_none()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if user.role == "picker" and document.assigned_to_user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if document.order_id and order_in_cancelling_flow(db, document.order_id):
        raise HTTPException(
            status_code=409,
            detail="Buyurtma bekor qilinmoqda: avval terilganlarni joyiga qaytaring.",
        )
    if line.skip_reason:
        raise HTTPException(status_code=409, detail="Line is skipped")
    if _line_is_vip_expiry_informational(line):
        raise HTTPException(status_code=409, detail="VIP muddat: bu qator faqat ma'lumot, manba almashtirilmaydi")
    if not document.order_id:
        raise HTTPException(
            status_code=409,
            detail="Buyurtmasiz hujjat: manbani almashtirib bo‘lmaydi",
        )
    if not line.product_id:
        raise HTTPException(status_code=409, detail="Line missing product_id")

    req = Decimal(str(line.required_qty or 0))
    picked = Decimal(str(line.picked_qty or 0))
    rem = req - picked
    if rem <= 0:
        raise HTTPException(status_code=400, detail="Line already fully picked")

    if payload.location_id == line.location_id and payload.lot_id == line.lot_id:
        raise HTTPException(status_code=400, detail="Already using this location and lot")

    new_loc = db.query(LocationModel).filter(LocationModel.id == payload.location_id).one_or_none()
    # Chegirmali qator EXPIRED'dan ajratilgan bo'lsa, boshqa EXPIRED joyga ham
    # o'tishi mumkin; oddiy qator esa faqat NORMAL ichida qoladi.
    cur_loc = (
        db.query(LocationModel).filter(LocationModel.id == line.location_id).one_or_none()
        if line.location_id
        else None
    )
    _assert_pick_zone_allowed(
        new_loc,
        allow_expired=bool(cur_loc and cur_loc.zone_type == "EXPIRED"),
    )
    assert_location_allowed_for_pick(db, payload.location_id, order=document.order)

    new_lot = db.query(StockLotModel).filter(StockLotModel.id == payload.lot_id).one_or_none()
    if not new_lot or new_lot.product_id != line.product_id:
        raise HTTPException(status_code=400, detail="Invalid lot for this product")

    bals = _get_lot_level_balances(db, [line.product_id], location_id=payload.location_id)
    match = next((r for r in bals if r["lot_id"] == payload.lot_id), None)
    if not match or float(match["available"] or 0) < float(rem):
        raise HTTPException(
            status_code=409,
            detail="Tanlangan joyda qolgan terish uchun yetarli qoldiq yo‘q",
        )

    if line.lot_id and line.location_id:
        if picked == 0:
            db.add(
                StockMovementModel(
                    product_id=line.product_id,
                    lot_id=line.lot_id,
                    location_id=line.location_id,
                    qty_change=-req,
                    movement_type="allocate",
                    source_document_type="order",
                    source_document_id=document.order_id,
                    created_by_user_id=user.id,
                )
            )
        else:
            db.add(
                StockMovementModel(
                    product_id=line.product_id,
                    lot_id=line.lot_id,
                    location_id=line.location_id,
                    qty_change=-rem,
                    movement_type="unallocate",
                    source_document_type="document",
                    source_document_id=document.id,
                    created_by_user_id=user.id,
                )
            )

    db.add(
        StockMovementModel(
            product_id=line.product_id,
            lot_id=payload.lot_id,
            location_id=payload.location_id,
            qty_change=rem,
            movement_type="allocate",
            source_document_type="order",
            source_document_id=document.order_id,
            created_by_user_id=user.id,
        )
    )

    line.location_id = payload.location_id
    line.lot_id = payload.lot_id
    line.location_code = new_loc.code or ""
    line.batch = new_lot.batch
    line.expiry_date = new_lot.expiry_date

    db.commit()
    db.refresh(line)
    lines_after = (
        db.query(DocumentLineModel)
        .filter(DocumentLineModel.document_id == document.id)
        .all()
    )
    pline = _picking_lines_with_alternates(db, document, [line])[0]
    return PickLineResponse(
        line=pline,
        progress=_calculate_progress(lines_after),
        document_status=document.status,
    )


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
    if document.order_id and order_in_cancelling_flow(db, document.order_id):
        raise HTTPException(
            status_code=409,
            detail="Buyurtma bekor qilinmoqda: avval terilganlarni joyiga qaytaring.",
        )
    if _line_is_vip_expiry_informational(line):
        raise HTTPException(
            status_code=409,
            detail="VIP muddat: bu qator faqat ma'lumot uchun, terilmaydi",
        )

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
    # Qator ajratishda biriktirilgan joy — chegirmali qatorda EXPIRED bo'lishi mumkin.
    _assert_pick_zone_allowed(loc, allow_expired=True)

    order_for_pick: Optional[OrderModel] = None
    if document.order_id:
        order_for_pick = (
            db.query(OrderModel).filter(OrderModel.id == document.order_id).one_or_none()
        )

    line.picked_qty = next_qty
    if payload.delta > 0:
        _mark_line_picked(line)
    elif next_qty <= 0:
        _clear_line_picked(line)
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

    if qty_delta > 0:
        assert_location_allowed_for_pick(db, line.location_id, order=order_for_pick)
        # Yig'ishga yuborilganda allocate qilingan — terish reserved dan, available emas.
        require_sufficient_reserved(
            db,
            line.product_id,
            line.lot_id,
            line.location_id,
            qty_delta,
            lock=True,
        )
        scan_barcode = (payload.barcode or "").strip()
        hybrid_box_barcode = (payload.box_barcode or "").strip()
        resolved: ProductScanResolve | None = None
        if hybrid_box_barcode and payload.box_count is not None:
            if not scan_barcode:
                raise HTTPException(status_code=400, detail="barcode required for hybrid pick")
            resolved = resolve_product_scan(db, scan_barcode)
            if not resolved or resolved.scan_kind != "unit":
                raise HTTPException(
                    status_code=400,
                    detail="Gibrid terish uchun mahsulot (dona) barcode kerak",
                )
            if resolved.product_id != line.product_id:
                raise HTTPException(status_code=400, detail="Mahsulot mos emas")
            box_units, loose_units = validate_hybrid_pick_qty(
                db,
                product_id=line.product_id,
                box_barcode=hybrid_box_barcode,
                box_count=payload.box_count,
                total_qty=qty_delta,
            )
            apply_hybrid_pick_side_effects(
                db,
                product_id=line.product_id,
                lot_id=line.lot_id,
                location_id=line.location_id,
                user=user,
                box_barcode=hybrid_box_barcode,
                box_count=payload.box_count,
                box_units=box_units,
                loose_units=loose_units,
                source_document_id=document.id,
            )
        elif scan_barcode:
            resolved = resolve_product_scan(db, scan_barcode)
            apply_scan_pick_side_effects(
                db,
                resolved=resolved,
                box_count=payload.box_count,
                qty_delta=qty_delta,
                product_id=line.product_id,
                lot_id=line.lot_id,
                location_id=line.location_id,
                user=user,
                scan_barcode=scan_barcode,
                source_document_id=document.id,
            )
        picked_box = _picked_box_barcode_from_pick_payload(
            scan_barcode=scan_barcode,
            box_barcode=payload.box_barcode,
            box_count=payload.box_count,
            resolved=resolved,
        )
        if picked_box:
            line.picked_box_barcode = picked_box

    try:
        record_pick(
            db,
            product_id=line.product_id,
            lot_id=line.lot_id,
            location_id=line.location_id,
            qty=qty_delta,
            document_id=document.id,
            created_by_user_id=user.id,
        )
        if document.order_id:
            order = (
                db.query(OrderModel)
                .options(selectinload(OrderModel.wms_state))
                .filter(OrderModel.id == document.order_id)
                .with_for_update()
                .one_or_none()
            )
            if order and order.wms_state and order.wms_state.status == "allocated":
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

    cutoff = _picking_urgency_cutoff_today()
    ordered_ids = [
        r[0]
        for r in db.query(DocumentLineModel.id)
        .outerjoin(LocationModel, DocumentLineModel.location_id == LocationModel.id)
        .filter(DocumentLineModel.document_id == document.id)
        .order_by(*_picking_route_order_by(urgency_cutoff_date=cutoff))
        .all()
    ]
    if not ordered_ids:
        lines = []
    else:
        lines_locked = (
            db.query(DocumentLineModel)
            .filter(DocumentLineModel.id.in_(ordered_ids))
            .with_for_update()
            .all()
        )
        order_map = {lid: i for i, lid in enumerate(ordered_ids)}
        lines = sorted(lines_locked, key=lambda L: order_map[L.id])
    _refresh_document_status(document, lines)
    db.commit()

    return PickLineResponse(
        line=_to_picking_line(line),
        progress=_calculate_progress(lines),
        document_status=document.status,
    )


class SkipLineRequest(BaseModel):
    reason: str


class UnpickLineRequest(BaseModel):
    delta: int
    reason: str
    request_id: str

    @field_validator("delta")
    @classmethod
    def delta_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("delta must be >= 1")
        if v > 10000:
            raise ValueError("delta must be <= 10000")
        return v


def _assert_pick_line_access(
    db: Session, user, document: DocumentModel, *, claim: bool = True
) -> None:
    """Qator ustida ish qilish huquqi.

    Controller uchun: hujjat navbatda bo'lsa (hech kim band qilmagan) shu yerda band
    qilinadi; boshqa controller band qilgan bo'lsa 409.
    """
    if user.role == "picker" and document.assigned_to_user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if user.role != "inventory_controller":
        return
    if document.controlled_by_user_id == user.id:
        return
    if not claim or document.sent_to_controller_at is None:
        raise HTTPException(status_code=403, detail="Forbidden")
    _lock_document_row(db, document.id)
    _claim_for_controller(document, user)


@router.post(
    "/lines/{line_id}/unpick",
    response_model=PickLineResponse,
    summary="Partially rollback picked qty with reason",
)
async def unpick_line(
    line_id: UUID,
    payload: UnpickLineRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:pick")),
):
    if not payload.reason or payload.reason.strip() not in INCOMPLETE_REASON_CODES:
        raise HTTPException(
            status_code=400,
            detail=f"reason must be one of: {list(INCOMPLETE_REASON_CODES)}",
        )
    reason = payload.reason.strip()

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
        _assert_pick_line_access(db, user, document, claim=False)
        return PickLineResponse(
            line=_to_picking_line(line),
            progress=_calculate_progress(document.lines),
            document_status=document.status,
        )

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
    _assert_pick_line_access(db, user, document)
    if document.order_id and order_in_cancelling_flow(db, document.order_id):
        raise HTTPException(
            status_code=409,
            detail="Buyurtma bekor qilinmoqda: avval terilganlarni joyiga qaytaring.",
        )
    if _line_is_vip_expiry_informational(line):
        raise HTTPException(
            status_code=409,
            detail="VIP muddat: bu qator faqat ma'lumot uchun, terilmaydi",
        )
    if line.picked_qty <= 0:
        raise HTTPException(status_code=400, detail="Line has no picked qty to rollback")
    if Decimal(str(payload.delta)) > Decimal(str(line.picked_qty)):
        raise HTTPException(status_code=400, detail="delta cannot exceed qty_picked")
    if not line.product_id or not line.lot_id or not line.location_id:
        raise HTTPException(status_code=400, detail="Line missing product/lot/location")

    qty_to_rollback = Decimal(str(payload.delta))
    line.picked_qty = float(Decimal(str(line.picked_qty)) - qty_to_rollback)
    if line.picked_qty <= 0:
        line.picked_box_barcode = None
        _clear_line_picked(line)
    line.skip_reason = reason

    # Stock+rezerv tiklash + butun-quti pick'larini yopiq qaytarish + invariant.
    record_pick_rollback(
        db,
        product_id=line.product_id,
        lot_id=line.lot_id,
        location_id=line.location_id,
        qty=qty_to_rollback,
        document_id=document.id,
        created_by_user_id=user.id,
    )

    lines = (
        db.query(DocumentLineModel)
        .filter(DocumentLineModel.document_id == document.id)
        .all()
    )
    _refresh_document_status(document, lines)
    try:
        db.add(PickRequest(request_id=payload.request_id, line_id=line.id))
        db.commit()
    except IntegrityError as e:
        db.rollback()
        logger.warning("unpick_line IntegrityError: %s", e)
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
            _assert_pick_line_access(db, user, document, claim=False)
            return PickLineResponse(
                line=_to_picking_line(line),
                progress=_calculate_progress(document.lines),
                document_status=document.status,
            )
        raise HTTPException(status_code=409, detail="Unpick conflict (duplicate or constraint).")

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
    if document.order_id and order_in_cancelling_flow(db, document.order_id):
        raise HTTPException(
            status_code=409,
            detail="Buyurtma bekor qilinmoqda: avval terilganlarni joyiga qaytaring.",
        )
    if _line_is_vip_expiry_informational(line):
        raise HTTPException(
            status_code=409,
            detail="VIP muddat: bu qator faqat ma'lumot uchun, skip qilinmaydi",
        )

    # Terilmagan qatorga ham sabab qo'yish mumkin (nuqsonli/yo'q mahsulotni
    # termasdan belgilash). Faqat terilgan bo'lsa stock/rezerv tiklanadi.
    qty_to_reverse = Decimal(str(line.picked_qty or 0))
    line.skip_reason = reason
    if qty_to_reverse > 0:
        if not line.product_id or not line.lot_id or not line.location_id:
            raise HTTPException(
                status_code=400,
                detail="Line missing product/lot/location",
            )
        line.picked_qty = 0
        line.picked_box_barcode = None
        _clear_line_picked(line)
        # Stock+rezerv tiklash + butun-quti pick'larini yopiq qaytarish + invariant.
        record_pick_rollback(
            db,
            product_id=line.product_id,
            lot_id=line.lot_id,
            location_id=line.location_id,
            qty=qty_to_reverse,
            document_id=document.id,
            created_by_user_id=user.id,
        )

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


# Controller tekshirishда qatorni sabab bilan belgilaganда stock qayerga ketadi.
# Nuqsonli -> brak zonaga, muddati o'tган -> muddat zonasiga; qolgani joyiga qaytadi.
_CONTROLLER_FLAG_ZONE_BY_REASON = {"damaged": "DAMAGED", "expired": "EXPIRED"}


def _resolve_default_zone_location(
    db: Session, source_location_id, zone_type: str
) -> Optional[LocationModel]:
    """Manba joyning ombori (warehouse_id) bo'yicha standart DAMAGED/EXPIRED joy.
    Bir nechta bo'lsa kod bo'yicha birinchisi. Topilmasa None."""
    src = db.get(LocationModel, source_location_id)
    wh_id = getattr(src, "warehouse_id", None) if src else None
    q = db.query(LocationModel).filter(
        LocationModel.zone_type == zone_type,
        LocationModel.is_active.is_(True),
    )
    if wh_id is not None:
        q = q.filter(LocationModel.warehouse_id == wh_id)
    return q.order_by(LocationModel.code.asc()).first()


class ControllerFlagLineRequest(BaseModel):
    reason: str


@router.post(
    "/lines/{line_id}/controller-flag",
    response_model=PickLineResponse,
    summary="Controller flags a picked line with a reason (reason-based stock disposition)",
)
async def controller_flag_line(
    request: Request,
    line_id: UUID,
    payload: ControllerFlagLineRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:write")),
):
    if user.role != "inventory_controller":
        raise HTTPException(status_code=403, detail="Faqat controller uchun")
    reason = (payload.reason or "").strip()
    if reason not in INCOMPLETE_REASON_CODES:
        raise HTTPException(
            status_code=400,
            detail=f"reason must be one of: {list(INCOMPLETE_REASON_CODES)}",
        )

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
    if document.status != "picked":
        raise HTTPException(status_code=409, detail="Document must be in picked status")
    if document.controlled_by_user_id != user.id:
        _lock_document_row(db, document.id)
        _claim_for_controller(document, user)
    if _line_is_vip_expiry_informational(line):
        raise HTTPException(
            status_code=409,
            detail="VIP muddat: bu qator faqat ma'lumot uchun",
        )
    if not line.product_id or not line.lot_id or not line.location_id:
        raise HTTPException(status_code=400, detail="Line missing product/lot/location")
    qty = Decimal(str(line.picked_qty or 0))
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Line has no picked qty to flag")

    zone_type = _CONTROLLER_FLAG_ZONE_BY_REASON.get(reason)
    line.skip_reason = reason
    line.picked_qty = 0
    line.picked_box_barcode = None
    _clear_line_picked(line)

    if zone_type is None:
        # Joyiga qaytarish: fizik+rezerv+quti tiklanadi (picker skip bilan bir xil).
        record_pick_rollback(
            db,
            product_id=line.product_id,
            lot_id=line.lot_id,
            location_id=line.location_id,
            qty=qty,
            document_id=document.id,
            created_by_user_id=user.id,
        )
        disposition = "return_to_source"
        target_code = None
    else:
        # Terishда manba on_hand+rezerv allaqachon kamaygan (mol packing'да).
        # Manbaga tegmaymiz; molni brak/muddat zonasiga qo'shamiz.
        target = _resolve_default_zone_location(db, line.location_id, zone_type)
        if not target:
            raise HTTPException(
                status_code=409,
                detail=f"Bu ombor uchun {zone_type} zonasi sozlanmagan",
            )
        lock_lot_location(db, line.lot_id, target.id)
        db.add(
            StockMovementModel(
                product_id=line.product_id,
                lot_id=line.lot_id,
                location_id=target.id,
                qty_change=qty,
                movement_type="transfer_in",
                source_document_type="document",
                source_document_id=document.id,
                created_by_user_id=user.id,
                reason_code=reason,
            )
        )
        db.flush()
        assert_box_invariant(db, line.lot_id, target.id)
        disposition = f"move_to_{zone_type.lower()}_zone"
        target_code = target.code

    log_action(
        db,
        user_id=user.id,
        action=ACTION_UPDATE,
        entity_type="document_line",
        entity_id=str(line.id),
        new_data={
            "event": "controller_flag_line",
            "reason": reason,
            "qty": str(qty),
            "disposition": disposition,
            "target_location": target_code,
            "document_id": str(document.id),
        },
        ip_address=get_client_ip(request),
    )

    # Hujjat controller tekshiruvida — "picked" holat saqlanadi (status refresh yo'q).
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
    request: Request,
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
    if document.status == "cancelling":
        raise HTTPException(
            status_code=409,
            detail="Buyurtma xavfsiz bekor rejimida: avval qaytarish tugallansin",
        )

    cutoff = _picking_urgency_cutoff_today()
    ordered_ids = [
        r[0]
        for r in db.query(DocumentLineModel.id)
        .outerjoin(LocationModel, DocumentLineModel.location_id == LocationModel.id)
        .filter(DocumentLineModel.document_id == document.id)
        .order_by(*_picking_route_order_by(urgency_cutoff_date=cutoff))
        .all()
    ]
    if not ordered_ids:
        lines = []
    else:
        lines_locked = (
            db.query(DocumentLineModel)
            .filter(DocumentLineModel.id.in_(ordered_ids))
            .with_for_update()
            .all()
        )
        order_map = {lid: i for i, lid in enumerate(ordered_ids)}
        lines = sorted(lines_locked, key=lambda L: order_map[L.id])
    # Sababsiz qolgan terilmagan qatorlar (VIP-info va allaqachon skip_reason
    # qo'yilganlar hisobga olinmaydi — ular "hal qilingan"). Faqat shu qatorlar
    # uchun bir marta umumiy sabab so'raladi.
    incomplete_lines = [
        line
        for line in lines
        if not _line_is_vip_expiry_informational(line)
        and not getattr(line, "skip_reason", None)
        and line.picked_qty < line.required_qty
    ]
    incomplete = [line.id for line in incomplete_lines]
    incomplete_reason = (body or CompletePickingRequest()).incomplete_reason if body else None
    # Faqat yig'uvchi to'liq yig'maganda sabab talab qilinadi; controller allaqachon sabab bilan yuborilgan hujjatni yakunlaydi
    if incomplete and user.role != "inventory_controller":
        if not incomplete_reason or incomplete_reason not in INCOMPLETE_REASON_CODES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"message": "Incomplete lines", "lines": [str(x) for x in incomplete]},
            )
        document.incomplete_reason = incomplete_reason
        # Bir marta berilgan sabab qolgan har bir sababsiz qatorga tarqatiladi —
        # shunda har qator "sabab bilan" (qizil) bo'ladi va controllerga
        # yuborishda qayta sabab so'ralmaydi.
        for line in incomplete_lines:
            line.skip_reason = incomplete_reason

    if user.role == "inventory_controller":
        if document.status == "picked":
            # Navbatdagi hujjatni yakunlash — shu yerda band qilinadi (eski ilovalar uchun).
            _claim_for_controller(document, user)
        elif document.controlled_by_user_id != user.id:
            raise HTTPException(status_code=403, detail="Document not assigned to you")
        if document.status == "completed":
            response = _to_picking_document_with_lines(document, lines, db)
            db.commit()
            return response
        if document.status != "picked":
            raise HTTPException(status_code=409, detail="Document must be in picked status")
        if incomplete:
            eff = (incomplete_reason or "").strip() or (
                (getattr(document, "incomplete_reason", None) or "").strip()
            )
            if eff not in INCOMPLETE_REASON_CODES:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "To'liq terilmagan hujjat: incomplete_reason talab qilinadi "
                        f"({', '.join(INCOMPLETE_REASON_CODES)}) — yig'uvchi kiritgan yoki body da yuboring."
                    ),
                )
            if incomplete_reason and incomplete_reason.strip() in INCOMPLETE_REASON_CODES:
                document.incomplete_reason = incomplete_reason.strip()
        released = _release_unpicked_reserve_on_controller_complete(db, document, lines, user.id)
        if released:
            log_action(
                db,
                user_id=user.id,
                action=ACTION_CREATE,
                entity_type="picking_document",
                entity_id=str(document.id),
                new_data={
                    "event": "controller_complete_released_unpicked_reserve",
                    "lines_with_unallocate": released,
                },
                ip_address=get_client_ip(request),
            )
        document.status = "completed"
        if document.completed_at is None:
            document.completed_at = datetime.now(timezone.utc)
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
    response = _to_picking_document_with_lines(document, lines, db)
    db.commit()
    return response


def _safe_cancel_session_to_out(db: Session, session: SafeCancelReturnSessionModel) -> SafeCancelReturnSessionOut:
    doc = db.query(DocumentModel).filter(DocumentModel.id == session.document_id).one_or_none()
    ref = doc.doc_no if doc else ""
    ordered = list_session_lines_ordered(db, session)
    lines_out = [
        SafeCancelReturnLineOut(
            id=ln.id,
            document_line_id=ln.document_line_id,
            expected_location_code=ln.expected_location_code or "",
            product_name=ln.product_name,
            barcode=ln.barcode,
            sku=ln.sku,
            qty_to_return=float(ln.qty_to_return),
            location_confirmed=bool(ln.location_confirmed),
            product_confirmed=bool(ln.product_confirmed),
        )
        for ln in ordered
    ]
    all_done = all(ln.location_confirmed and ln.product_confirmed for ln in ordered) if ordered else True
    return SafeCancelReturnSessionOut(
        id=session.id,
        document_id=session.document_id,
        reference_number=ref,
        order_number=_order_number(doc) if doc else None,
        status=session.status or "returns_pending",
        lines=lines_out,
        all_lines_complete=all_done,
    )


@router.get(
    "/return-session/mine",
    response_model=Optional[SafeCancelReturnSessionOut],
    summary="Yig'uvchi: faol qaytarish sessiyasi (xavfsiz bekor)",
)
async def get_my_safe_cancel_return_session(
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:read")),
):
    if user.role != "picker":
        raise HTTPException(status_code=403, detail="Only for pickers")
    session = get_active_return_session_for_picker(db, user.id)
    if not session:
        return None
    return _safe_cancel_session_to_out(db, session)


@router.get(
    "/return-session/{session_id}",
    response_model=SafeCancelReturnSessionOut,
    summary="Qaytarish sessiyasi tafsilotlari",
)
async def get_safe_cancel_return_session(
    session_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:read")),
):
    session = (
        db.query(SafeCancelReturnSessionModel)
        .options(selectinload(SafeCancelReturnSessionModel.lines))
        .filter(SafeCancelReturnSessionModel.id == session_id)
        .one_or_none()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Return session not found")
    if user.role == "picker" and session.picker_user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return _safe_cancel_session_to_out(db, session)


@router.post(
    "/return-session/{session_id}/scan-location",
    response_model=SafeCancelReturnSessionOut,
    summary="Qaytarish: navbatdagi qator uchun manzilni skanerlash",
)
async def scan_safe_cancel_return_location(
    session_id: UUID,
    body: ReturnScanBody,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:pick")),
):
    if user.role != "picker":
        raise HTTPException(status_code=403, detail="Only for pickers")
    try:
        scan_return_location(db, session_id=session_id, picker_user_id=user.id, raw=body.raw)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    session = (
        db.query(SafeCancelReturnSessionModel)
        .options(selectinload(SafeCancelReturnSessionModel.lines))
        .filter(SafeCancelReturnSessionModel.id == session_id)
        .one()
    )
    return _safe_cancel_session_to_out(db, session)


@router.post(
    "/return-session/{session_id}/scan-product",
    response_model=SafeCancelReturnSessionOut,
    summary="Qaytarish: manzil tasdiqlangan qator uchun mahsulotni skanerlash",
)
async def scan_safe_cancel_return_product(
    session_id: UUID,
    body: ReturnScanBody,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:pick")),
):
    if user.role != "picker":
        raise HTTPException(status_code=403, detail="Only for pickers")
    try:
        scan_return_product(db, session_id=session_id, picker_user_id=user.id, raw=body.raw)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    session = (
        db.query(SafeCancelReturnSessionModel)
        .options(selectinload(SafeCancelReturnSessionModel.lines))
        .filter(SafeCancelReturnSessionModel.id == session_id)
        .one()
    )
    return _safe_cancel_session_to_out(db, session)


@router.post(
    "/return-session/{session_id}/finish",
    response_model=SafeCancelReturnSessionOut,
    summary="Qaytarishni yakunlash: stok tiklash + buyurtma cancelled",
)
async def finish_safe_cancel_return_session(
    request: Request,
    session_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_permission("picking:pick")),
):
    if user.role != "picker":
        raise HTTPException(status_code=403, detail="Only for pickers")
    try:
        finish_safe_cancel_return(db, session_id=session_id, picker_user_id=user.id)
        log_action(
            db,
            user_id=user.id,
            action=ACTION_UPDATE,
            entity_type="safe_cancel_return_session",
            entity_id=str(session_id),
            old_data={"status": "returns_pending"},
            new_data={"status": "completed"},
            ip_address=get_client_ip(request),
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    session = (
        db.query(SafeCancelReturnSessionModel)
        .options(selectinload(SafeCancelReturnSessionModel.lines))
        .filter(SafeCancelReturnSessionModel.id == session_id)
        .one()
    )
    return _safe_cancel_session_to_out(db, session)
