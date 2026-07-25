"""Joy ko'chirish servisining umumiy qismi.

Bitta joy (palet) va sektor ko'chirish shu servisni baham ko'radi, shuning uchun
uning yordamchilariga alohida test kerak — ayniqsa rezerv aniqlashga.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.models.location import Location
from app.models.product import Product
from app.models.stock import StockLot, StockMovement
from app.services.location_transfer_service import (
    LocationTransferResult,
    reserved_by_location,
)


@pytest.fixture
def loc(db_session: Session) -> Location:
    location = Location(
        code=f"RSV-{uuid.uuid4().hex[:6]}",
        barcode_value=f"RSV-{uuid.uuid4().hex[:8]}",
        name="Reserve test bin",
        type="bin",
        is_active=True,
    )
    db_session.add(location)
    db_session.flush()
    return location


@pytest.fixture
def product(db_session: Session) -> Product:
    p = Product(
        external_source="test",
        external_id=f"rsv-{uuid.uuid4().hex[:8]}",
        name="Reserve test product",
        sku=f"SKU-RSV-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db_session.add(p)
    db_session.flush()
    return p


def _seed(db: Session, product: Product, loc: Location, *, on_hand: str, reserved: str) -> StockLot:
    lot = StockLot(product_id=product.id, batch=f"B-{uuid.uuid4().hex[:6]}", expiry_date=None)
    db.add(lot)
    db.flush()
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            qty_change=Decimal(on_hand),
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
    db.commit()
    return lot


class TestReservedByLocation:
    def test_partially_reserved_location_is_reported(
        self, db_session: Session, product: Product, loc: Location
    ) -> None:
        _seed(db_session, product, loc, on_hand="30", reserved="5")

        assert reserved_by_location(db_session, [loc.id]) == {loc.id: Decimal("5")}

    def test_fully_reserved_location_is_reported(
        self, db_session: Session, product: Product, loc: Location
    ) -> None:
        """on_hand == reserved bo'lsa available == 0.

        Balans yordamchisi bunday qatorni `available != 0` sharti tufayli umuman
        qaytarmaydi — shuning uchun rezerv alohida so'rov bilan sanaladi. Aks holda
        to'liq band joy "bo'sh" deb sektor bilan birga ko'chib ketardi.
        """
        _seed(db_session, product, loc, on_hand="12", reserved="12")

        assert reserved_by_location(db_session, [loc.id]) == {loc.id: Decimal("12")}

    def test_location_without_reserve_is_absent(
        self, db_session: Session, product: Product, loc: Location
    ) -> None:
        _seed(db_session, product, loc, on_hand="10", reserved="0")

        assert reserved_by_location(db_session, [loc.id]) == {}

    def test_released_reserve_is_not_counted(
        self, db_session: Session, product: Product, loc: Location
    ) -> None:
        lot = _seed(db_session, product, loc, on_hand="10", reserved="4")
        db_session.add(
            StockMovement(
                product_id=product.id,
                lot_id=lot.id,
                location_id=loc.id,
                qty_change=Decimal("-4"),
                movement_type="unallocate",
            )
        )
        db_session.commit()

        assert reserved_by_location(db_session, [loc.id]) == {}

    def test_reserve_is_summed_per_location_across_lots(
        self, db_session: Session, product: Product, loc: Location
    ) -> None:
        _seed(db_session, product, loc, on_hand="10", reserved="3")
        _seed(db_session, product, loc, on_hand="10", reserved="7")

        assert reserved_by_location(db_session, [loc.id]) == {loc.id: Decimal("10")}

    def test_empty_input_does_not_query(self, db_session: Session) -> None:
        assert reserved_by_location(db_session, []) == {}


class TestLocationTransferResult:
    def test_merge_accumulates_counts_and_pairs(self) -> None:
        lot_a, lot_b = uuid.uuid4(), uuid.uuid4()
        loc_a, loc_b = uuid.uuid4(), uuid.uuid4()

        total = LocationTransferResult(
            lines_transferred=1,
            movements_created=2,
            boxes_transferred=1,
            balance_pairs={(lot_a, loc_a)},
            invariant_pairs={(lot_a, loc_a)},
        )
        total.merge(
            LocationTransferResult(
                lines_transferred=2,
                movements_created=4,
                lines_requested=2,
                balance_pairs={(lot_b, loc_b)},
                invariant_pairs={(lot_a, loc_a), (lot_b, loc_b)},
            )
        )

        assert total.lines_transferred == 3
        assert total.movements_created == 6
        assert total.lines_requested == 2
        assert total.boxes_transferred == 1
        assert total.balance_pairs == {(lot_a, loc_a), (lot_b, loc_b)}
        # Takrorlangan juftlik ikki marta tekshirilmasin.
        assert total.invariant_pairs == {(lot_a, loc_a), (lot_b, loc_b)}
