"""
Tests for picker inventory API endpoints.
"""
import pytest
from decimal import Decimal
from datetime import date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.product import Product, ProductBarcode
from app.models.location import Location
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.auth.security import get_password_hash


@pytest.fixture
def picker_user(db_session: Session) -> User:
    u = User(
        username="picker_test",
        password_hash=get_password_hash("testpass123"),
        role="picker",
        is_active=True,
    )
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u


@pytest.fixture
def test_location(db_session: Session) -> Location:
    loc = Location(code="A-01-01", name="Shelf A", type="bin", is_active=True)
    db_session.add(loc)
    db_session.commit()
    db_session.refresh(loc)
    return loc


@pytest.fixture
def test_product_with_barcode(db_session: Session) -> Product:
    p = Product(
        external_source="test",
        external_id="ext-001",
        name="Test Product",
        sku="SKU-001",
        barcode="123456789",
        is_active=True,
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


def test_picker_inventory_list_returns_items(
    client: TestClient,
    picker_user: User,
    test_product_with_barcode: Product,
    test_location: Location,
    db_session: Session,
):
    """Test GET /inventory/picker returns product list with FEFO data"""
    lot = StockLot(
        product_id=test_product_with_barcode.id,
        batch="B1",
        expiry_date=date.today() + timedelta(days=30),
    )
    db_session.add(lot)
    db_session.flush()
    StockMovement(
        product_id=test_product_with_barcode.id,
        lot_id=lot.id,
        location_id=test_location.id,
        qty_change=Decimal("10"),
        movement_type="receipt",
    )
    db_session.commit()

    login = client.post("/api/v1/auth/login", json={"username": "picker_test", "password": "testpass123"})
    assert login.status_code == 200
    token = login.json()["access_token"]

    resp = client.get(
        "/api/v1/inventory/picker",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert len(data["items"]) >= 1
    item = next((i for i in data["items"] if i["product_id"] == str(test_product_with_barcode.id)), None)
    assert item is not None
    assert item["name"] == "Test Product"
    assert item["main_barcode"] == "123456789"
    assert item["available_qty"] == 10
    assert "best_location" in item
    assert "top_locations" in item


def test_scanner_resolve_product(
    client: TestClient,
    picker_user: User,
    test_product_with_barcode: Product,
):
    """Test POST /scanner/resolve returns PRODUCT for product barcode"""
    login = client.post("/api/v1/auth/login", json={"username": "picker_test", "password": "testpass123"})
    token = login.json()["access_token"]

    resp = client.post(
        "/api/v1/scanner/resolve",
        json={"barcode": "123456789"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["type"] == "PRODUCT"
    assert data["entity_id"] == str(test_product_with_barcode.id)
    assert "Test Product" in (data["display_label"] or "")


def test_scanner_resolve_location(
    client: TestClient,
    picker_user: User,
    test_location: Location,
):
    """Test POST /scanner/resolve returns LOCATION for location code"""
    login = client.post("/api/v1/auth/login", json={"username": "picker_test", "password": "testpass123"})
    token = login.json()["access_token"]

    resp = client.post(
        "/api/v1/scanner/resolve",
        json={"barcode": test_location.code},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["type"] == "LOCATION"
    assert data["entity_id"] == str(test_location.id)


def test_scanner_resolve_unknown(client: TestClient, picker_user: User):
    """Test POST /scanner/resolve returns UNKNOWN for unknown barcode"""
    login = client.post("/api/v1/auth/login", json={"username": "picker_test", "password": "testpass123"})
    token = login.json()["access_token"]

    resp = client.post(
        "/api/v1/scanner/resolve",
        json={"barcode": "UNKNOWN-BARCODE-999"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["type"] == "UNKNOWN"
    assert resp.json()["entity_id"] is None


def test_picker_inventory_detail(
    client: TestClient,
    picker_user: User,
    test_product_with_barcode: Product,
    test_location: Location,
    db_session: Session,
):
    """Test GET /inventory/picker/{product_id} returns full breakdown"""
    lot = StockLot(
        product_id=test_product_with_barcode.id,
        batch="B2",
        expiry_date=date.today() + timedelta(days=60),
    )
    db_session.add(lot)
    db_session.flush()
    StockMovement(
        product_id=test_product_with_barcode.id,
        lot_id=lot.id,
        location_id=test_location.id,
        qty_change=Decimal("5"),
        movement_type="receipt",
    )
    db_session.commit()

    login = client.post("/api/v1/auth/login", json={"username": "picker_test", "password": "testpass123"})
    token = login.json()["access_token"]

    resp = client.get(
        f"/api/v1/inventory/picker/{test_product_with_barcode.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["product_id"] == str(test_product_with_barcode.id)
    assert data["name"] == "Test Product"
    assert "locations" in data
    assert len(data["locations"]) >= 1
    loc = data["locations"][0]
    assert loc["location_code"] == test_location.code
    assert loc["available_qty"] == 5
    assert "lot_id" in loc
    assert "batch_no" in loc
