"""location_box_placements va box_location_service testlari."""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.location import Location as LocationModel
from app.models.product import Product as ProductModel
from app.models.product_box import ProductBox as ProductBoxModel
from app.models.stock import StockLot, StockMovement
from app.models.user import User as UserModel
from app.auth.security import get_password_hash
from app.services.box_location_service import get_breakdown, place_sealed_box, remove_sealed_box


@pytest.fixture()
def inv_user(db_session: Session) -> UserModel:
    u = UserModel(
        username=f"inv-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="inventory_controller",
        is_active=True,
    )
    db_session.add(u)
    db_session.flush()
    return u


@pytest.fixture()
def sample_product(db_session: Session) -> ProductModel:
    product = ProductModel(
        external_source="test",
        external_id=f"ext-{uuid.uuid4()}",
        name="Box Loc Product",
        sku=f"SKU-BL-{uuid.uuid4().hex[:8]}",
        barcode="BL1111",
        is_active=True,
    )
    db_session.add(product)
    db_session.flush()
    return product


@pytest.fixture()
def sample_location(db_session: Session) -> LocationModel:
    loc = LocationModel(
        code=f"BL-{uuid.uuid4().hex[:6]}",
        barcode_value=f"BL-{uuid.uuid4().hex[:6]}",
        name="Box Loc",
        type="bin",
        is_active=True,
    )
    db_session.add(loc)
    db_session.flush()
    return loc


def _seed_stock(
    db_session: Session,
    product: ProductModel,
    location: LocationModel,
    qty: int,
) -> StockLot:
    lot = StockLot(product_id=product.id, batch="B1", expiry_date=None)
    db_session.add(lot)
    db_session.flush()
    db_session.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=location.id,
            qty_change=Decimal(str(qty)),
            movement_type="receipt",
        )
    )
    db_session.flush()
    return lot


def test_place_and_breakdown(
    db_session: Session,
    inv_user: UserModel,
    sample_product: ProductModel,
    sample_location: LocationModel,
) -> None:
    lot = _seed_stock(db_session, sample_product, sample_location, 50)
    box = ProductBoxModel(
        box_barcode="BOX-LOC-001",
        product_id=sample_product.id,
        units_per_box=12,
        is_active=True,
    )
    db_session.add(box)
    db_session.flush()

    result = place_sealed_box(
        db_session,
        box_barcode="BOX-LOC-001",
        location_id=sample_location.id,
        lot_id=lot.id,
        user=inv_user,
    )
    assert result.box_count == 1
    assert result.units_in_boxes == 12
    assert result.loose_units == 38
    assert result.total_units == 50


def test_place_duplicate_barcode_fails(
    db_session: Session,
    inv_user: UserModel,
    sample_product: ProductModel,
    sample_location: LocationModel,
) -> None:
    lot = _seed_stock(db_session, sample_product, sample_location, 50)
    box = ProductBoxModel(
        box_barcode="BOX-DUP",
        product_id=sample_product.id,
        units_per_box=12,
        is_active=True,
    )
    db_session.add(box)
    db_session.flush()
    place_sealed_box(
        db_session,
        box_barcode="BOX-DUP",
        location_id=sample_location.id,
        lot_id=lot.id,
        user=inv_user,
    )
    with pytest.raises(HTTPException) as exc:
        place_sealed_box(
            db_session,
            box_barcode="BOX-DUP",
            location_id=sample_location.id,
            lot_id=lot.id,
            user=inv_user,
        )
    assert exc.value.status_code == 409


def test_place_insufficient_loose_fails(
    db_session: Session,
    inv_user: UserModel,
    sample_product: ProductModel,
    sample_location: LocationModel,
) -> None:
    lot = _seed_stock(db_session, sample_product, sample_location, 10)
    box = ProductBoxModel(
        box_barcode="BOX-BIG",
        product_id=sample_product.id,
        units_per_box=12,
        is_active=True,
    )
    db_session.add(box)
    db_session.flush()
    with pytest.raises(HTTPException) as exc:
        place_sealed_box(
            db_session,
            box_barcode="BOX-BIG",
            location_id=sample_location.id,
            lot_id=lot.id,
            user=inv_user,
        )
    assert exc.value.status_code == 409


def test_remove_box(
    db_session: Session,
    inv_user: UserModel,
    sample_product: ProductModel,
    sample_location: LocationModel,
) -> None:
    lot = _seed_stock(db_session, sample_product, sample_location, 24)
    box = ProductBoxModel(
        box_barcode="BOX-RM",
        product_id=sample_product.id,
        units_per_box=12,
        is_active=True,
    )
    db_session.add(box)
    db_session.flush()
    place_sealed_box(
        db_session,
        box_barcode="BOX-RM",
        location_id=sample_location.id,
        lot_id=lot.id,
        user=inv_user,
    )
    result = remove_sealed_box(
        db_session,
        box_barcode="BOX-RM",
        user=inv_user,
        reason="pick",
        location_id=sample_location.id,
        lot_id=lot.id,
    )
    assert result.box_count == 0
    assert result.units_in_boxes == 0
    assert result.loose_units == 24
    bd = get_breakdown(
        db_session,
        product_id=sample_product.id,
        lot_id=lot.id,
        location_id=sample_location.id,
    )
    assert bd.units_in_boxes + bd.loose_units == bd.total_units
