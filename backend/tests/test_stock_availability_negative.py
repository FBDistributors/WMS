"""
Negative-stock guards: available formula, require_sufficient_available, inventory adjust API.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.location import Location
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.services.stock_availability import (
    compute_lot_location_available,
    require_sufficient_available,
)


@pytest.fixture
def admin_user(db_session: Session) -> User:
    u = User(
        username="avail_admin",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u


@pytest.fixture
def bin_loc(db_session: Session) -> Location:
    loc = Location(
        code="AVAIL-01",
        barcode_value="AVAIL-01",
        name="Avail bin",
        type="bin",
        is_active=True,
    )
    db_session.add(loc)
    db_session.commit()
    db_session.refresh(loc)
    return loc


@pytest.fixture
def prod(db_session: Session) -> Product:
    p = Product(
        external_source="test",
        external_id="avail-prod-1",
        name="Avail Product",
        sku="SKU-AVAIL-1",
        is_active=True,
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


def test_compute_available_matches_ledger_formula(
    db_session: Session, prod: Product, bin_loc: Location
) -> None:
    """available = on_hand_sum - reserved_sum (picker_inventory bilan bir xil)."""
    lot = StockLot(product_id=prod.id, batch="B-AV", expiry_date=None)
    db_session.add(lot)
    db_session.flush()
    db_session.add(
        StockMovement(
            product_id=prod.id,
            lot_id=lot.id,
            location_id=bin_loc.id,
            qty_change=Decimal("10"),
            movement_type="receipt",
        )
    )
    db_session.add(
        StockMovement(
            product_id=prod.id,
            lot_id=lot.id,
            location_id=bin_loc.id,
            qty_change=Decimal("4"),
            movement_type="allocate",
        )
    )
    db_session.commit()

    avail = compute_lot_location_available(db_session, lot.id, bin_loc.id)
    # S=14, R=4 → 10 (ajratish ikkala yig‘indiga ham kiradi, sof qoldiq receipt bilan bir xil).
    assert avail == Decimal("10")

    db_session.add(
        StockMovement(
            product_id=prod.id,
            lot_id=lot.id,
            location_id=bin_loc.id,
            qty_change=Decimal("-3"),
            movement_type="pick",
        )
    )
    db_session.commit()
    assert compute_lot_location_available(db_session, lot.id, bin_loc.id) == Decimal("7")


def test_require_sufficient_available_raises_409(
    db_session: Session, prod: Product, bin_loc: Location
) -> None:
    from fastapi import HTTPException

    lot = StockLot(product_id=prod.id, batch="B-RQ", expiry_date=None)
    db_session.add(lot)
    db_session.flush()
    db_session.add(
        StockMovement(
            product_id=prod.id,
            lot_id=lot.id,
            location_id=bin_loc.id,
            qty_change=Decimal("2"),
            movement_type="receipt",
        )
    )
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        require_sufficient_available(
            db_session,
            prod.id,
            lot.id,
            bin_loc.id,
            Decimal("5"),
            lock=False,
        )
    assert exc.value.status_code == status.HTTP_409_CONFLICT


def test_inventory_adjust_negative_over_available_returns_409(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    prod: Product,
    bin_loc: Location,
) -> None:
    lot = StockLot(product_id=prod.id, batch="B-ADJ", expiry_date=None)
    db_session.add(lot)
    db_session.flush()
    db_session.add(
        StockMovement(
            product_id=prod.id,
            lot_id=lot.id,
            location_id=bin_loc.id,
            qty_change=Decimal("3"),
            movement_type="receipt",
        )
    )
    db_session.commit()

    body = {
        "product_id": str(prod.id),
        "lot_id": str(lot.id),
        "location_id": str(bin_loc.id),
        "qty_change": "-5",
        "movement_type": "adjust",
    }
    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        r = client.post("/api/v1/inventory/movements", json=body)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert r.status_code == 409


def test_inventory_unallocate_negative_skips_available_gate(
    client: TestClient,
    db_session: Session,
    admin_user: User,
    prod: Product,
    bin_loc: Location,
) -> None:
    """unallocate available ni kamaytirmaydi — qo‘lda yozuv bloklanmasin."""
    lot = StockLot(product_id=prod.id, batch="B-UN", expiry_date=None)
    db_session.add(lot)
    db_session.flush()
    db_session.add(
        StockMovement(
            product_id=prod.id,
            lot_id=lot.id,
            location_id=bin_loc.id,
            qty_change=Decimal("10"),
            movement_type="receipt",
        )
    )
    db_session.add(
        StockMovement(
            product_id=prod.id,
            lot_id=lot.id,
            location_id=bin_loc.id,
            qty_change=Decimal("10"),
            movement_type="allocate",
        )
    )
    db_session.commit()

    body = {
        "product_id": str(prod.id),
        "lot_id": str(lot.id),
        "location_id": str(bin_loc.id),
        "qty_change": "-2",
        "movement_type": "unallocate",
    }
    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        r = client.post("/api/v1/inventory/movements", json=body)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert r.status_code == 201
