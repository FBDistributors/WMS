"""Xavfsiz bekor: `cancelling_in_progress` + qaytarish sessiyasi; yakuniy `cancelled` faqat Finish Return dan keyin."""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import case, func
from sqlalchemy.orm import Session, selectinload

from app.models.document import Document as DocumentModel
from app.models.document import DocumentLine as DocumentLineModel
from app.models.location import Location as LocationModel
from app.models.order import Order as OrderModel
from app.models.order import OrderWmsState as OrderWmsStateModel
from app.models.product import ProductBarcode
from app.models.safe_cancel_return import SafeCancelReturnLine, SafeCancelReturnSession
from app.models.stock import StockMovement as StockMovementModel
from app.services.order_reserve_release import release_document_reserve_on_cancel
from app.services.stock_box_gateway import record_pick_rollback
from app.services.order_transition_policy import require_transition_rule


def _norm_scan(value: str) -> str:
    return (value or "").strip().lower()


def _picking_expiry_urgency_days() -> int:
    raw = (os.getenv("WMS_PICKING_EXPIRY_URGENCY_DAYS") or "30").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 30
    return max(0, min(366, n))


def _picking_urgency_cutoff_today() -> date:
    today = datetime.now(timezone.utc).date()
    return today + timedelta(days=_picking_expiry_urgency_days())


def _route_order_by(*, urgency_cutoff_date: date):
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


def list_session_lines_ordered(db: Session, session: SafeCancelReturnSession) -> List[SafeCancelReturnLine]:
    line_ids = [rl.document_line_id for rl in session.lines]
    if not line_ids:
        return []
    cutoff = _picking_urgency_cutoff_today()
    rows = (
        db.query(SafeCancelReturnLine)
        .join(DocumentLineModel, DocumentLineModel.id == SafeCancelReturnLine.document_line_id)
        .outerjoin(LocationModel, DocumentLineModel.location_id == LocationModel.id)
        .filter(SafeCancelReturnLine.session_id == session.id)
        .order_by(*_route_order_by(urgency_cutoff_date=cutoff))
        .all()
    )
    return rows


def _product_scan_matches_line(db: Session, line: SafeCancelReturnLine, raw: str) -> bool:
    scan = _norm_scan(raw)
    if not scan:
        return False
    if line.barcode and scan == _norm_scan(line.barcode):
        return True
    if line.sku and scan == _norm_scan(line.sku):
        return True
    hit = (
        db.query(ProductBarcode.id)
        .filter(
            ProductBarcode.product_id == line.product_id,
            func.lower(func.trim(ProductBarcode.barcode)) == scan,
        )
        .first()
    )
    return hit is not None


