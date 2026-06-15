"""summary-light: mahsulot bo'yicha quti breakdown ustunlari."""
from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.location import Location
from app.models.product import Product
from app.models.product_box import ProductBox
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.auth.security import get_password_hash
from app.services.box_location_service import place_sealed_boxes


def _mk_admin(db: Session) -> User:
    user = User(
        username=f"adm-inv-box-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _seed_product_with_boxes_and_loose(
    db: Session,
    *,
    box_count: int = 2,
    units_per_box: int = 6,
    loose_qty: int = 5,
) -> Product:
    product = Product(
        external_source="test",
        external_id=f"ext-{uuid.uuid4()}",
        name="Summary Box Product",
        sku=f"SKU-SB-{uuid.uuid4().hex[:8]}",
        is_active=True,
    )
    db.add(product)
    db.flush()

    loc = Location(
        code=f"SB-{uuid.uuid4().hex[:6]}",
        barcode_value=f"SB-{uuid.uuid4().hex[:6]}",
        name="Summary bin",
        type="bin",
        is_active=True,
    )
    db.add(loc)
    db.flush()

    lot = StockLot(product_id=product.id, batch="SB-B1", expiry_date=None)
    db.add(lot)
    db.flush()

    total_qty = box_count * units_per_box + loose_qty
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            qty_change=Decimal(str(total_qty)),
            movement_type="receipt",
        )
    )

    box_barcode = f"BOX-SB-{uuid.uuid4().hex[:6]}"
    db.add(
        ProductBox(
            box_barcode=box_barcode,
            product_id=product.id,
            units_per_box=units_per_box,
            is_active=True,
        )
    )
    db.flush()

    inv = User(
        username=f"inv-sb-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="inventory_controller",
        is_active=True,
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)

    place_sealed_boxes(
        db,
        box_barcode=box_barcode,
        location_id=loc.id,
        lot_id=lot.id,
        user=inv,
        box_count=box_count,
    )
    db.commit()
    db.refresh(product)
    return product


def test_summary_light_includes_box_columns(
    client: TestClient,
    db_session: Session,
) -> None:
    product = _seed_product_with_boxes_and_loose(
        db_session,
        box_count=2,
        units_per_box=6,
        loose_qty=5,
    )
    admin = _mk_admin(db_session)
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.get(
            "/api/v1/inventory/summary-light",
            params={"search": product.sku, "limit": 10, "only_available": True},
        )
        assert res.status_code == 200, res.text
        items = res.json()["items"]
        assert len(items) >= 1
        row = next(i for i in items if i["product_id"] == str(product.id))
        assert row["box_count"] == 2
        assert row["units_in_boxes"] == 12
        assert row["loose_units"] == 5
    finally:
        app.dependency_overrides.pop(get_current_user, None)
