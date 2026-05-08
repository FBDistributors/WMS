from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.security import get_password_hash
from app.models.location import Location
from app.models.product import Product
from app.models.user import User


def _login_headers(client: TestClient, username: str, password: str) -> dict[str, str]:
    resp = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _seed_product_and_location(db_session: Session) -> tuple[Product, Location]:
    product = Product(
        external_source="test",
        external_id="ret-ext-01",
        name="Return Product",
        sku="RET-001",
        is_active=True,
    )
    location = Location(
        code="P-R-01",
        barcode_value="P-R-01",
        name="Return Floor",
        type="bin",
        is_active=True,
    )
    db_session.add(product)
    db_session.add(location)
    db_session.commit()
    db_session.refresh(product)
    db_session.refresh(location)
    return product, location


def _seed_admin_user(db_session: Session) -> User:
    user = User(
        username="returns_admin",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_create_customer_return_accepts_qty_without_available_cap(
    client: TestClient,
    db_session: Session,
):
    _seed_admin_user(db_session)
    product, location = _seed_product_and_location(db_session)
    headers = _login_headers(client, "returns_admin", "testpass123")

    payload = {
        "customer_id": "C001",
        "customer_name": "Customer One",
        "reason_code": "customer_return",
        "lines": [
            {
                "product_id": str(product.id),
                "location_id": str(location.id),
                "qty": 999,
                "product_name": product.name,
                "location_code": location.code,
                "batch": "RET-B1",
            }
        ],
    }

    resp = client.post("/api/v1/customer-returns", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["reason_code"] == "customer_return"
    assert float(data["lines"][0]["qty"]) == 999.0


def test_create_customer_return_requires_reason_code(
    client: TestClient,
    db_session: Session,
):
    _seed_admin_user(db_session)
    product, location = _seed_product_and_location(db_session)
    headers = _login_headers(client, "returns_admin", "testpass123")

    payload = {
        "customer_id": "C002",
        "customer_name": "Customer Two",
        "lines": [
            {
                "product_id": str(product.id),
                "location_id": str(location.id),
                "qty": 5,
                "product_name": product.name,
                "location_code": location.code,
            }
        ],
    }

    resp = client.post("/api/v1/customer-returns", json=payload, headers=headers)
    assert resp.status_code == 422


def test_create_customer_return_rejects_invalid_reason_code(
    client: TestClient,
    db_session: Session,
):
    _seed_admin_user(db_session)
    product, location = _seed_product_and_location(db_session)
    headers = _login_headers(client, "returns_admin", "testpass123")

    payload = {
        "customer_id": "C003",
        "customer_name": "Customer Three",
        "reason_code": "something_else",
        "lines": [
            {
                "product_id": str(product.id),
                "location_id": str(location.id),
                "qty": 5,
                "product_name": product.name,
                "location_code": location.code,
            }
        ],
    }

    resp = client.post("/api/v1/customer-returns", json=payload, headers=headers)
    assert resp.status_code == 422


def test_create_customer_return_rejects_non_integer_qty(
    client: TestClient,
    db_session: Session,
):
    _seed_admin_user(db_session)
    product, location = _seed_product_and_location(db_session)
    headers = _login_headers(client, "returns_admin", "testpass123")

    payload = {
        "customer_id": "C004",
        "customer_name": "Customer Four",
        "reason_code": "damaged",
        "lines": [
            {
                "product_id": str(product.id),
                "location_id": str(location.id),
                "qty": 1.5,
                "product_name": product.name,
                "location_code": location.code,
            }
        ],
    }

    resp = client.post("/api/v1/customer-returns", json=payload, headers=headers)
    assert resp.status_code == 422


def test_create_customer_return_without_location_is_allowed(
    client: TestClient,
    db_session: Session,
):
    _seed_admin_user(db_session)
    product, _location = _seed_product_and_location(db_session)
    headers = _login_headers(client, "returns_admin", "testpass123")

    payload = {
        "customer_id": "C005",
        "customer_name": "Customer Five",
        "reason_code": "customer_return",
        "lines": [
            {
                "product_id": str(product.id),
                "qty": 3,
                "product_name": product.name,
                "batch": "RET-NO-LOC-1",
            }
        ],
    }

    resp = client.post("/api/v1/customer-returns", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["lines"][0]["location_id"] is None
    assert data["lines"][0]["location_code"] == ""


def test_complete_customer_return_requires_location_mapping(
    client: TestClient,
    db_session: Session,
):
    admin = _seed_admin_user(db_session)
    picker = User(
        username="returns_picker",
        password_hash=get_password_hash("testpass123"),
        role="picker",
        is_active=True,
    )
    db_session.add(picker)
    db_session.commit()
    db_session.refresh(admin)
    db_session.refresh(picker)

    product, _location = _seed_product_and_location(db_session)
    admin_headers = _login_headers(client, "returns_admin", "testpass123")
    picker_headers = _login_headers(client, "returns_picker", "testpass123")

    create_payload = {
        "customer_id": "C006",
        "customer_name": "Customer Six",
        "reason_code": "customer_return",
        "lines": [
            {
                "product_id": str(product.id),
                "qty": 2,
                "product_name": product.name,
                "batch": "RET-NO-LOC-2",
            }
        ],
    }
    create_resp = client.post("/api/v1/customer-returns", json=create_payload, headers=admin_headers)
    assert create_resp.status_code == 201, create_resp.text
    return_id = create_resp.json()["id"]

    approve_resp = client.post(f"/api/v1/customer-returns/{return_id}/controller-approve", headers=admin_headers)
    assert approve_resp.status_code == 200, approve_resp.text

    assign_resp = client.post(
        f"/api/v1/customer-returns/{return_id}/assign-picker",
        json={"picker_user_id": str(picker.id)},
        headers=admin_headers,
    )
    assert assign_resp.status_code == 200, assign_resp.text

    complete_resp = client.post(
        f"/api/v1/customer-returns/{return_id}/complete",
        json={},
        headers=picker_headers,
    )
    assert complete_resp.status_code == 400
    assert "location_id or lines[] is required" in complete_resp.text
