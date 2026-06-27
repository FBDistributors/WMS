"""Product box barcode replace (inventarizatsiya)."""
from __future__ import annotations

import uuid
from decimal import Decimal

from app.auth.deps import get_current_user
from app.main import app
from app.models.location import Location as LocationModel
from app.models.product import Product as ProductModel
from app.models.product_box import ProductBox as ProductBoxModel
from app.models.stock import StockLot, StockMovement
from app.models.user import User as UserModel
from app.auth.security import get_password_hash
from app.services.box_location_service import place_sealed_box


def _admin(db_session) -> UserModel:
    u = UserModel(
        username=f"adm-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("x"),
        role="warehouse_admin",
        is_active=True,
    )
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u


def _product(db_session) -> ProductModel:
    p = ProductModel(
        external_source="test",
        external_id=f"ext-{uuid.uuid4()}",
        name="Replace Box Product",
        sku=f"SKU-RB-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db_session.add(p)
    db_session.flush()
    return p


def _location(db_session) -> LocationModel:
    loc = LocationModel(
        code=f"RB-{uuid.uuid4().hex[:6]}",
        barcode_value=f"RB-{uuid.uuid4().hex[:6]}",
        name="Replace Loc",
        type="bin",
        is_active=True,
    )
    db_session.add(loc)
    db_session.flush()
    return loc


def _seed_stock(db_session, product, location, qty: int) -> StockLot:
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


def _inv_user(db_session) -> UserModel:
    u = UserModel(
        username=f"inv-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("x"),
        role="inventory_controller",
        is_active=True,
    )
    db_session.add(u)
    db_session.flush()
    return u


def test_replace_barcode_patches_when_sealed_placement(
    client, db_session,
) -> None:
    admin = _admin(db_session)
    inv = _inv_user(db_session)
    product = _product(db_session)
    location = _location(db_session)
    lot = _seed_stock(db_session, product, location, 50)
    wrong = ProductBoxModel(
        box_barcode="WRONG-BOX-001",
        product_id=product.id,
        units_per_box=12,
        is_active=True,
    )
    db_session.add(wrong)
    db_session.commit()
    place_sealed_box(
        db_session,
        box_barcode=wrong.box_barcode,
        location_id=location.id,
        lot_id=lot.id,
        user=inv,
    )
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            "/api/v1/product-boxes/replace-barcode",
            json={
                "old_box_id": str(wrong.id),
                "new_barcode": "CORRECT-BOX-001",
                "product_id": str(product.id),
                "units_per_box": 12,
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert data["box_id"] == str(wrong.id)
        assert data["units_per_box"] == 12

        db_session.refresh(wrong)
        assert wrong.box_barcode == "CORRECT-BOX-001"
        assert wrong.is_active is True

        resolve = client.get("/api/v1/product-boxes/by-barcode/CORRECT-BOX-001")
        assert resolve.status_code == 200
        assert resolve.json()["box_id"] == str(wrong.id)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_replace_barcode_deactivates_old_without_placement(client, db_session) -> None:
    admin = _admin(db_session)
    product = _product(db_session)
    wrong = ProductBoxModel(
        box_barcode="WRONG-ONLY-001",
        product_id=product.id,
        units_per_box=6,
        is_active=True,
    )
    db_session.add(wrong)
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            "/api/v1/product-boxes/replace-barcode",
            json={
                "old_box_id": str(wrong.id),
                "new_barcode": "NEW-ONLY-001",
                "product_id": str(product.id),
                "units_per_box": 6,
            },
        )
        assert res.status_code == 200
        new_id = res.json()["box_id"]
        assert new_id != str(wrong.id)

        db_session.refresh(wrong)
        assert wrong.is_active is False

        new_box = db_session.get(ProductBoxModel, uuid.UUID(new_id))
        assert new_box is not None
        assert new_box.box_barcode == "NEW-ONLY-001"
        assert new_box.is_active is True
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_replace_barcode_conflict_when_new_exists(client, db_session) -> None:
    admin = _admin(db_session)
    product = _product(db_session)
    old = ProductBoxModel(
        box_barcode="OLD-X",
        product_id=product.id,
        units_per_box=10,
        is_active=True,
    )
    other = ProductBoxModel(
        box_barcode="TAKEN-X",
        product_id=product.id,
        units_per_box=10,
        is_active=True,
    )
    db_session.add_all([old, other])
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            "/api/v1/product-boxes/replace-barcode",
            json={
                "old_box_id": str(old.id),
                "new_barcode": "TAKEN-X",
                "product_id": str(product.id),
                "units_per_box": 10,
            },
        )
        assert res.status_code == 409
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_replace_barcode_updates_units_per_box_with_sealed_placement(
    client, db_session,
) -> None:
    """Bir xil barcode — sealed qutilar bo'lsa ham quti hajmi yangilanadi."""
    admin = _admin(db_session)
    inv = _inv_user(db_session)
    product = _product(db_session)
    location = _location(db_session)
    lot = _seed_stock(db_session, product, location, 230)
    box = ProductBoxModel(
        box_barcode="BOX-UPB-FIX",
        product_id=product.id,
        units_per_box=10,
        is_active=True,
    )
    db_session.add(box)
    db_session.commit()
    place_sealed_box(
        db_session,
        box_barcode=box.box_barcode,
        location_id=location.id,
        lot_id=lot.id,
        user=inv,
    )
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            "/api/v1/product-boxes/replace-barcode",
            json={
                "old_box_id": str(box.id),
                "new_barcode": "BOX-UPB-FIX",
                "product_id": str(product.id),
                "units_per_box": 12,
            },
        )
        assert res.status_code == 200, res.text
        assert res.json()["units_per_box"] == 12

        db_session.refresh(box)
        assert box.box_barcode == "BOX-UPB-FIX"
        assert box.units_per_box == 12
        assert box.is_active is True
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def _product_with_barcode(db_session, barcode: str) -> ProductModel:
    p = ProductModel(
        external_source="test",
        external_id=f"ext-{uuid.uuid4()}",
        name="Barcoded Product",
        sku=f"SKU-PB-{uuid.uuid4().hex[:6]}",
        barcode=barcode,
        is_active=True,
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


def test_create_box_barcode_colliding_with_product_barcode_rejected(client, db_session) -> None:
    admin = _admin(db_session)
    product = _product_with_barcode(db_session, "COLLIDE-123")
    box_product = _product(db_session)
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            "/api/v1/product-boxes",
            json={
                "box_barcode": "COLLIDE-123",
                "product_id": str(box_product.id),
                "units_per_box": 6,
            },
        )
        assert res.status_code == 409, res.text
        assert "mahsulot" in res.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_create_box_barcode_unique_ok(client, db_session) -> None:
    admin = _admin(db_session)
    _product_with_barcode(db_session, "PRODUCT-ONLY-1")
    box_product = _product(db_session)
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            "/api/v1/product-boxes",
            json={
                "box_barcode": "BOX-UNIQUE-1",
                "product_id": str(box_product.id),
                "units_per_box": 6,
            },
        )
        assert res.status_code == 201, res.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_replace_barcode_to_product_barcode_rejected(client, db_session) -> None:
    admin = _admin(db_session)
    _product_with_barcode(db_session, "COLLIDE-RPL")
    product = _product(db_session)
    box = ProductBoxModel(
        box_barcode="BOX-RPL-OLD",
        product_id=product.id,
        units_per_box=6,
        is_active=True,
    )
    db_session.add(box)
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            "/api/v1/product-boxes/replace-barcode",
            json={
                "old_box_id": str(box.id),
                "new_barcode": "COLLIDE-RPL",
                "product_id": str(product.id),
                "units_per_box": 6,
            },
        )
        assert res.status_code == 409, res.text
        assert "mahsulot" in res.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
