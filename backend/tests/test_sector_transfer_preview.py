"""Sektor ko'chirish rejasi (preview): joy-joyga moslash va bloklovchi holatlar.

Ko'chirish "hammasi yoki hech narsa" bo'lgani uchun preview bajarilish bilan
aynan bir xil qaror qabul qilishi shart — shuning uchun har bir bloklovchi holat
alohida tekshiriladi.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.location import Location
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.models.user import User
from app.services.sector_transfer_service import (
    STATUS_DEST_MISSING,
    STATUS_DEST_NOT_EMPTY,
    STATUS_EMPTY,
    STATUS_EXPIRY_CONFLICT,
    STATUS_OK,
    STATUS_RESERVED,
    build_sector_transfer_plan,
)


@pytest.fixture
def admin_user(db_session: Session) -> User:
    u = User(
        username=f"sector_admin_{uuid.uuid4().hex[:6]}",
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
        external_id=f"sec-{uuid.uuid4().hex[:8]}",
        name="Sector test product",
        sku=f"SKU-SEC-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db_session.add(p)
    db_session.flush()
    return p


def _loc(db: Session, code: str, *, is_active: bool = True) -> Location:
    location = Location(
        code=code,
        barcode_value=f"{code}-{uuid.uuid4().hex[:6]}",
        name=code,
        type="bin",
        is_active=is_active,
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


def _statuses(plan) -> dict[str, str]:
    return {row.from_code: row.status for row in plan.rows}


class TestPlanMapping:
    def test_positions_are_paired_and_plan_is_submittable(
        self, db_session: Session, product: Product
    ) -> None:
        src1, src2 = _loc(db_session, "P-PA-01"), _loc(db_session, "P-PA-02")
        _loc(db_session, "P-PB-01")
        _loc(db_session, "P-PB-02")
        _stock(db_session, product, src1, qty="10")
        _stock(db_session, product, src2, qty="5")
        db_session.commit()

        plan = build_sector_transfer_plan(db_session, "P-PA", "P-PB")

        assert plan.can_submit is True
        assert [(r.from_code, r.to_code) for r in plan.rows] == [
            ("P-PA-01", "P-PB-01"),
            ("P-PA-02", "P-PB-02"),
        ]
        assert plan.locations_to_move == 2
        assert plan.lines_to_move == 2
        assert plan.total_qty_to_move == Decimal("15")

    def test_scanned_pallet_code_resolves_to_its_sector(
        self, db_session: Session, product: Product
    ) -> None:
        src = _loc(db_session, "P-SA-01")
        _loc(db_session, "P-SB-01")
        _stock(db_session, product, src)
        db_session.commit()

        plan = build_sector_transfer_plan(db_session, "P-SA-01", "P-SB-01")

        assert (plan.from_prefix, plan.to_prefix) == ("P-SA", "P-SB")

    def test_same_sector_rejected(self, db_session: Session) -> None:
        _loc(db_session, "P-SS-01")
        db_session.commit()

        with pytest.raises(HTTPException) as err:
            build_sector_transfer_plan(db_session, "P-SS", "P-SS")
        assert err.value.status_code == 400

    def test_mismatched_location_types_rejected(self, db_session: Session) -> None:
        _loc(db_session, "P-TA-01")
        _loc(db_session, "S-TB-01-01")
        db_session.commit()

        with pytest.raises(HTTPException) as err:
            build_sector_transfer_plan(db_session, "P-TA", "S-TB")
        assert err.value.status_code == 400
        assert "turlari mos emas" in str(err.value.detail)


class TestBlockingStatuses:
    def test_missing_destination_position_blocks(
        self, db_session: Session, product: Product
    ) -> None:
        src1, src2 = _loc(db_session, "P-MA-01"), _loc(db_session, "P-MA-02")
        _loc(db_session, "P-MB-01")  # 02 yo'q
        _stock(db_session, product, src1)
        _stock(db_session, product, src2)
        db_session.commit()

        plan = build_sector_transfer_plan(db_session, "P-MA", "P-MB")

        assert _statuses(plan) == {"P-MA-01": STATUS_OK, "P-MA-02": STATUS_DEST_MISSING}
        assert plan.can_submit is False

    def test_empty_source_does_not_need_a_destination(
        self, db_session: Session, product: Product
    ) -> None:
        """Bo'sh joyda manzil yo'qligi muammo emas — ko'chadigan narsa yo'q."""
        src1, _src2 = _loc(db_session, "P-EA-01"), _loc(db_session, "P-EA-02")
        _loc(db_session, "P-EB-01")
        _stock(db_session, product, src1)
        db_session.commit()

        plan = build_sector_transfer_plan(db_session, "P-EA", "P-EB")

        assert _statuses(plan) == {"P-EA-01": STATUS_OK, "P-EA-02": STATUS_EMPTY}
        assert plan.can_submit is True
        assert plan.locations_to_move == 1

    def test_reserved_stock_blocks(self, db_session: Session, product: Product) -> None:
        src = _loc(db_session, "P-RA-01")
        _loc(db_session, "P-RB-01")
        _stock(db_session, product, src, qty="10", reserved="4")
        db_session.commit()

        plan = build_sector_transfer_plan(db_session, "P-RA", "P-RB")

        assert _statuses(plan) == {"P-RA-01": STATUS_RESERVED}
        assert plan.can_submit is False

    def test_fully_reserved_stock_blocks(self, db_session: Session, product: Product) -> None:
        """available == 0 bo'lsa ham joy bo'sh emas — rezerv bloklashi kerak."""
        src = _loc(db_session, "P-FA-01")
        _loc(db_session, "P-FB-01")
        _stock(db_session, product, src, qty="10", reserved="10")
        db_session.commit()

        plan = build_sector_transfer_plan(db_session, "P-FA", "P-FB")

        assert _statuses(plan) == {"P-FA-01": STATUS_RESERVED}
        assert plan.can_submit is False

    def test_conflicting_expiry_at_destination_blocks(
        self, db_session: Session, product: Product
    ) -> None:
        src = _loc(db_session, "P-XA-01")
        dst = _loc(db_session, "P-XB-01")
        _stock(db_session, product, src, expiry=date(2029, 2, 1))
        _stock(db_session, product, dst, expiry=date(2030, 5, 1))
        db_session.commit()

        plan = build_sector_transfer_plan(db_session, "P-XA", "P-XB")

        assert _statuses(plan) == {"P-XA-01": STATUS_EXPIRY_CONFLICT}
        assert plan.can_submit is False

    def test_same_expiry_at_destination_is_only_a_warning(
        self, db_session: Session, product: Product
    ) -> None:
        src = _loc(db_session, "P-YA-01")
        dst = _loc(db_session, "P-YB-01")
        _stock(db_session, product, src, expiry=date(2029, 2, 1))
        _stock(db_session, product, dst, expiry=date(2029, 2, 1))
        db_session.commit()

        plan = build_sector_transfer_plan(db_session, "P-YA", "P-YB")

        assert _statuses(plan) == {"P-YA-01": STATUS_DEST_NOT_EMPTY}
        assert plan.can_submit is True
        assert plan.locations_to_move == 1

    def test_source_with_two_expiries_for_one_product_blocks(
        self, db_session: Session, product: Product
    ) -> None:
        """Manbaning o'zi nomuvofiq bo'lsa, ko'chirilganda manzil buziladi."""
        src = _loc(db_session, "P-ZA-01")
        _loc(db_session, "P-ZB-01")
        _stock(db_session, product, src, expiry=date(2029, 2, 1))
        _stock(db_session, product, src, expiry=date(2030, 2, 1))
        db_session.commit()

        plan = build_sector_transfer_plan(db_session, "P-ZA", "P-ZB")

        assert _statuses(plan) == {"P-ZA-01": STATUS_EXPIRY_CONFLICT}
        assert plan.can_submit is False

    def test_one_blocked_location_blocks_the_whole_plan(
        self, db_session: Session, product: Product
    ) -> None:
        src1, src2 = _loc(db_session, "P-WA-01"), _loc(db_session, "P-WA-02")
        _loc(db_session, "P-WB-01")
        _loc(db_session, "P-WB-02")
        _stock(db_session, product, src1)
        _stock(db_session, product, src2, qty="10", reserved="2")
        db_session.commit()

        plan = build_sector_transfer_plan(db_session, "P-WA", "P-WB")

        assert _statuses(plan) == {"P-WA-01": STATUS_OK, "P-WA-02": STATUS_RESERVED}
        # Bitta joy ko'chishga tayyor bo'lsa ham butun amal bloklanadi.
        assert plan.can_submit is False
        assert len(plan.blocking_rows) == 1

    def test_fully_empty_sector_cannot_be_submitted(self, db_session: Session) -> None:
        _loc(db_session, "P-QA-01")
        _loc(db_session, "P-QB-01")
        db_session.commit()

        plan = build_sector_transfer_plan(db_session, "P-QA", "P-QB")

        assert _statuses(plan) == {"P-QA-01": STATUS_EMPTY}
        assert plan.can_submit is False


