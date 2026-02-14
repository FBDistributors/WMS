"""Tests for audit logging."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.location import Location
from app.models.product import Product
from app.models.user import User
from app.auth.security import get_password_hash


@pytest.fixture
def admin_user(db_session: Session) -> User:
    u = User(
        username="audit_admin",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u


@pytest.fixture
def picker_user(db_session: Session) -> User:
    u = User(
        username="audit_picker",
        password_hash=get_password_hash("testpass123"),
        role="picker",
        is_active=True,
    )
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u


@pytest.fixture
def auth_admin(client: TestClient, admin_user: User) -> dict:
    r = client.post(
        "/api/v1/auth/login",
        json={"username": "audit_admin", "password": "testpass123"},
    )
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def auth_picker(client: TestClient, picker_user: User) -> dict:
    r = client.post(
        "/api/v1/auth/login",
        json={"username": "audit_picker", "password": "testpass123"},
    )
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_create_product_logs_create(client: TestClient, db_session: Session, auth_admin: dict):
    """Creating a product logs CREATE action."""
    r = client.post(
        "/api/v1/products",
        json={
            "sku": "AUDIT-SKU-001",
            "name": "Audit Test Product",
            "barcodes": ["1234567890123"],
            "status": "active",
        },
        headers=auth_admin,
    )
    assert r.status_code == 201
    product_id = r.json()["id"]

    logs = db_session.query(AuditLog).filter(
        AuditLog.entity_type == "product",
        AuditLog.entity_id == product_id,
    ).all()
    assert len(logs) == 1
    assert logs[0].action == "CREATE"
    assert logs[0].new_data is not None
    assert logs[0].new_data.get("sku") == "AUDIT-SKU-001"


def test_update_location_logs_update(client: TestClient, db_session: Session, auth_admin: dict):
    """Updating a location logs UPDATE with old_data and new_data."""
    loc = Location(
        code="S-A1-01-01",
        barcode_value="S-A1-01-01",
        name="S-A1-01-01",
        type="rack",
        location_type="RACK",
        sector="A1",
        level=1,
        row_no=1,
        is_active=True,
    )
    db_session.add(loc)
    db_session.commit()
    db_session.refresh(loc)

    r = client.patch(
        f"/api/v1/locations/{loc.id}",
        json={"is_active": False},
        headers=auth_admin,
    )
    assert r.status_code == 200

    logs = db_session.query(AuditLog).filter(
        AuditLog.entity_type == "location",
        AuditLog.entity_id == str(loc.id),
    ).all()
    assert len(logs) >= 1
    update_log = next((l for l in logs if l.action == "UPDATE"), None)
    assert update_log is not None
    assert update_log.old_data is not None
    assert update_log.new_data is not None
    assert update_log.old_data.get("is_active") is True
    assert update_log.new_data.get("is_active") is False


def test_unauthorized_cannot_access_audit(client: TestClient, auth_picker: dict):
    """Picker (no audit:read) cannot access audit endpoint."""
    r = client.get("/api/v1/audit", headers=auth_picker)
    assert r.status_code == 403


def test_authorized_can_access_audit(client: TestClient, auth_admin: dict):
    """Warehouse admin (has audit:read) can access audit endpoint."""
    r = client.get("/api/v1/audit", headers=auth_admin)
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert "total" in data
    assert isinstance(data["items"], list)


def test_audit_without_token_returns_401(client: TestClient):
    """Audit endpoint requires authentication."""
    r = client.get("/api/v1/audit")
    assert r.status_code == 401
