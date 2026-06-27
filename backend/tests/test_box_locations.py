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
from app.services.box_location_service import (
    box_invariant_holds,
    get_breakdown,
    get_breakdown_tolerant,
    place_sealed_box,
    place_sealed_boxes,
    relocate_sealed_box,
    remove_sealed_box,
    remove_sealed_boxes_for_pick,
)
from app.services.stock_availability import compute_lot_location_balances


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


def test_relocate_sealed_box_moves_stock_and_keeps_invariant(
    db_session: Session,
    inv_user: UserModel,
    sample_product: ProductModel,
    sample_location: LocationModel,
) -> None:
    """Quti ko'chirilganda fizik qoldiq ham birga ko'chadi; invariant ikki joyda saqlanadi."""
    lot = _seed_stock(db_session, sample_product, sample_location, 50)
    box = ProductBoxModel(
        box_barcode="BOX-RELOC-001",
        product_id=sample_product.id,
        units_per_box=12,
        is_active=True,
    )
    db_session.add(box)
    db_session.flush()
    place_sealed_box(
        db_session,
        box_barcode="BOX-RELOC-001",
        location_id=sample_location.id,
        lot_id=lot.id,
        user=inv_user,
    )

    dest = LocationModel(
        code=f"DST-{uuid.uuid4().hex[:6]}",
        barcode_value=f"DST-{uuid.uuid4().hex[:6]}",
        name="Dest bin",
        type="bin",
        is_active=True,
    )
    db_session.add(dest)
    db_session.flush()

    relocate_sealed_box(
        db_session,
        box_barcode="BOX-RELOC-001",
        to_location_id=dest.id,
        user=inv_user,
        from_location_id=sample_location.id,
    )

    src_on_hand, _r, _a = compute_lot_location_balances(db_session, lot.id, sample_location.id)
    dst_on_hand, _r2, _a2 = compute_lot_location_balances(db_session, lot.id, dest.id)
    assert src_on_hand == Decimal("38")
    assert dst_on_hand == Decimal("12")
    assert box_invariant_holds(db_session, lot.id, sample_location.id)
    assert box_invariant_holds(db_session, lot.id, dest.id)

    bd_dst = get_breakdown_tolerant(
        db_session, product_id=sample_product.id, lot_id=lot.id, location_id=dest.id
    )
    assert bd_dst.box_count == 1
    assert bd_dst.units_in_boxes == 12
    assert bd_dst.loose_units == 0

    bd_src = get_breakdown_tolerant(
        db_session, product_id=sample_product.id, lot_id=lot.id, location_id=sample_location.id
    )
    assert bd_src.box_count == 0
    assert bd_src.loose_units == 38


def test_place_multiple_boxes_same_barcode(
    db_session: Session,
    inv_user: UserModel,
    sample_product: ProductModel,
    sample_location: LocationModel,
) -> None:
    lot = _seed_stock(db_session, sample_product, sample_location, 80)
    box = ProductBoxModel(
        box_barcode="BOX-MULTI",
        product_id=sample_product.id,
        units_per_box=10,
        is_active=True,
    )
    db_session.add(box)
    db_session.flush()
    result = place_sealed_boxes(
        db_session,
        box_barcode="BOX-MULTI",
        location_id=sample_location.id,
        lot_id=lot.id,
        user=inv_user,
        box_count=8,
    )
    assert result.box_count == 8
    assert result.units_in_boxes == 80
    assert result.loose_units == 0
    assert result.total_units == 80

    result2 = remove_sealed_box(
        db_session,
        box_barcode="BOX-MULTI",
        user=inv_user,
        reason="pick",
        location_id=sample_location.id,
        lot_id=lot.id,
    )
    assert result2.box_count == 7
    assert result2.units_in_boxes == 70
    assert result2.loose_units == 10


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


def test_remove_sealed_boxes_for_pick_multi(
    db_session: Session,
    inv_user: UserModel,
    sample_product: ProductModel,
    sample_location: LocationModel,
) -> None:
    lot = _seed_stock(db_session, sample_product, sample_location, 60)
    box = ProductBoxModel(
        box_barcode="BOX-PICK-MULTI",
        product_id=sample_product.id,
        units_per_box=6,
        is_active=True,
    )
    db_session.add(box)
    db_session.flush()
    place_sealed_boxes(
        db_session,
        box_barcode="BOX-PICK-MULTI",
        location_id=sample_location.id,
        lot_id=lot.id,
        user=inv_user,
        box_count=5,
    )
    remove_sealed_boxes_for_pick(
        db_session,
        box_barcode="BOX-PICK-MULTI",
        location_id=sample_location.id,
        lot_id=lot.id,
        user=inv_user,
        box_count=3,
        pick_qty=Decimal("18"),
    )
    bd = get_breakdown(
        db_session,
        product_id=sample_product.id,
        lot_id=lot.id,
        location_id=sample_location.id,
    )
    assert bd.box_count == 2
    assert bd.units_in_boxes == 12


def test_get_breakdown_strict_raises_when_inconsistent(
    db_session: Session,
    inv_user: UserModel,
    sample_product: ProductModel,
    sample_location: LocationModel,
) -> None:
    lot = _seed_stock(db_session, sample_product, sample_location, 100)
    box = ProductBoxModel(
        box_barcode="BOX-INCON",
        product_id=sample_product.id,
        units_per_box=12,
        is_active=True,
    )
    db_session.add(box)
    db_session.flush()
    place_sealed_box(
        db_session,
        box_barcode="BOX-INCON",
        location_id=sample_location.id,
        lot_id=lot.id,
        user=inv_user,
    )
    box.units_per_box = 120
    db_session.flush()

    with pytest.raises(HTTPException) as exc:
        get_breakdown(
            db_session,
            product_id=sample_product.id,
            lot_id=lot.id,
            location_id=sample_location.id,
        )
    assert exc.value.status_code == 409

    tolerant = get_breakdown_tolerant(
        db_session,
        product_id=sample_product.id,
        lot_id=lot.id,
        location_id=sample_location.id,
    )
    assert tolerant.data_inconsistent is True
    assert tolerant.box_count == 0
    assert tolerant.units_in_boxes == 0
    assert tolerant.loose_units == 100
    assert tolerant.total_units == 100
    assert len(tolerant.sealed_boxes) == 1
    assert tolerant.sealed_boxes[0].units_per_box == 120


def test_remove_box_returns_tolerant_when_still_inconsistent(
    db_session: Session,
    inv_user: UserModel,
    sample_product: ProductModel,
    sample_location: LocationModel,
) -> None:
    lot = _seed_stock(db_session, sample_product, sample_location, 100)
    box = ProductBoxModel(
        box_barcode="BOX-INCON-RM",
        product_id=sample_product.id,
        units_per_box=12,
        is_active=True,
    )
    db_session.add(box)
    db_session.flush()
    place_sealed_boxes(
        db_session,
        box_barcode="BOX-INCON-RM",
        location_id=sample_location.id,
        lot_id=lot.id,
        user=inv_user,
        box_count=2,
    )
    box.units_per_box = 120
    db_session.flush()

    result = remove_sealed_box(
        db_session,
        box_barcode="BOX-INCON-RM",
        user=inv_user,
        reason="inventory_reconcile",
        location_id=sample_location.id,
        lot_id=lot.id,
    )
    assert result.data_inconsistent is True
    assert result.box_count == 0
    assert result.loose_units == 100
    assert len(result.sealed_boxes) == 1
    assert result.sealed_boxes[0].units_per_box == 120
