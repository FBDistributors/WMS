"""Mahsulot/quti shtrix-kodini resolve qilish (picking, scanner)."""
from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.product import Product as ProductModel
from app.models.product import ProductBarcode
from app.models.product_box import ProductBox as ProductBoxModel


def normalize_scan_barcode(raw: str) -> str:
    return (raw or "").strip()


@dataclass(frozen=True)
class ProductScanResolve:
    product_id: UUID
    scan_kind: str  # "unit" | "box"
    units_per_scan: int
    product: ProductModel
    box_id: UUID | None = None


def is_explicit_box_pick(
    resolved: ProductScanResolve | None,
    box_count: int | None,
) -> bool:
    """Quti terish: faqat box_count >= 1 bo'lganda (qutisiz terish box barcode bilan ham mumkin)."""
    return (
        resolved is not None
        and resolved.scan_kind == "box"
        and box_count is not None
        and int(box_count) >= 1
    )


def resolve_product_scan(db: Session, raw_barcode: str) -> ProductScanResolve | None:
    """Quti kodi birinchi, keyin dona (product barcode / sku)."""
    barcode = normalize_scan_barcode(raw_barcode)
    if not barcode:
        return None

    box = (
        db.query(ProductBoxModel)
        .filter(
            ProductBoxModel.box_barcode == barcode,
            ProductBoxModel.is_active.is_(True),
        )
        .one_or_none()
    )
    if box and box.product and box.product.is_active:
        return ProductScanResolve(
            product_id=box.product_id,
            scan_kind="box",
            units_per_scan=box.units_per_box,
            product=box.product,
            box_id=box.id,
        )

    product = (
        db.query(ProductModel)
        .filter(
            (ProductModel.barcode == barcode)
            | ProductModel.id.in_(
                db.query(ProductBarcode.product_id).filter(ProductBarcode.barcode == barcode)
            )
        )
        .filter(ProductModel.is_active.is_(True))
        .first()
    )
    if product:
        return ProductScanResolve(
            product_id=product.id,
            scan_kind="unit",
            units_per_scan=1,
            product=product,
            box_id=None,
        )
    return None


def product_matches_document_line_scan(
    resolved: ProductScanResolve,
    *,
    line_product_id: UUID | None,
    line_barcode: str | None,
    line_sku: str | None,
    scanned_barcode: str,
) -> bool:
    """Document line skan natijasiga mos kelishini tekshirish."""
    if line_product_id and line_product_id == resolved.product_id:
        return True
    barcode = normalize_scan_barcode(scanned_barcode).lower()
    if not barcode:
        return False
    if resolved.scan_kind == "box":
        return False
    if line_barcode and line_barcode.strip().lower() == barcode:
        return True
    if line_sku and line_sku.strip().lower() == barcode:
        return True
    return False
