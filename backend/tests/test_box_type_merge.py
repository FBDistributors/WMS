"""Noto'g'ri shtrix-kod bilan qayd etilgan qutilarni to'g'ri turga o'tkazish.

Bu tuzatish amali: joylashuvning quti turi almashadi, fizik qoldiq tegilmaydi.
Shuning uchun asosiy tekshiruvlar — qoldiq o'zgarmasligi va qutidagi dona soni
farq qilganda amal rad etilishi.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.location import Location as LocationModel
from app.models.location_box_placement import PLACEMENT_SEALED, LocationBoxPlacement
from app.models.product import Product as ProductModel
from app.models.product_box import ProductBox as ProductBoxModel
from app.models.stock import StockLot, StockMovement
from app.models.user import User as UserModel
from app.services.box_location_service import (
    get_breakdown_tolerant,
    merge_box_type_at_location,
    open_sealed_boxes_for_pick,
    place_sealed_boxes,
    remove_sealed_boxes_for_pick,
)
from app.services.stock_availability import compute_lot_location_balances


@pytest.fixture()
def inv_user(db_session: Session) -> UserModel:
    u = UserModel(
        username=f"merge-{uuid.uuid4().hex[:8]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db_session.add(u)
    db_session.flush()
    return u


@pytest.fixture()
def product(db_session: Session) -> ProductModel:
    p = ProductModel(
        external_source="test",
        external_id=f"ext-{uuid.uuid4()}",
        name="Merge product",
        sku=f"SKU-MG-{uuid.uuid4().hex[:8]}",
        is_active=True,
    )
    db_session.add(p)
    db_session.flush()
    return p


@pytest.fixture()
def location(db_session: Session) -> LocationModel:
    loc = LocationModel(
        code=f"MG-{uuid.uuid4().hex[:6]}",
        barcode_value=f"MG-{uuid.uuid4().hex[:6]}",
        name="Merge bin",
        type="bin",
        is_active=True,
    )
    db_session.add(loc)
    db_session.flush()
    return loc


def _box(db: Session, product: ProductModel, barcode: str, upb: int) -> ProductBoxModel:
    box = ProductBoxModel(
        box_barcode=barcode,
        product_id=product.id,
        units_per_box=upb,
        is_active=True,
    )
    db.add(box)
    db.flush()
    return box


def _stock(db: Session, product: ProductModel, loc: LocationModel, qty: int) -> StockLot:
    lot = StockLot(product_id=product.id, batch="MG", expiry_date=None)
    db.add(lot)
    db.flush()
    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            qty_change=Decimal(str(qty)),
            movement_type="receipt",
        )
    )
    db.flush()
    return lot


def _sealed_count(db: Session, box: ProductBoxModel) -> int:
    return (
        db.query(LocationBoxPlacement)
        .filter(
            LocationBoxPlacement.product_box_id == box.id,
            LocationBoxPlacement.status == PLACEMENT_SEALED,
        )
        .count()
    )


def _on_hand(db: Session, lot: StockLot, loc: LocationModel) -> Decimal:
    on_hand, _r, _a = compute_lot_location_balances(db, lot.id, loc.id)
    return Decimal(str(on_hand))


class TestMergeHappyPath:
    def test_wrong_boxes_move_to_the_right_type(
        self,
        db_session: Session,
        inv_user: UserModel,
        product: ProductModel,
        location: LocationModel,
    ) -> None:
        """Ekrandagi holat: 12 quti to'g'ri kodda, 1 tasi noto'g'ri."""
        right = _box(db_session, product, "RIGHT-1", 6)
        wrong = _box(db_session, product, "WRONG-1", 6)
        lot = _stock(db_session, product, location, 79)
        place_sealed_boxes(
            db_session,
            box_barcode="RIGHT-1",
            location_id=location.id,
            lot_id=lot.id,
            user=inv_user,
            box_count=12,
        )
        place_sealed_boxes(
            db_session,
            box_barcode="WRONG-1",
            location_id=location.id,
            lot_id=lot.id,
            user=inv_user,
            box_count=1,
        )
        db_session.flush()
        on_hand_before = _on_hand(db_session, lot, location)

        result = merge_box_type_at_location(
            db_session,
            from_box_barcode="WRONG-1",
            to_box_barcode="RIGHT-1",
            location_id=location.id,
            lot_id=lot.id,
        )

        assert result.moved == 1
        assert result.remaining_elsewhere == 0
        assert _sealed_count(db_session, wrong) == 0
        assert _sealed_count(db_session, right) == 13
        # Qayta yorliqlash: fizik qoldiq va qutidagi dona jami o'zgarmaydi.
        assert _on_hand(db_session, lot, location) == on_hand_before
        assert result.breakdown.units_in_boxes == 78
        assert result.breakdown.box_count == 13

    def test_all_boxes_of_the_wrong_type_move_at_once(
        self,
        db_session: Session,
        inv_user: UserModel,
        product: ProductModel,
        location: LocationModel,
    ) -> None:
        _box(db_session, product, "RIGHT-2", 6)
        _box(db_session, product, "WRONG-2", 6)
        lot = _stock(db_session, product, location, 60)
        place_sealed_boxes(
            db_session,
            box_barcode="WRONG-2",
            location_id=location.id,
            lot_id=lot.id,
            user=inv_user,
            box_count=4,
        )
        db_session.flush()

        result = merge_box_type_at_location(
            db_session,
            from_box_barcode="WRONG-2",
            to_box_barcode="RIGHT-2",
            location_id=location.id,
            lot_id=lot.id,
        )

        assert result.moved == 4
        assert result.breakdown.box_count == 4

    def test_boxes_elsewhere_are_reported_and_left_alone(
        self,
        db_session: Session,
        inv_user: UserModel,
        product: ProductModel,
        location: LocationModel,
    ) -> None:
        """Amal faqat berilgan joyni tuzatadi; qolgani hisobotda ko'rinadi."""
        other = LocationModel(
            code=f"MG2-{uuid.uuid4().hex[:6]}",
            barcode_value=f"MG2-{uuid.uuid4().hex[:6]}",
            name="Other bin",
            type="bin",
            is_active=True,
        )
        db_session.add(other)
        db_session.flush()
        _box(db_session, product, "RIGHT-3", 6)
        wrong = _box(db_session, product, "WRONG-3", 6)
        lot_here = _stock(db_session, product, location, 30)
        lot_there = _stock(db_session, product, other, 30)
        place_sealed_boxes(
            db_session,
            box_barcode="WRONG-3",
            location_id=location.id,
            lot_id=lot_here.id,
            user=inv_user,
            box_count=2,
        )
        place_sealed_boxes(
            db_session,
            box_barcode="WRONG-3",
            location_id=other.id,
            lot_id=lot_there.id,
            user=inv_user,
            box_count=3,
        )
        db_session.flush()

        result = merge_box_type_at_location(
            db_session,
            from_box_barcode="WRONG-3",
            to_box_barcode="RIGHT-3",
            location_id=location.id,
            lot_id=lot_here.id,
        )

        assert result.moved == 2
        assert result.remaining_elsewhere == 3
        assert _sealed_count(db_session, wrong) == 3


