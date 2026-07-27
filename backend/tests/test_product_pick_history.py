"""Mahsulot terish tarixi: har qatorda mijoz nomi ko'rinishi.

Tashkiliy harakatda (MFM/diller) mijoz maydoni bo'sh bo'ladi — terish ro'yxatidagi
kabi manzil tashkiloti nomi ko'rsatiladi.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.api.v1.endpoints.products import _order_customer_name
from app.auth.deps import get_current_user
from app.auth.security import get_password_hash
from app.main import app
from app.models.document import Document
from app.models.location import Location
from app.models.order import Order, OrderWmsState
from app.models.product import Product
from app.models.settings_organization import SettingsOrganization
from app.models.stock import StockLot, StockMovement
from app.models.user import User


@pytest.fixture
def admin_user(db_session: Session) -> User:
    u = User(
        username=f"hist_admin_{uuid.uuid4().hex[:6]}",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        full_name="Hist Admin",
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
        external_id=f"hist-{uuid.uuid4().hex[:8]}",
        name="History product",
        sku=f"SKU-HIST-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db_session.add(p)
    db_session.flush()
    return p


def _seed_pick(
    db: Session,
    product: Product,
    user: User,
    *,
    customer_name: str | None = None,
    filial_id: str | None = None,
    order_source: str = "smartup",
) -> None:
    loc = Location(
        code=f"H-{uuid.uuid4().hex[:6]}",
        barcode_value=f"H-{uuid.uuid4().hex[:8]}",
        name="Hist bin",
        type="bin",
        is_active=True,
    )
    lot = StockLot(product_id=product.id, batch="HB", expiry_date=None)
    order = Order(
        source=order_source,
        source_external_id=f"hist-ord-{uuid.uuid4().hex[:10]}",
        order_number=f"SO-H-{uuid.uuid4().hex[:6]}",
        customer_name=customer_name,
        filial_id=filial_id,
    )
    order.wms_state = OrderWmsState(status="picked")
    db.add_all([loc, lot, order])
    db.flush()

    doc = Document(
        doc_no=f"SO-{uuid.uuid4().hex[:8]}",
        doc_type="SO",
        status="picked",
        order_id=order.id,
    )
    db.add(doc)
    db.flush()

    db.add(
        StockMovement(
            product_id=product.id,
            lot_id=lot.id,
            location_id=loc.id,
            qty_change=Decimal("-5"),
            movement_type="pick",
            source_document_type="document",
            source_document_id=doc.id,
            created_by_user_id=user.id,
        )
    )
    db.commit()


class TestOrderCustomerName:
    def test_customer_name_is_used_when_present(self) -> None:
        class _Order:
            customer_name = "  Anvar Savdo  "
            filial_id = None
            to_filial_code = None
            movement_note = None

        assert _order_customer_name(_Order(), {}) == "Anvar Savdo"

    def test_movement_order_falls_back_to_organization(self) -> None:
        """Tashkilot ID kamida 7 xonali bo'ladi — qisqa kod ombor kodi hisoblanadi."""
        class _Order:
            customer_name = None
            filial_id = "5001234"
            to_filial_code = None
            movement_note = "Yunusobod omboriga"

        assert _order_customer_name(_Order(), {"5001234": "Yunusobod ombori"}) == "Yunusobod ombori"

    def test_unknown_organization_stays_empty_instead_of_guessing(self) -> None:
        """Izohdan taxmin qilinmaydi — noto'g'ri tashkilot ko'rsatilgandan bo'sh yaxshi."""

        class _Order:
            customer_name = None
            filial_id = "9999999"
            to_filial_code = None
            movement_note = "Yunusobod omboriga"

        assert _order_customer_name(_Order(), {"5001234": "Yunusobod ombori"}) is None

    def test_blank_customer_name_is_treated_as_missing(self) -> None:
        class _Order:
            customer_name = "   "
            filial_id = "5001234"
            to_filial_code = None
            movement_note = None

        assert _order_customer_name(_Order(), {"5001234": "Yunusobod ombori"}) == "Yunusobod ombori"


class TestPickHistoryEndpoint:
    def test_pick_row_carries_the_customer_name(
        self, client, db_session: Session, product: Product, admin_user: User, as_admin
    ) -> None:
        _seed_pick(db_session, product, admin_user, customer_name="Anvar Savdo")

        resp = client.get(f"/api/v1/products/{product.id}/history")

        assert resp.status_code == 200, resp.text
        picks = resp.json()["picks"]
        assert len(picks) == 1
        assert picks[0]["customer_name"] == "Anvar Savdo"
        assert picks[0]["qty"] == 5

    def test_movement_order_shows_the_destination_organization(
        self, client, db_session: Session, product: Product, admin_user: User, as_admin
    ) -> None:
        db_session.add(SettingsOrganization(org_id="5001234", name="Yunusobod ombori"))
        db_session.flush()
        _seed_pick(
            db_session,
            product,
            admin_user,
            customer_name=None,
            filial_id="5001234",
            order_source="diller",
        )

        resp = client.get(f"/api/v1/products/{product.id}/history")

        assert resp.status_code == 200, resp.text
        assert resp.json()["picks"][0]["customer_name"] == "Yunusobod ombori"

    def test_missing_customer_is_null_not_an_error(
        self, client, db_session: Session, product: Product, admin_user: User, as_admin
    ) -> None:
        _seed_pick(db_session, product, admin_user, customer_name=None)

        resp = client.get(f"/api/v1/products/{product.id}/history")

        assert resp.status_code == 200, resp.text
        assert resp.json()["picks"][0]["customer_name"] is None