def initiate_safe_cancel_return(
    db: Session,
    *,
    order: OrderModel,
    document: DocumentModel,
    admin_user_id: UUID,
) -> SafeCancelReturnSession:
    if not order.wms_state:
        raise HTTPException(status_code=409, detail="Order has no WMS state")
    existing = (
        db.query(SafeCancelReturnSession)
        .filter(
            SafeCancelReturnSession.document_id == document.id,
            SafeCancelReturnSession.status == "returns_pending",
        )
        .with_for_update()
        .one_or_none()
    )
    if existing:
        db.refresh(existing, attribute_names=["lines"])
        return existing

    order_status = order.wms_state.status
    if order_status == "picking":
        # Terish jarayonidagi xavfsiz bekor (asl oqim).
        if document.status in ("cancelled", "completed", "packed", "shipped", "picked", "cancelling"):
            raise HTTPException(status_code=409, detail="Hujjat holati bekor qilishga mos emas")
        if document.controlled_by_user_id is not None:
            raise HTTPException(status_code=409, detail="Hujjat allaqachon controllerga yuborilgan")
    elif order_status == "completed":
        # Arxivdan qaytim: faqat completed (packed/shipped emas — fizik chiqim boshlanadi).
        if document.status != "completed":
            raise HTTPException(status_code=409, detail="Hujjat holati bekor qilishga mos emas")
        shipped = (
            db.query(StockMovementModel.id)
            .filter(
                StockMovementModel.movement_type == "ship",
                StockMovementModel.source_document_type == "order",
                StockMovementModel.source_document_id == order.id,
            )
            .first()
        )
        if shipped:
            raise HTTPException(
                status_code=409, detail="Buyurtma jo'natilgan (ship) — qaytim mumkin emas"
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Xavfsiz bekor faqat `picking` yoki `completed` holatida mumkin",
        )
    if not document.assigned_to_user_id:
        raise HTTPException(status_code=409, detail="Yig'uvchi tayinlanmagan")

    lines = (
        db.query(DocumentLineModel)
        .options(selectinload(DocumentLineModel.document))
        .filter(DocumentLineModel.document_id == document.id)
        .all()
    )
    picked_lines = [ln for ln in lines if float(ln.picked_qty or 0) > 0]
    if not picked_lines:
        raise HTTPException(status_code=409, detail="Terilgan qator yo'q — oddiy bekor ishlating")

    session = SafeCancelReturnSession(
        id=uuid.uuid4(),
        order_id=order.id,
        document_id=document.id,
        picker_user_id=document.assigned_to_user_id,
        initiated_by_user_id=admin_user_id,
        status="returns_pending",
    )
    db.add(session)
    db.flush()

    for dl in picked_lines:
        if not dl.product_id or not dl.lot_id or not dl.location_id:
            raise HTTPException(
                status_code=409,
                detail=f"Qator {dl.id} uchun product/lot/joy to'liq emas — xavfsiz bekor mumkin emas",
            )
        qty = Decimal(str(dl.picked_qty or 0))
        if qty <= 0:
            continue
        db.add(
            SafeCancelReturnLine(
                id=uuid.uuid4(),
                session_id=session.id,
                document_line_id=dl.id,
                expected_location_id=dl.location_id,
                expected_location_code=(dl.location_code or "").strip(),
                product_id=dl.product_id,
                lot_id=dl.lot_id,
                product_name=dl.product_name,
                barcode=(dl.barcode or "").strip() or None,
                sku=(dl.sku or "").strip() or None,
                qty_to_return=qty,
                # Omborda lokatsiya QR kodlari yo'q — joy skanerlanmaydi. Qaytarish
                # joyi baribir qat'iy: `expected_location_id` (qayerdan terilgan bo'lsa).
                # Yig'uvchi faqat mahsulotni skanerlaydi.
                location_confirmed=True,
                product_confirmed=False,
            )
        )

    require_transition_rule(order.wms_state.status, "cancelling_in_progress")
    order.wms_state.status = "cancelling_in_progress"
    order.wms_state.cancelled_by_user_id = admin_user_id
    document.status = "cancelling"
    db.flush()
    db.refresh(session)
    return session


