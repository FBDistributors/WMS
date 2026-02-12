"""
Scanner resolve endpoint - identifies barcode as PRODUCT or LOCATION.
Barcode-first: returns full product/location objects for picker UI.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_any_permission
from app.db import get_db
from app.models.location import Location as LocationModel
from app.models.product import Product as ProductModel
from app.models.product import ProductBarcode
from app.models.user import User as UserModel

router = APIRouter()

PICKER_ACCESS = require_any_permission(["picking:read", "inventory:read"])


def normalize_barcode(raw: str) -> str:
    """Trim spaces; optionally keep digits only for EAN/UPC (configurable)."""
    s = (raw or "").strip()
    if not s:
        return ""
    # For now: trim only. EAN/UPC often have leading zeros; stripping non-digits can break that.
    return s


class ProductResolveOut(BaseModel):
    id: str
    name: str
    barcode: str | None
    brand: str | None = None
    uom: str | None = None


class LocationResolveOut(BaseModel):
    id: str
    code: str


class ScannerResolveIn(BaseModel):
    barcode: str


class ScannerResolveOut(BaseModel):
    type: str  # "PRODUCT" | "LOCATION" | "UNKNOWN"
    product: ProductResolveOut | None = None
    location: LocationResolveOut | None = None
    entity_id: str | None = None
    display_label: str | None = None
    message: str | None = None


@router.post(
    "/resolve",
    response_model=ScannerResolveOut,
    summary="Resolve barcode to product or location (barcode-first)",
)
async def resolve_barcode(
    payload: ScannerResolveIn,
    db: Session = Depends(get_db),
    _user: UserModel = Depends(get_current_user),
    _guard=Depends(PICKER_ACCESS),
):
    barcode = normalize_barcode(payload.barcode or "")
    if not barcode:
        return ScannerResolveOut(
            type="UNKNOWN",
            product=None,
            location=None,
            message="Barcode is empty",
        )

    # Check PRODUCT: main barcode or product_barcodes (indexed)
    product = (
        db.query(ProductModel)
        .filter(
            (ProductModel.barcode == barcode)
            | ProductModel.id.in_(
                db.query(ProductBarcode.product_id).filter(ProductBarcode.barcode == barcode)
            )
        )
        .filter(ProductModel.is_active == True)
        .first()
    )
    if product:
        main_barcode = product.barcode
        if not main_barcode:
            b = db.query(ProductBarcode.barcode).filter(ProductBarcode.product_id == product.id).first()
            main_barcode = b[0] if b else None
        return ScannerResolveOut(
            type="PRODUCT",
            product=ProductResolveOut(
                id=str(product.id),
                name=product.name,
                barcode=main_barcode,
                brand=product.brand,
            ),
            location=None,
            entity_id=str(product.id),
            display_label=f"{product.name} ({product.sku})",
        )

    # Check LOCATION: by code (location barcodes typically match code)
    location = (
        db.query(LocationModel)
        .filter(LocationModel.code == barcode)
        .filter(LocationModel.is_active == True)
        .first()
    )
    if location:
        return ScannerResolveOut(
            type="LOCATION",
            product=None,
            location=LocationResolveOut(id=str(location.id), code=location.code),
            entity_id=str(location.id),
            display_label=f"{location.name} ({location.code})",
        )

    return ScannerResolveOut(
        type="UNKNOWN",
        product=None,
        location=None,
        message="Barcode not found",
    )