class TestMergeGuards:
    def test_different_box_size_is_rejected(
        self,
        db_session: Session,
        inv_user: UserModel,
        product: ProductModel,
        location: LocationModel,
    ) -> None:
        """Hajm farq qilsa qutidagi dona jimgina o'zgarib, invariantni buzardi."""
        _box(db_session, product, "RIGHT-4", 6)
        _box(db_session, product, "WRONG-4", 12)
        lot = _stock(db_session, product, location, 60)
        place_sealed_boxes(
            db_session,
            box_barcode="WRONG-4",
            location_id=location.id,
            lot_id=lot.id,
            user=inv_user,
            box_count=2,
        )
        db_session.flush()
        units_before = get_breakdown_tolerant(
            db_session, product_id=product.id, lot_id=lot.id, location_id=location.id
        ).units_in_boxes

        with pytest.raises(HTTPException) as err:
            merge_box_type_at_location(
                db_session,
                from_box_barcode="WRONG-4",
                to_box_barcode="RIGHT-4",
                location_id=location.id,
                lot_id=lot.id,
            )

        assert err.value.status_code == 400
        assert "dona soni farq qiladi" in str(err.value.detail)
        assert (
            get_breakdown_tolerant(
                db_session, product_id=product.id, lot_id=lot.id, location_id=location.id
            ).units_in_boxes
            == units_before
        )

    def test_different_product_is_rejected(
        self,
        db_session: Session,
        inv_user: UserModel,
        product: ProductModel,
        location: LocationModel,
    ) -> None:
        other_product = ProductModel(
            external_source="test",
            external_id=f"ext-{uuid.uuid4()}",
            name="Other product",
            sku=f"SKU-OT-{uuid.uuid4().hex[:8]}",
            is_active=True,
        )
        db_session.add(other_product)
        db_session.flush()
        _box(db_session, other_product, "RIGHT-5", 6)
        _box(db_session, product, "WRONG-5", 6)
        lot = _stock(db_session, product, location, 30)
        place_sealed_boxes(
            db_session,
            box_barcode="WRONG-5",
            location_id=location.id,
            lot_id=lot.id,
            user=inv_user,
            box_count=1,
        )
        db_session.flush()

        with pytest.raises(HTTPException) as err:
            merge_box_type_at_location(
                db_session,
                from_box_barcode="WRONG-5",
                to_box_barcode="RIGHT-5",
                location_id=location.id,
                lot_id=lot.id,
            )

        assert err.value.status_code == 400
        assert "mahsulotga" in str(err.value.detail)

    def test_same_box_type_is_rejected(
        self,
        db_session: Session,
        inv_user: UserModel,
        product: ProductModel,
        location: LocationModel,
    ) -> None:
        _box(db_session, product, "SAME-1", 6)
        lot = _stock(db_session, product, location, 30)
        place_sealed_boxes(
            db_session,
            box_barcode="SAME-1",
            location_id=location.id,
            lot_id=lot.id,
            user=inv_user,
            box_count=1,
        )
        db_session.flush()

        with pytest.raises(HTTPException) as err:
            merge_box_type_at_location(
                db_session,
                from_box_barcode="SAME-1",
                to_box_barcode="SAME-1",
                location_id=location.id,
                lot_id=lot.id,
            )

        assert err.value.status_code == 400

    def test_nothing_to_move_returns_404(
        self,
        db_session: Session,
        product: ProductModel,
        location: LocationModel,
    ) -> None:
        _box(db_session, product, "RIGHT-6", 6)
        _box(db_session, product, "WRONG-6", 6)
        lot = _stock(db_session, product, location, 30)
        db_session.flush()

        with pytest.raises(HTTPException) as err:
            merge_box_type_at_location(
                db_session,
                from_box_barcode="WRONG-6",
                to_box_barcode="RIGHT-6",
                location_id=location.id,
                lot_id=lot.id,
            )

        assert err.value.status_code == 404

    def test_unknown_barcode_returns_404(
        self,
        db_session: Session,
        product: ProductModel,
        location: LocationModel,
    ) -> None:
        _box(db_session, product, "RIGHT-7", 6)
        lot = _stock(db_session, product, location, 30)
        db_session.flush()

        with pytest.raises(HTTPException) as err:
            merge_box_type_at_location(
                db_session,
                from_box_barcode="NO-SUCH-BOX",
                to_box_barcode="RIGHT-7",
                location_id=location.id,
                lot_id=lot.id,
            )

        assert err.value.status_code == 404