def scan_return_location(db: Session, *, session_id: UUID, picker_user_id: UUID, raw: str) -> SafeCancelReturnSession:
    session = (
        db.query(SafeCancelReturnSession)
        .options(selectinload(SafeCancelReturnSession.lines))
        .filter(SafeCancelReturnSession.id == session_id)
        .with_for_update()
        .one_or_none()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Return session not found")
    if session.picker_user_id != picker_user_id:
        raise HTTPException(status_code=403, detail="Bu sessiya sizga tegishli emas")
    if session.status != "returns_pending":
        raise HTTPException(status_code=409, detail="Sessiya allaqachon yopilgan")

    """Eski ilova versiyalari uchun no-op.

    Lokatsiya QR kodlari yo'q, shuning uchun joy skanerlanmaydi va qatorlar
    `location_confirmed=True` bilan yaratiladi. Endpoint saqlanadi (eski build'lar
    hali chaqiradi), lekin hech narsani o'zgartirmaydi va xato bermaydi.
    """
    _ = raw
    return session


def scan_return_product(db: Session, *, session_id: UUID, picker_user_id: UUID, raw: str) -> SafeCancelReturnSession:
    session = (
        db.query(SafeCancelReturnSession)
        .options(selectinload(SafeCancelReturnSession.lines))
        .filter(SafeCancelReturnSession.id == session_id)
        .with_for_update()
        .one_or_none()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Return session not found")
    if session.picker_user_id != picker_user_id:
        raise HTTPException(status_code=403, detail="Bu sessiya sizga tegishli emas")
    if session.status != "returns_pending":
        raise HTTPException(status_code=409, detail="Sessiya allaqachon yopilgan")

    ordered = list_session_lines_ordered(db, session)
    # Joy skanerlanmaydi (lokatsiya QR kodlari yo'q) — navbatdagi tasdiqlanmagan qator.
    target: Optional[SafeCancelReturnLine] = next(
        (ln for ln in ordered if not ln.product_confirmed),
        None,
    )
    if not target:
        raise HTTPException(
            status_code=409,
            detail="Barcha mahsulotlar allaqachon tasdiqlangan",
        )

    if not _product_scan_matches_line(db, target, raw):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tovar (shtrix-kod/SKU) mos emas. Kutilgan qator uchun skanerlang.",
        )

    target.product_confirmed = True
    db.flush()
    return session


def finish_safe_cancel_return(db: Session, *, session_id: UUID, picker_user_id: UUID) -> None:
    session = (
        db.query(SafeCancelReturnSession)
        .options(selectinload(SafeCancelReturnSession.lines))
        .filter(SafeCancelReturnSession.id == session_id)
        .with_for_update()
        .one_or_none()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Return session not found")
    if session.picker_user_id != picker_user_id:
        raise HTTPException(status_code=403, detail="Bu sessiya sizga tegishli emas")
    if session.status != "returns_pending":
        raise HTTPException(status_code=409, detail="Sessiya allaqachon yopilgan")

    ordered = list_session_lines_ordered(db, session)
    for ln in ordered:
        if not ln.product_confirmed:
            raise HTTPException(
                status_code=409,
                detail="Barcha qatorlar uchun mahsulot skanerlanishi kerak",
            )

    document = (
        db.query(DocumentModel)
        .options(selectinload(DocumentModel.lines))
        .filter(DocumentModel.id == session.document_id)
        .with_for_update()
        .one_or_none()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    order = (
        db.query(OrderModel)
        .options(selectinload(OrderModel.wms_state))
        .filter(OrderModel.id == session.order_id)
        .with_for_update()
        .one_or_none()
    )
    if not order or not order.wms_state:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.wms_state.status != "cancelling_in_progress":
        raise HTTPException(status_code=409, detail="Buyurtma holati kutilganidan farq qiladi")

    for rline in ordered:
        dline = next((x for x in document.lines if x.id == rline.document_line_id), None)
        if not dline:
            raise HTTPException(status_code=500, detail="Document line missing")
        qty_line = Decimal(str(dline.picked_qty or 0))
        qty_ret = Decimal(str(rline.qty_to_return))
        if qty_line < qty_ret:
            raise HTTPException(
                status_code=409,
                detail="Terilgan miqdor sessiya bilan mos kelmaydi — yig'uvchi to'xtatilgan bo'lishi kerak",
            )
        qty = qty_ret
        if qty <= 0:
            continue
        # Stock+rezerv tiklash + butun-quti pick'larini yopiq qaytarish + invariant.
        # (qaytarish joyi = original pick joyi; pick+/unallocate+ flush bo'lib, keyingi
        # release_document_reserve_on_cancel reserved'ni to'g'ri o'qiydi.)
        record_pick_rollback(
            db,
            product_id=rline.product_id,
            lot_id=rline.lot_id,
            location_id=rline.expected_location_id,
            qty=qty,
            document_id=document.id,
            created_by_user_id=picker_user_id,
        )
        dline.picked_qty = 0.0

    release_document_reserve_on_cancel(db, document, document.lines, picker_user_id)

    require_transition_rule(order.wms_state.status, "cancelled")
    cancel_now = datetime.now(timezone.utc)
    session.status = "completed"
    session.completed_at = cancel_now
    document.status = "cancelled"
    order.wms_state.status = "cancelled"
    order.wms_state.cancelled_at = cancel_now
    if not order.wms_state.cancelled_by_user_id:
        order.wms_state.cancelled_by_user_id = session.initiated_by_user_id

    db.flush()


def get_active_return_session_for_picker(db: Session, picker_user_id: UUID) -> Optional[SafeCancelReturnSession]:
    return (
        db.query(SafeCancelReturnSession)
        .options(selectinload(SafeCancelReturnSession.lines))
        .filter(
            SafeCancelReturnSession.picker_user_id == picker_user_id,
            SafeCancelReturnSession.status == "returns_pending",
        )
        .order_by(SafeCancelReturnSession.created_at.desc())
        .first()
    )


def active_return_session_id_for_document(db: Session, document_id: UUID) -> Optional[UUID]:
    row = (
        db.query(SafeCancelReturnSession.id)
        .filter(
            SafeCancelReturnSession.document_id == document_id,
            SafeCancelReturnSession.status == "returns_pending",
        )
        .limit(1)
        .scalar()
    )
    return row


def order_in_cancelling_flow(db: Session, order_id: Optional[UUID]) -> bool:
    if not order_id:
        return False
    st = (
        db.query(OrderWmsStateModel.status)
        .filter(OrderWmsStateModel.order_id == order_id)
        .limit(1)
        .scalar()
    )
    return st == "cancelling_in_progress"
