"""Wave picking service - allocation, pick scan, sorting scan logic."""
from __future__ import annotations

from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models.location import Location as LocationModel
from app.models.order import Order as OrderModel
from app.models.order import OrderLine as OrderLineModel
from app.models.product import Product as ProductModel
from app.models.product import ProductBarcode
from app.models.stock import ON_HAND_MOVEMENT_TYPES
from app.models.stock import StockLot as StockLotModel
from app.models.stock import StockMovement as StockMovementModel
from app.models.wave import (
    SortingBin,
    SortingScan,
    Wave,
    WaveAllocation,
    WaveLine,
    WaveOrder,
)


STAGING_LOCATION_CODE = "Z-SORT-01"


def _resolve_product_by_barcode(db: Session, barcode: str) -> Optional[UUID]:
    """Resolve product_id from barcode (Product.barcode or ProductBarcode)."""
    product = (
        db.query(ProductModel.id)
        .filter(ProductModel.barcode == barcode)
        .one_or_none()
    )
    if product:
        return product.id
    product = (
        db.query(ProductModel.id)
        .join(ProductBarcode, ProductBarcode.product_id == ProductModel.id)
        .filter(ProductBarcode.barcode == barcode)
        .one_or_none()
    )
    return product.id if product else None


def _get_barcode_for_product(db: Session, product_id: UUID) -> Optional[str]:
    """Get primary barcode for product."""
    product = db.query(ProductModel).filter(ProductModel.id == product_id).one_or_none()
    if not product:
        return None
    if product.barcode:
        return product.barcode
    b = db.query(ProductBarcode.barcode).filter(ProductBarcode.product_id == product_id).first()
    return b.barcode if b else None


def _fefo_available_for_product(db: Session, product_id: UUID):
    """Get available (lot_id, location_id, qty, batch, expiry, location_code) for product, FEFO order.
    on_hand = faqat receipt + ship (Kirim - Jo'natish), reserved = allocate/unallocate, available = on_hand - reserved.
    """
    on_hand_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(ON_HAND_MOVEMENT_TYPES), StockMovementModel.qty_change),
            else_=0,
        )
    )
    reserved_expr = func.sum(
        case(
            (StockMovementModel.movement_type.in_(("allocate", "unallocate")), StockMovementModel.qty_change),
            else_=0,
        )
    )
    return (
        db.query(
            StockMovementModel.lot_id,
            StockMovementModel.location_id,
            LocationModel.code.label("location_code"),
            StockLotModel.batch,
            StockLotModel.expiry_date,
            on_hand_expr.label("on_hand"),
            reserved_expr.label("reserved"),
            (on_hand_expr - reserved_expr).label("available"),
        )
        .join(StockLotModel, StockLotModel.id == StockMovementModel.lot_id)
        .join(LocationModel, LocationModel.id == StockMovementModel.location_id)
        .filter(StockLotModel.product_id == product_id)
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


def compute_wave_lines(db: Session, order_ids: list[UUID]) -> list[tuple[UUID, str, Decimal]]:
    """Aggregate order lines by product (barcode). Returns [(product_id, barcode, total_qty), ...]."""
    if not order_ids:
        return []

    lines = (
        db.query(OrderLineModel)
        .filter(OrderLineModel.order_id.in_(order_ids))
        .all()
    )

    # Group by barcode -> (product_id, total_qty)
    by_barcode: dict[str, tuple[UUID, Decimal]] = {}
    for line in lines:
        product_id = None
        barcode = (line.barcode or "").strip()
        if barcode:
            product_id = _resolve_product_by_barcode(db, barcode)
        if not product_id and line.sku:
            p = db.query(ProductModel).filter(ProductModel.sku == line.sku).one_or_none()
            if p:
                product_id = p.id
                if not barcode:
                    barcode = _get_barcode_for_product(db, p.id) or line.sku
        if not product_id:
            continue
        if not barcode:
            barcode = _get_barcode_for_product(db, product_id) or str(product_id)
        qty = Decimal(str(line.qty))
        if barcode in by_barcode:
            pid, tot = by_barcode[barcode]
            if pid != product_id:
                continue  # same barcode different product - skip
            by_barcode[barcode] = (product_id, tot + qty)
        else:
            by_barcode[barcode] = (product_id, qty)

    return [(pid, bc, tot) for bc, (pid, tot) in by_barcode.items()]


def get_staging_location_id(db: Session) -> Optional[UUID]:
    """Get Z-SORT-01 location id."""
    loc = db.query(LocationModel.id).filter(LocationModel.code == STAGING_LOCATION_CODE).one_or_none()
    return loc.id if loc else None
