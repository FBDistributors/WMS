"""Butun sektorni ko'chirish: `P-H → P-K`, joy-joyga, hammasi yoki hech narsa."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.location import Location
from app.models.location_box_placement import PLACEMENT_SEALED, LocationBoxPlacement
from app.models.product import Product
from app.models.product_box import ProductBox
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.services.box_location_service import place_sealed_boxes
from app.services.stock_availability import compute_lot_location_balances

ENDPOINT = "/api/v1/inventory/movements/sector-transfer"


@pytest.fixture
def admin_user(db_session: Session) -> User:
    u = User(
        username=f"sector_exec_{uuid.uuid4().hex[:6]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db_session.add(u)
    db_session.flush()
    return u


@pytest.fixture
def as_admin(admin_user: User):
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def product(db_session: Session) -> Product:
    p = Product(
        external_source="test",
        external_id=f"secx-{uuid.uuid4().hex[:8]}",
        name="Sector move product",
        sku=f"SKU-SECX-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db_session.add(p)
    db_session.flush()
    return p


def _loc(db: Session, code: str) -> Location:
    location = Location(
        code=code,
        barcode_value=f"{code}-{uuid.uuid4().hex[:6]}",
        name=code,
        type="bin",
        is_active=True,
    )
    db.add(location)
    db.flush()
    return location


def _stock(
    db: Session,
    product: Product,
    loc: Location,
    *,
    qty: str = "10",
    reserved: str = "0",
    expiry: date | None = None,
) -> StockLot:
    lot = StockLot(product_id=product.id, batch=f"B-{uuid.uuid4().hex[:6]}", expiry_date=expiry)
    db.add(lot)
    db.flush()
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            qty_change=Decimal(qty),
            movement_type="receipt",
        )
    )
    if Decimal(reserved) != 0:
        db.add(
            StockMovement(
                product_id=product.id,
                lot_id=lot.id,
                location_id=loc.id,
                qty_change=Decimal(reserved),
                movement_type="allocate",
            )
        )
    db.flush()
    return lot


def _on_hand(db: Session, lot: StockLot, loc: Location) -> Decimal:
    on_hand, _reserved, _available = compute_lot_location_balances(db, lot.id, loc.id)
    return Decimal(str(on_hand))


class TestHappyPath:
    def test_whole_sector_moves_position_by_position(
        self, client, db_session: Session, product: Product, as_admin
    ) -> None:
        src1, src2 = _loc(db_session, "P-AA-01"), _loc(db_session, "P-AA-02")
        dst1, dst2 = _loc(db_session, "P-AB-01"), _loc(db_session, "P-AB-02")
        lot1 = _stock(db_session, product, src1, qty="10")
        lot2 = _stock(db_session, product, src2, qty="6")
        db_session.commit()

        resp = client.post(
            ENDPOINT,
            json={"from_sector": "P-AA", "to_sector": "P-AB"},
            headers={"Idempotency-Key": f"sec-ok-{uuid.uuid4().hex[:8]}"},
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["locations_transferred"] == 2
        assert body["lines_transferred"] == 2

        db_session.expire_all()
        # Har qator o'z o'rniga tushdi, aralashib ketmadi.
        assert _on_hand(db_session, lot1, src1) == Decimal("0")
        assert _on_hand(db_session, lot1, dst1) == Decimal("10")
        assert _on_hand(db_session, lot2, src2) == Decimal("0")
        assert _on_hand(db_session, lot2, dst2) == Decimal("6")

    def test_empty_source_locations_are_skipped(
        self, client, db_session: Session, product: Product, as_admin
    ) -> None:
        src1 = _loc(db_session, "P-BA-01")
        _loc(db_session, "P-BA-02")  # bo'sh
        _loc(db_session, "P-BB-01")
        _loc(db_session, "P-BB-02")
        _stock(db_session, product, src1)
        db_session.commit()

        resp = client.post(
            ENDPOINT,
            json={"from_sector": "P-BA", "to_sector": "P-BB"},
            headers={"Idempotency-Key": f"sec-skip-{uuid.uuid4().hex[:8]}"},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["locations_transferred"] == 1

    def test_sealed_boxes_move_with_their_placement(
        self, client, db_session: Session, product: Product, admin_user: User, as_admin
    ) -> None:
        src = _loc(db_session, "P-CA-01")
        dst = _loc(db_session, "P-CB-01")
        lot = _stock(db_session, product, src, qty="30")
        box = ProductBox(
            box_barcode=f"BOX-SEC-{uuid.uuid4().hex[:6]}",
            product_id=product.id,
            units_per_box=12,
            is_active=True,
        )
        db_session.add(box)
        db_session.commit()
        place_sealed_boxes(
            db_session,
            box_barcode=box.box_barcode,
            location_id=src.id,
            lot_id=lot.id,
            user=admin_user,
            box_count=1,
        )
        db_session.commit()

        resp = client.post(
            ENDPOINT,
            json={"from_sector": "P-CA", "to_sector": "P-CB"},
            headers={"Idempotency-Key": f"sec-box-{uuid.uuid4().hex[:8]}"},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["boxes_transferred"] == 1

        db_session.expire_all()
        placement = (
            db_session.query(LocationBoxPlacement)
            .filter(
                LocationBoxPlacement.product_box_id == box.id,
                LocationBoxPlacement.status == PLACEMENT_SEALED,
            )
            .one()
        )
        assert placement.location_id == dst.id
        # Qutidagi 12 + qutisiz 18 — hammasi ko'chdi.
        assert _on_hand(db_session, lot, src) == Decimal("0")
        assert _on_hand(db_session, lot, dst) == Decimal("30")


class TestAllOrNothing:
    def test_reserved_location_blocks_the_whole_sector(
        self, client, db_session: Session, product: Product, as_admin
    ) -> None:
        """Bitta joyda rezerv bo'lsa, muammosiz joy ham ko'chmasligi kerak."""
        src1, src2 = _loc(db_session, "P-DA-01"), _loc(db_session, "P-DA-02")
        dst1 = _loc(db_session, "P-DB-01")
        _loc(db_session, "P-DB-02")
        clean_lot = _stock(db_session, product, src1, qty="10")
        _stock(db_session, product, src2, qty="10", reserved="4")
        db_session.commit()
        movements_before = db_session.query(StockMovement).count()

        resp = client.post(
            ENDPOINT,
            json={"from_sector": "P-DA", "to_sector": "P-DB"},
            headers={"Idempotency-Key": f"sec-resv-{uuid.uuid4().hex[:8]}"},
        )

        assert resp.status_code == 409, resp.text
        detail = resp.json()["detail"]
        assert detail["code"] == "sector_transfer_blocked"
        assert detail["rows"][0]["from_code"] == "P-DA-02"
        assert detail["rows"][0]["status"] == "reserved"

        db_session.expire_all()
        # Hech narsa o'zgarmadi: muammosiz joy ham o'z o'rnida qoldi.
        assert _on_hand(db_session, clean_lot, src1) == Decimal("10")
        assert _on_hand(db_session, clean_lot, dst1) == Decimal("0")
        assert db_session.query(StockMovement).count() == movements_before

    def test_missing_destination_blocks_the_whole_sector(
        self, client, db_session: Session, product: Product, as_admin
    ) -> None:
        src1, src2 = _loc(db_session, "P-EA-01"), _loc(db_session, "P-EA-02")
        _loc(db_session, "P-EB-01")  # 02 yo'q
        lot1 = _stock(db_session, product, src1)
        _stock(db_session, product, src2)
        db_session.commit()

        resp = client.post(
            ENDPOINT,
            json={"from_sector": "P-EA", "to_sector": "P-EB"},
            headers={"Idempotency-Key": f"sec-miss-{uuid.uuid4().hex[:8]}"},
        )

        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["rows"][0]["status"] == "dest_missing"
        db_session.expire_all()
        assert _on_hand(db_session, lot1, src1) == Decimal("10")

    def test_expiry_conflict_blocks_the_whole_sector(
        self, client, db_session: Session, product: Product, as_admin
    ) -> None:
        src = _loc(db_session, "P-FA-01")
        dst = _loc(db_session, "P-FB-01")
        lot = _stock(db_session, product, src, expiry=date(2029, 2, 1))
        _stock(db_session, product, dst, expiry=date(2030, 5, 1))
        db_session.commit()

        resp = client.post(
            ENDPOINT,
            json={"from_sector": "P-FA", "to_sector": "P-FB"},
            headers={"Idempotency-Key": f"sec-exp-{uuid.uuid4().hex[:8]}"},
        )

        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["rows"][0]["status"] == "expiry_conflict"
        db_session.expire_all()
        assert _on_hand(db_session, lot, src) == Decimal("10")

    def test_empty_sector_is_rejected(
        self, client, db_session: Session, as_admin
    ) -> None:
        _loc(db_session, "P-GA-01")
        _loc(db_session, "P-GB-01")
        db_session.commit()

        resp = client.post(
            ENDPOINT,
            json={"from_sector": "P-GA", "to_sector": "P-GB"},
            headers={"Idempotency-Key": f"sec-empty-{uuid.uuid4().hex[:8]}"},
        )

        assert resp.status_code == 409, resp.text


class TestValidation:
    def test_same_sector_rejected(self, client, db_session: Session, as_admin) -> None:
        _loc(db_session, "P-HA-01")
        db_session.commit()

        resp = client.post(
            ENDPOINT,
            json={"from_sector": "P-HA", "to_sector": "P-HA"},
            headers={"Idempotency-Key": f"sec-same-{uuid.uuid4().hex[:8]}"},
        )

        assert resp.status_code == 400, resp.text

    def test_unknown_sector_returns_404(self, client, as_admin) -> None:
        resp = client.post(
            ENDPOINT,
            json={"from_sector": "P-NOPE", "to_sector": "P-NADA"},
            headers={"Idempotency-Key": f"sec-404-{uuid.uuid4().hex[:8]}"},
        )

        assert resp.status_code == 404, resp.text

    def test_scanned_pallet_codes_are_accepted(
        self, client, db_session: Session, product: Product, as_admin
    ) -> None:
        """Ombor xodimi palet yorlig'ini skanerlaydi, sektorni emas."""
        src = _loc(db_session, "P-IA-01")
        dst = _loc(db_session, "P-IB-01")
        lot = _stock(db_session, product, src)
        db_session.commit()

        resp = client.post(
            ENDPOINT,
            json={"from_sector": "P-IA-01", "to_sector": "P-IB-01"},
            headers={"Idempotency-Key": f"sec-scan-{uuid.uuid4().hex[:8]}"},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["from_prefix"] == "P-IA"
        db_session.expire_all()
        assert _on_hand(db_session, lot, dst) == Decimal("10")


class TestIdempotency:
    def test_replay_with_same_key_does_not_move_twice(
        self, client, db_session: Session, product: Product, as_admin
    ) -> None:
        src = _loc(db_session, "P-JA-01")
        dst = _loc(db_session, "P-JB-01")
        lot = _stock(db_session, product, src, qty="10")
        db_session.commit()
        key = f"sec-idem-{uuid.uuid4().hex[:8]}"

        first = client.post(
            ENDPOINT,
            json={"from_sector": "P-JA", "to_sector": "P-JB"},
            headers={"Idempotency-Key": key},
        )
        second = client.post(
            ENDPOINT,
            json={"from_sector": "P-JA", "to_sector": "P-JB"},
            headers={"Idempotency-Key": key},
        )

        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        assert second.json() == first.json()

        db_session.expire_all()
        # Ikki marta ko'chmadi.
        assert _on_hand(db_session, lot, dst) == Decimal("10")
        assert _on_hand(db_session, lot, src) == Decimal("0")
