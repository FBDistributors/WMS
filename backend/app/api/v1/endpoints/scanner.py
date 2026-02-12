"""
Scanner resolve endpoint - identifies barcode as PRODUCT or LOCATION.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
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


class ScannerResolveIn(BaseModel):
    barcode: str


class ScannerResolveOut(BaseModel):
    type: str  # "PRODUCT" | "LOCATION" | "UNKNOWN"
    entity_id: str | None
    display_label: str | None


@router.post(
    "/resolve",
    response_model=ScannerResolveOut,
    summary="Resolve barcode to product or location",
)
async def resolve_barcode(
    payload: ScannerResolveIn,
    db: Session = Depends(get_db),
    _user: UserModel = Depends(get_current_user),
    _guard=Depends(PICKER_ACCESS),
):
    barcode = (payload.barcode or "").strip()
    if not barcode:
        return ScannerResolveOut(type="UNKNOWN", entity_id=None, display_label=None)

    # Check PRODUCT: main barcode or product_barcodes
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
        return ScannerResolveOut(
            type="PRODUCT",
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
            entity_id=str(location.id),
            display_label=f"{location.name} ({location.code})",
        )

    return ScannerResolveOut(type="UNKNOWN", entity_id=None, display_label=None)
