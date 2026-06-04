"""Warehouse transfers list: pairing, pagination response, default dates, barcode."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.location import Location
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.auth.security import get_password_hash


def _mk_admin(db: Session) -> User:
    u = User(
        username=f"adm-wt-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _seed_transfer_pair(db: Session, *, user_id: uuid.UUID, sku: str) -> None:
    product = Product(
        external_source="test",
        external_id=f"prod-{uuid.uuid4().hex[:8]}",
        name="Transfer Product",
        sku=sku,
        barcode=f"BC-{sku}",
        is_active=True,
    )
    db.add(product)
    db.flush()
    loc_a = Location(
        code=f"A-{uuid.uuid4().hex[:4]}",
        barcode_value=f"A-{uuid.uuid4().hex[:4]}",
        name="A",
        type="bin",
        is_active=True,
    )
    loc_b = Location(
        code=f"B-{uuid.uuid4().hex[:4]}",
        barcode_value=f"B-{uuid.uuid4().hex[:4]}",
        name="B",
        type="bin",
        is_active=True,
    )
    db.add_all([loc_a, loc_b])
    db.flush()
    lot = StockLot(product_id=product.id, batch="1", expiry_date=None)
    db.add(lot)
    db.flush()
    now = datetime.now(timezone.utc)
    qty = Decimal("3")
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc_a.id,
            qty_change=-qty,
            movement_type="adjust",
            reason_code="inventory_shortage",
            created_by_user_id=user_id,
            created_at=now,
        )
    )
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc_b.id,
            qty_change=qty,
            movement_type="adjust",
            reason_code="inventory_overage",
            created_by_user_id=user_id,
            created_at=now,
        )
    )
    db.commit()


def test_warehouse_transfers_list_items_total_and_barcode(
    client: TestClient, db_session: Session
) -> None:
    admin = _mk_admin(db_session)
    sku = f"WT-{uuid.uuid4().hex[:6]}"
    _seed_transfer_pair(db_session, user_id=admin.id, sku=sku)
    today = date.today().isoformat()

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.get(
            "/api/v1/inventory/movements/warehouse-transfers",
            params={"date_from": today, "date_to": today, "limit": 50, "offset": 0},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert res.status_code == 200
    body = res.json()
    assert "items" in body
    assert "total" in body
    assert body["total"] >= 1
    assert len(body["items"]) >= 1
    row = body["items"][0]
    assert row.get("product_code") == sku
    assert row.get("product_barcode") == f"BC-{sku}"


def test_warehouse_transfers_default_date_range(
    client: TestClient, db_session: Session
) -> None:
    admin = _mk_admin(db_session)
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.get(
            "/api/v1/inventory/movements/warehouse-transfers",
            params={"limit": 10, "offset": 0},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert res.status_code == 200
    assert "items" in res.json()
