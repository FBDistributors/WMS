"""Qoldiq nollash faol yig'ish rezervini chetlab o'tadi (17.08.2026 hodisasi himoyasi).

Faol SO hujjat qatori ishora qilgan (lot, joy) juftligiga brend/ombor nollash
tegmasligi kerak — na adjust, na unallocate. Egasiz rezerv esa avvalgidek
bo'shatiladi.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.brand import Brand
from app.models.document import Document, DocumentLine
from app.models.location import Location
from app.models.order import Order, OrderWmsState
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.services.stock_availability import (
    compute_lot_location_balances,
    require_sufficient_reserved,
)


def _override_user(user: User):
    app.dependency_overrides[get_current_user] = lambda: user


def _clear_override():
    app.dependency_overrides.pop(get_current_user, None)


def _mk_admin(db: Session) -> User:
    admin = User(
        username=f"zero-adm-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def _mk_brand_product(db: Session) -> tuple[Brand, Product]:
    brand = Brand(code=f"BR{uuid.uuid4().hex[:4]}", name="Zero Brand", is_active=True)
    db.add(brand)
    db.flush()
    product = Product(
        external_source="test",
        external_id=f"zero-{uuid.uuid4().hex[:8]}",
        name="Zero Prod",
        sku=f"SKU-{uuid.uuid4().hex[:6]}",
        is_active=True,
        brand_id=brand.id,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return brand, product


def _mk_bin(db: Session) -> Location:
    loc = Location(
        code=f"S-{uuid.uuid4().hex[:6]}",
        barcode_value=f"S-{uuid.uuid4().hex[:6]}",
        name="Bin",
        type="bin",
        zone_type="NORMAL",
        is_active=True,
    )
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return loc


def _seed_stock(
    db: Session, product: Product, loc: Location, *, receipt: str, reserve: str
) -> StockLot:
    lot = StockLot(product_id=product.id, batch=f"B{uuid.uuid4().hex[:4]}", expiry_date=None)
    db.add(lot)
    db.flush()
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            qty_change=Decimal(receipt),
            movement_type="receipt",
        )
    )
    if Decimal(reserve) != 0:
        db.add(
            StockMovement(
                product_id=product.id,
                lot_id=lot.id,
                location_id=loc.id,
                qty_change=Decimal(reserve),
                movement_type="allocate",
            )
        )
    db.commit()
    db.refresh(lot)
    return lot


def _mk_so_doc(
    db: Session,
    product: Product,
    lot: StockLot,
    loc: Location,
    *,
    status: str,
    order_number: str,
    required: float = 3,
    picked: float = 0,
) -> Document:
    order = Order(
        source="test",
        source_external_id=f"ord-{uuid.uuid4().hex[:10]}",
        order_number=order_number,
    )
    order.wms_state = OrderWmsState(status="allocated")
    db.add(order)
    db.flush()
    doc = Document(
        doc_no=f"SO-{uuid.uuid4().hex[:8]}",
        doc_type="SO",
        status=status,
        order_id=order.id,
    )
    db.add(doc)
    db.flush()
    db.add(
        DocumentLine(
            document_id=doc.id,
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            product_name=product.name,
            location_code=loc.code,
            required_qty=required,
            picked_qty=picked,
        )
    )
    db.commit()
    return doc


def test_brand_zero_skips_active_reserve_pair(client: TestClient, db_session: Session):
    admin = _mk_admin(db_session)
    brand, product = _mk_brand_product(db_session)
    loc = _mk_bin(db_session)
    lot = _seed_stock(db_session, product, loc, receipt="10", reserve="3")
    _mk_so_doc(db_session, product, lot, loc, status="in_progress", order_number="104938")

    _override_user(admin)
    try:
        resp = client.post(f"/api/v1/inventory/brands/{brand.id}/zero-stock?mode=brand_and_reserve")
    finally:
        _clear_override()

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["active_skipped"] == 1
    assert payload["active_orders"] == ["104938"]
    assert payload["stock_movements_created"] == 0
    assert payload["reserve_movements_created"] == 0

    on_hand, reserved, available = compute_lot_location_balances(db_session, lot.id, loc.id)
    assert on_hand == Decimal("10")
    assert reserved == Decimal("3")
    assert available == Decimal("7")

    # Integratsiya-proksi: yig'uvchi darvozasi (rezerv tekshiruvi) ochiq qoladi.
    require_sufficient_reserved(
        db_session, product.id, lot.id, loc.id, Decimal("3"), lock=False
    )


def test_brand_zero_still_releases_orphan_reserve(client: TestClient, db_session: Session):
    admin = _mk_admin(db_session)
    brand, product = _mk_brand_product(db_session)
    loc = _mk_bin(db_session)
    lot = _seed_stock(db_session, product, loc, receipt="10", reserve="3")
    # Hujjat yakunlangan — rezerv egasiz, avvalgidek bo'shatilishi kerak.
    _mk_so_doc(db_session, product, lot, loc, status="completed", order_number="900001")

    _override_user(admin)
    try:
        resp = client.post(f"/api/v1/inventory/brands/{brand.id}/zero-stock?mode=brand_and_reserve")
    finally:
        _clear_override()

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["active_skipped"] == 0
    assert payload["stock_movements_created"] == 1
    assert payload["reserve_movements_created"] == 1

    _on_hand, reserved, _available = compute_lot_location_balances(db_session, lot.id, loc.id)
    assert reserved == Decimal("0")


def test_brand_zero_reserve_only_mode_skips_active(client: TestClient, db_session: Session):
    admin = _mk_admin(db_session)
    brand, product = _mk_brand_product(db_session)
    loc = _mk_bin(db_session)
    lot = _seed_stock(db_session, product, loc, receipt="10", reserve="3")
    _mk_so_doc(db_session, product, lot, loc, status="picked", order_number="104940")

    _override_user(admin)
    try:
        resp = client.post(f"/api/v1/inventory/brands/{brand.id}/zero-stock?mode=reserve_only")
    finally:
        _clear_override()

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["active_skipped"] == 1
    assert payload["reserve_movements_created"] == 0

    _on_hand, reserved, _available = compute_lot_location_balances(db_session, lot.id, loc.id)
    assert reserved == Decimal("3")


def test_main_zero_skips_active_pair_but_zeroes_rest(client: TestClient, db_session: Session):
    admin = _mk_admin(db_session)
    _brand, product = _mk_brand_product(db_session)
    active_loc = _mk_bin(db_session)
    idle_loc = _mk_bin(db_session)
    active_lot = _seed_stock(db_session, product, active_loc, receipt="10", reserve="3")
    idle_lot = _seed_stock(db_session, product, idle_loc, receipt="5", reserve="0")
    _mk_so_doc(db_session, product, active_lot, active_loc, status="in_progress", order_number="104950")

    _override_user(admin)
    try:
        resp = client.post("/api/v1/inventory/zero-stock/main?mode=brand_and_reserve")
    finally:
        _clear_override()

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["active_skipped"] == 1
    assert payload["active_orders"] == ["104950"]

    on_hand, reserved, _avail = compute_lot_location_balances(db_session, active_lot.id, active_loc.id)
    assert on_hand == Decimal("10")
    assert reserved == Decimal("3")

    idle_on_hand, idle_reserved, _ia = compute_lot_location_balances(db_session, idle_lot.id, idle_loc.id)
    assert idle_on_hand == Decimal("0")
    assert idle_reserved == Decimal("0")


def test_preflight_endpoint_reports_active_reserves_and_writes_nothing(
    client: TestClient, db_session: Session
):
    admin = _mk_admin(db_session)
    brand, product = _mk_brand_product(db_session)
    _other_brand, other_product = _mk_brand_product(db_session)
    loc = _mk_bin(db_session)
    other_loc = _mk_bin(db_session)
    lot = _seed_stock(db_session, product, loc, receipt="10", reserve="3")
    other_lot = _seed_stock(db_session, other_product, other_loc, receipt="5", reserve="2")
    _mk_so_doc(db_session, product, lot, loc, status="in_progress", order_number="104960")
    _mk_so_doc(db_session, other_product, other_lot, other_loc, status="picked", order_number="104961")

    from app.models.stock import StockMovement

    movements_before = db_session.query(StockMovement).count()

    _override_user(admin)
    try:
        brand_resp = client.get(
            f"/api/v1/inventory/zero-stock/active-reserves?scope=brand&brand_id={brand.id}"
        )
        main_resp = client.get("/api/v1/inventory/zero-stock/active-reserves?scope=main")
        missing_brand = client.get("/api/v1/inventory/zero-stock/active-reserves?scope=brand")
    finally:
        _clear_override()

    assert brand_resp.status_code == 200
    brand_payload = brand_resp.json()
    # Brend doirasi: faqat shu brendning buyurtmasi, boshqa brendniki emas.
    assert brand_payload["active_pairs"] == 1
    assert brand_payload["orders"] == ["104960"]

    assert main_resp.status_code == 200
    main_payload = main_resp.json()
    assert main_payload["active_pairs"] == 2
    assert main_payload["orders"] == ["104960", "104961"]

    assert missing_brand.status_code == 400

    # Pre-flight hech narsa yozmaydi.
    assert db_session.query(StockMovement).count() == movements_before