class TestMergeEndpoint:
    def test_merge_endpoint_relabels_and_reports(
        self,
        client,
        db_session: Session,
        inv_user: UserModel,
        product: ProductModel,
        location: LocationModel,
    ) -> None:
        _box(db_session, product, "RIGHT-API", 6)
        _box(db_session, product, "WRONG-API", 6)
        lot = _stock(db_session, product, location, 79)
        place_sealed_boxes(
            db_session,
            box_barcode="RIGHT-API",
            location_id=location.id,
            lot_id=lot.id,
            user=inv_user,
            box_count=12,
        )
        place_sealed_boxes(
            db_session,
            box_barcode="WRONG-API",
            location_id=location.id,
            lot_id=lot.id,
            user=inv_user,
            box_count=1,
        )
        db_session.commit()

        app.dependency_overrides[get_current_user] = lambda: inv_user
        try:
            resp = client.post(
                "/api/v1/box-locations/merge-box-type",
                json={
                    "from_box_barcode": "WRONG-API",
                    "to_box_barcode": "RIGHT-API",
                    "location_id": str(location.id),
                    "lot_id": str(lot.id),
                },
            )
        finally:
            app.dependency_overrides.pop(get_current_user, None)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["moved"] == 1
        assert body["remaining_elsewhere"] == 0
        assert body["breakdown"]["box_count"] == 13
        assert body["breakdown"]["units_in_boxes"] == 78
        # Endi joyda bitta quti turi qoldi — sanoq to'siqsiz saqlanadi.
        assert {b["box_barcode"] for b in body["breakdown"]["sealed_boxes"]} == {"RIGHT-API"}

    def test_merge_endpoint_rejects_different_box_size(
        self,
        client,
        db_session: Session,
        inv_user: UserModel,
        product: ProductModel,
        location: LocationModel,
    ) -> None:
        _box(db_session, product, "RIGHT-API2", 6)
        _box(db_session, product, "WRONG-API2", 12)
        lot = _stock(db_session, product, location, 60)
        place_sealed_boxes(
            db_session,
            box_barcode="WRONG-API2",
            location_id=location.id,
            lot_id=lot.id,
            user=inv_user,
            box_count=2,
        )
        db_session.commit()

        app.dependency_overrides[get_current_user] = lambda: inv_user
        try:
            resp = client.post(
                "/api/v1/box-locations/merge-box-type",
                json={
                    "from_box_barcode": "WRONG-API2",
                    "to_box_barcode": "RIGHT-API2",
                    "location_id": str(location.id),
                    "lot_id": str(lot.id),
                },
            )
        finally:
            app.dependency_overrides.pop(get_current_user, None)

        assert resp.status_code == 400, resp.text
        assert "dona soni farq qiladi" in resp.json()["detail"]


