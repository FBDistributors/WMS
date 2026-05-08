from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.brand import Brand
from app.models.location import Location
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.services.stock_availability import compute_lot_location_balances


def _override_user(user: User):
    app.dependency_overrides[get_current_user] = lambda: user


def _clear_override():
    app.dependency_overrides.pop(get_current_user, None)


def _seed_lot_with_movements(
    db_session: Session,
    *,
    product: Product,
    location: Location,
    receipt_qty: str,
    reserve_qty: str = "0",
) -> StockLot:
    lot = StockLot(product_id=product.id, batch=f"B-{location.code}", expiry_date=None)
    db_session.add(lot)
    db_session.flush()
    db_session.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=location.id,
            qty_change=Decimal(receipt_qty),
            movement_type="receipt",
        )
    )
    if Decimal(reserve_qty) != 0:
        db_session.add(
            StockMovement(
                product_id=product.id,
                lot_id=lot.id,
                location_id=location.id,
                qty_change=Decimal(reserve_qty),
                movement_type="allocate",
            )
        )
    db_session.commit()
    db_session.refresh(lot)
    return lot


def test_zero_main_stock_affects_only_main_warehouse(client: TestClient, db_session: Session) -> None:
    admin = User(
        username="zero_main_admin",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db_session.add(admin)
    db_session.flush()

    showroom_root = Location(
        code="SHOWROOM",
        barcode_value="SHOWROOM",
        name="Showroom Root",
        type="warehouse",
        is_active=True,
    )
    db_session.add_all([admin, showroom_root])
    db_session.commit()
    db_session.refresh(admin)
    db_session.refresh(showroom_root)

    main_bin = Location(
        code="MAIN-ZERO-01",
        barcode_value="MAIN-ZERO-01",
        name="Main Bin",
        type="bin",
        is_active=True,
    )
    showroom_bin = Location(
        code="SHW-ZERO-01",
        barcode_value="SHW-ZERO-01",
        name="Showroom Bin",
        type="bin",
        is_active=True,
        warehouse_id=showroom_root.id,
    )
    product = Product(
        external_source="test",
        external_id="zero-main-prod",
        name="Zero Main Product",
        sku="SKU-ZERO-MAIN-1",
        is_active=True,
    )
    db_session.add_all([main_bin, showroom_bin, product])
    db_session.commit()
    db_session.refresh(main_bin)
    db_session.refresh(showroom_bin)
    db_session.refresh(product)

    lot_main = _seed_lot_with_movements(
        db_session,
        product=product,
        location=main_bin,
        receipt_qty="10",
        reserve_qty="3",
    )
    lot_showroom = _seed_lot_with_movements(
        db_session,
        product=product,
        location=showroom_bin,
        receipt_qty="5",
        reserve_qty="2",
    )

    _override_user(admin)
    try:
        resp = client.post("/api/v1/inventory/zero-stock/main?mode=brand_and_reserve")
    finally:
        _clear_override()
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["warehouse"] == "main"
    assert payload["movements_created"] >= 2

    main_on_hand, main_reserved, main_available = compute_lot_location_balances(
        db_session,
        lot_main.id,
        main_bin.id,
    )
    showroom_on_hand, showroom_reserved, showroom_available = compute_lot_location_balances(
        db_session,
        lot_showroom.id,
        showroom_bin.id,
    )
    assert main_on_hand == 0
    assert main_reserved == 0
    assert main_available == 0
    assert showroom_on_hand == Decimal("5")
    assert showroom_reserved == Decimal("2")
    assert showroom_available == Decimal("3")


def test_import_qty_rows_fills_product_brand_id_when_missing(client: TestClient, db_session: Session) -> None:
    admin = User(
        username="import_brand_fill_admin",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    brand = Brand(code="IBF", name="Import Brand Fill", is_active=True)
    location = Location(
        code="IMP-BRAND-01",
        barcode_value="IMP-BRAND-01",
        name="Import Brand Bin",
        type="bin",
        is_active=True,
    )
    product = Product(
        external_source="test",
        external_id="import-brand-fill-prod",
        name="Import Brand Fill Product",
        sku="SKU-IMP-BRAND-FILL-1",
        is_active=True,
        brand_id=None,
    )
    db_session.add_all([admin, brand, location, product])
    db_session.commit()
    db_session.refresh(brand)
    db_session.refresh(location)
    db_session.refresh(product)

    _override_user(admin)
    try:
        resp = client.post(
            "/api/v1/inventory/import-qty-rows",
            json={
                "warehouse": "main",
                "lines": [
                    {
                        "code": product.sku,
                        "qty": 4,
                        "location_code": location.code,
                        "brand_id": str(brand.id),
                    }
                ],
            },
        )
    finally:
        _clear_override()
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["applied_rows"] == 1
    assert payload["skipped_rows"] == 0
    assert payload["errors"] == []

    db_session.refresh(product)
    assert product.brand_id == brand.id


def test_import_qty_rows_accepts_brand_code_like_admin_ui(client: TestClient, db_session: Session) -> None:
    """Excel brand_id column may contain brands.code (e.g. 006) instead of UUID."""
    admin = User(
        username="import_brand_code_admin",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    brand = Brand(code="006", name="Code Match Brand", is_active=True)
    location = Location(
        code="IMP-BRAND-CODE-01",
        barcode_value="IMP-BRAND-CODE-01",
        name="Import Brand Code Bin",
        type="bin",
        is_active=True,
    )
    product = Product(
        external_source="test",
        external_id="import-brand-code-prod",
        name="Import Brand Code Product",
        sku="SKU-IMP-BRAND-CODE-1",
        is_active=True,
        brand_id=None,
    )
    db_session.add_all([admin, brand, location, product])
    db_session.commit()
    db_session.refresh(brand)
    db_session.refresh(location)
    db_session.refresh(product)

    _override_user(admin)
    try:
        resp = client.post(
            "/api/v1/inventory/import-qty-rows",
            json={
                "warehouse": "main",
                "lines": [
                    {
                        "code": product.sku,
                        "qty": 2,
                        "location_code": location.code,
                        "brand_id": "006",
                    }
                ],
            },
        )
    finally:
        _clear_override()
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["applied_rows"] == 1
    assert payload["skipped_rows"] == 0
    assert payload["errors"] == []

    db_session.refresh(product)
    assert product.brand_id == brand.id


def test_import_qty_rows_rejects_brand_id_mismatch(client: TestClient, db_session: Session) -> None:
    admin = User(
        username="import_brand_mismatch_admin",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    brand_a = Brand(code="IBA", name="Import Brand A", is_active=True)
    brand_b = Brand(code="IBB", name="Import Brand B", is_active=True)
    db_session.add_all([admin, brand_a, brand_b])
    db_session.commit()
    db_session.refresh(brand_a)
    db_session.refresh(brand_b)

    location = Location(
        code="IMP-BRAND-02",
        barcode_value="IMP-BRAND-02",
        name="Import Brand Bin 2",
        type="bin",
        is_active=True,
    )
    product = Product(
        external_source="test",
        external_id="import-brand-mismatch-prod",
        name="Import Brand Mismatch Product",
        sku="SKU-IMP-BRAND-MISMATCH-1",
        is_active=True,
        brand_id=brand_a.id,
    )
    db_session.add_all([location, product])
    db_session.commit()
    db_session.refresh(brand_b)
    db_session.refresh(location)
    db_session.refresh(product)

    _override_user(admin)
    try:
        resp = client.post(
            "/api/v1/inventory/import-qty-rows",
            json={
                "warehouse": "main",
                "lines": [
                    {
                        "code": product.sku,
                        "qty": 6,
                        "location_code": location.code,
                        "brand_id": str(brand_b.id),
                    }
                ],
            },
        )
    finally:
        _clear_override()
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["applied_rows"] == 0
    assert payload["skipped_rows"] == 1
    assert payload["errors"]
    assert "brand_id mismatch" in payload["errors"][0]["message"]
