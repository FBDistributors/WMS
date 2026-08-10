"""Sektor bo'yicha inventarizatsiya va rezerv bloki.

Rezervdagi joy sanalmaydi: tovar terish uchun band, sanoq paytida javondan
ketishi mumkin. Blok serverda — faqat ilovada bo'lsa, eski versiya yoki ochiq
qolgan ekran baribir yozib yuborardi.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.location import Location
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from tests.test_order_transition_policy import _mk_user


def _seed_sector(db: Session, sector: str, pallets: tuple[int, ...]) -> list[Location]:
    """`P-{sector}-{palet}` ko'rinishidagi FLOOR joylari."""
    out: list[Location] = []
    for pallet in pallets:
        loc = Location(
            code=f"P-{sector}-{pallet:02d}",
            barcode_value=f"P-{sector}-{pallet:02d}",
            name=f"Palet {pallet}",
            type="FLOOR",
            sector=sector,
            pallet_no=pallet,
            is_active=True,
        )
        db.add(loc)
        out.append(loc)
    db.flush()
    return out


def _put_stock(db: Session, location: Location, qty: int = 10) -> tuple[Product, StockLot]:
    product = Product(
        external_source="test",
        external_id=f"p-{uuid.uuid4().hex[:8]}",
        name="Sektor mahsuloti",
        sku=f"SKU-SEC-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db.add(product)
    db.flush()
    lot = StockLot(product_id=product.id, batch="SEC", expiry_date=None)
    db.add(lot)
    db.flush()
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=location.id,
            qty_change=Decimal(qty),
            movement_type="receipt",
        )
    )
    db.flush()
    return product, lot


def _reserve(db: Session, product: Product, lot: StockLot, location: Location, qty: int) -> None:
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=location.id,
            qty_change=Decimal(qty),
            movement_type="allocate",
        )
    )
    db.flush()


def test_sector_lists_its_locations_with_blocked_flags(
    client: TestClient, db_session: Session
) -> None:
    sector = f"T{uuid.uuid4().hex[:3].upper()}"
    locs = _seed_sector(db_session, sector, (1, 2, 3))
    free_product, free_lot = _put_stock(db_session, locs[0])
    busy_product, busy_lot = _put_stock(db_session, locs[1])
    _reserve(db_session, busy_product, busy_lot, locs[1], 4)
    db_session.commit()

    user = _mk_user(db_session, username=f"inv-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        res = client.get(f"/api/v1/inventory/sector/P-{sector}")
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["sector"] == f"P-{sector}"
        codes = [loc["code"] for loc in body["locations"]]
        assert codes == [f"P-{sector}-01", f"P-{sector}-02", f"P-{sector}-03"]

        by_code = {loc["code"]: loc for loc in body["locations"]}
        assert by_code[f"P-{sector}-01"]["blocked"] is False
        assert by_code[f"P-{sector}-01"]["items_count"] == 1
        assert by_code[f"P-{sector}-02"]["blocked"] is True, "rezervdagi joy bloklanishi kerak"
        assert by_code[f"P-{sector}-03"]["blocked"] is False
        assert body["blocked_count"] == 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert free_product and free_lot and busy_lot  # seed ishlatildi


def test_inventory_adjust_is_refused_on_a_reserved_location(
    client: TestClient, db_session: Session
) -> None:
    sector = f"T{uuid.uuid4().hex[:3].upper()}"
    locs = _seed_sector(db_session, sector, (1,))
    product, lot = _put_stock(db_session, locs[0], qty=10)
    _reserve(db_session, product, lot, locs[0], 3)
    db_session.commit()

    user = _mk_user(db_session, username=f"inv2-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        res = client.post(
            "/api/v1/inventory/movements",
            json={
                "product_id": str(product.id),
                "lot_id": str(lot.id),
                "location_id": str(locs[0].id),
                "qty_change": -2,
                "movement_type": "adjust",
                "reason_code": "inventory_shortage",
            },
        )
        assert res.status_code == 409, res.text
        assert "band" in res.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_free_location_can_still_be_adjusted(client: TestClient, db_session: Session) -> None:
    sector = f"T{uuid.uuid4().hex[:3].upper()}"
    locs = _seed_sector(db_session, sector, (1,))
    product, lot = _put_stock(db_session, locs[0], qty=10)
    db_session.commit()

    user = _mk_user(db_session, username=f"inv3-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        res = client.post(
            "/api/v1/inventory/movements",
            json={
                "product_id": str(product.id),
                "lot_id": str(lot.id),
                "location_id": str(locs[0].id),
                "qty_change": -2,
                "movement_type": "adjust",
                "reason_code": "inventory_shortage",
            },
        )
        assert res.status_code == 201, res.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_other_adjust_reasons_are_not_blocked(client: TestClient, db_session: Session) -> None:
    """Blok faqat inventarizatsiyaga: boshqa sabablar (nuqson va h.k.) o'z holicha."""
    sector = f"T{uuid.uuid4().hex[:3].upper()}"
    locs = _seed_sector(db_session, sector, (1,))
    product, lot = _put_stock(db_session, locs[0], qty=10)
    _reserve(db_session, product, lot, locs[0], 3)
    db_session.commit()

    user = _mk_user(db_session, username=f"inv4-{uuid.uuid4().hex[:8]}", role="warehouse_admin")
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        res = client.post(
            "/api/v1/inventory/movements",
            json={
                "product_id": str(product.id),
                "lot_id": str(lot.id),
                "location_id": str(locs[0].id),
                "qty_change": -1,
                "movement_type": "adjust",
                "reason_code": "damaged",
            },
        )
        assert res.status_code in (201, 400, 403), res.text
        assert res.status_code != 409 or "band" not in res.json().get("detail", "")
    finally:
        app.dependency_overrides.pop(get_current_user, None)