class TestPreviewEndpoint:
    def test_preview_returns_rows_and_summary(
        self, client, db_session: Session, product: Product, as_admin
    ) -> None:
        src = _loc(db_session, "P-HA-01")
        _loc(db_session, "P-HB-01")
        _stock(db_session, product, src, qty="7")
        db_session.commit()

        resp = client.get(
            "/api/v1/inventory/movements/sector-transfer/preview",
            params={"from": "P-HA", "to": "P-HB"},
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["from_prefix"] == "P-HA"
        assert body["to_prefix"] == "P-HB"
        assert body["location_type"] == "FLOOR"
        assert body["can_submit"] is True
        assert body["locations_to_move"] == 1
        assert Decimal(str(body["total_qty_to_move"])) == Decimal("7")
        assert body["rows"][0]["status"] == STATUS_OK
        assert body["rows"][0]["movable"] is True

    def test_preview_reports_blockers_without_changing_anything(
        self, client, db_session: Session, product: Product, as_admin
    ) -> None:
        src = _loc(db_session, "P-IA-01")
        _loc(db_session, "P-IB-01")
        _stock(db_session, product, src, qty="10", reserved="3")
        db_session.commit()
        movements_before = db_session.query(StockMovement).count()

        resp = client.get(
            "/api/v1/inventory/movements/sector-transfer/preview",
            params={"from": "P-IA", "to": "P-IB"},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["can_submit"] is False
        assert resp.json()["rows"][0]["status"] == STATUS_RESERVED
        assert db_session.query(StockMovement).count() == movements_before

    def test_unknown_sector_returns_404(self, client, as_admin) -> None:
        resp = client.get(
            "/api/v1/inventory/movements/sector-transfer/preview",
            params={"from": "P-NOPE", "to": "P-ALSONOPE"},
        )
        assert resp.status_code == 404