class TestPickErrorNamesTheOtherBarcode:
    """Terishda "mavjud 0" xabari chalkash: ekranda qutilar ko'rinib turadi."""

    def test_whole_box_pick_names_the_other_barcode(
        self,
        db_session: Session,
        inv_user: UserModel,
        product: ProductModel,
        location: LocationModel,
    ) -> None:
        _box(db_session, product, "SCANNED-1", 6)
        _box(db_session, product, "RECORDED-1", 6)
        lot = _stock(db_session, product, location, 74)
        place_sealed_boxes(
            db_session,
            box_barcode="RECORDED-1",
            location_id=location.id,
            lot_id=lot.id,
            user=inv_user,
            box_count=7,
        )
        db_session.flush()

        with pytest.raises(HTTPException) as err:
            remove_sealed_boxes_for_pick(
                db_session,
                box_barcode="SCANNED-1",
                location_id=location.id,
                lot_id=lot.id,
                user=inv_user,
                box_count=2,
                pick_qty=Decimal("12"),
            )

        assert err.value.status_code == 409
        detail = str(err.value.detail)
        assert "boshqa shtrix-kod ostida yozilgan" in detail
        assert "RECORDED-1" in detail

    def test_opening_a_box_reports_the_same_way(
        self,
        db_session: Session,
        inv_user: UserModel,
        product: ProductModel,
        location: LocationModel,
    ) -> None:
        _box(db_session, product, "SCANNED-2", 6)
        _box(db_session, product, "RECORDED-2", 6)
        lot = _stock(db_session, product, location, 30)
        place_sealed_boxes(
            db_session,
            box_barcode="RECORDED-2",
            location_id=location.id,
            lot_id=lot.id,
            user=inv_user,
            box_count=3,
        )
        db_session.flush()

        with pytest.raises(HTTPException) as err:
            open_sealed_boxes_for_pick(
                db_session,
                box_barcode="SCANNED-2",
                location_id=location.id,
                lot_id=lot.id,
                user=inv_user,
                box_count=1,
            )

        assert "RECORDED-2" in str(err.value.detail)

    def test_an_empty_location_keeps_the_plain_shortage_message(
        self,
        db_session: Session,
        inv_user: UserModel,
        product: ProductModel,
        location: LocationModel,
    ) -> None:
        """Boshqa kod yo'q bo'lsa sabab boshqacha — xabar ham eskicha qolsin."""
        _box(db_session, product, "SCANNED-3", 6)
        lot = _stock(db_session, product, location, 12)
        db_session.flush()

        with pytest.raises(HTTPException) as err:
            remove_sealed_boxes_for_pick(
                db_session,
                box_barcode="SCANNED-3",
                location_id=location.id,
                lot_id=lot.id,
                user=inv_user,
                box_count=2,
                pick_qty=Decimal("12"),
            )

        detail = str(err.value.detail)
        assert "Sealed quti yetarli emas" in detail
        assert "boshqa shtrix-kod" not in detail

    def test_enough_boxes_of_the_scanned_code_still_pick(
        self,
        db_session: Session,
        inv_user: UserModel,
        product: ProductModel,
        location: LocationModel,
    ) -> None:
        """Aralash joyda ham skanerlangan kodda yetarli quti bo'lsa terish o'tadi."""
        _box(db_session, product, "SCANNED-4", 6)
        _box(db_session, product, "OTHER-4", 6)
        lot = _stock(db_session, product, location, 60)
        place_sealed_boxes(
            db_session,
            box_barcode="SCANNED-4",
            location_id=location.id,
            lot_id=lot.id,
            user=inv_user,
            box_count=3,
        )
        place_sealed_boxes(
            db_session,
            box_barcode="OTHER-4",
            location_id=location.id,
            lot_id=lot.id,
            user=inv_user,
            box_count=2,
        )
        db_session.flush()

        remove_sealed_boxes_for_pick(
            db_session,
            box_barcode="SCANNED-4",
            location_id=location.id,
            lot_id=lot.id,
            user=inv_user,
            box_count=2,
            pick_qty=Decimal("12"),
        )

        assert _sealed_count(db_session, _box_by_code(db_session, "SCANNED-4")) == 1
        assert _sealed_count(db_session, _box_by_code(db_session, "OTHER-4")) == 2


def _box_by_code(db: Session, barcode: str) -> ProductBoxModel:
    return (
        db.query(ProductBoxModel)
        .filter(ProductBoxModel.box_barcode == barcode)
        .one()
    )
