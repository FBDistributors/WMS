"""VIP muddat: brend va mahsulot limitlari."""
from __future__ import annotations

import uuid

from app.models.brand import Brand
from app.models.product import Product
from app.models.vip_customer import VipCustomer
from app.models.vip_customer_brand_limit import VipCustomerBrandLimit
from app.models.vip_customer_product_limit import VipCustomerProductLimit
from app.services.vip_service import resolve_vip_min_expiry_months


def test_resolve_no_vip(db_session):
    assert resolve_vip_min_expiry_months(db_session, "x", uuid.uuid4()) == 0


def test_resolve_vip_no_brand_id(db_session):
    vip = VipCustomer(customer_id="c1", customer_name="A")
    db_session.add(vip)
    db_session.commit()
    assert resolve_vip_min_expiry_months(db_session, "c1", None) == 0


def test_resolve_vip_with_brand_limit(db_session):
    b = Brand(code="BR01", name="Brand 1", is_active=True)
    db_session.add(b)
    db_session.flush()
    vip = VipCustomer(customer_id="c2", customer_name="B")
    db_session.add(vip)
    db_session.flush()
    db_session.add(
        VipCustomerBrandLimit(vip_customer_id=vip.id, brand_id=b.id, min_expiry_months=12),
    )
    db_session.commit()
    assert resolve_vip_min_expiry_months(db_session, "c2", b.id) == 12


def test_resolve_vip_missing_brand_row(db_session):
    b = Brand(code="BR02", name="Brand 2", is_active=True)
    db_session.add(b)
    db_session.flush()
    vip = VipCustomer(customer_id="c3", customer_name="C")
    db_session.add(vip)
    db_session.commit()
    assert resolve_vip_min_expiry_months(db_session, "c3", b.id) == 0


def test_resolve_vip_product_override(db_session):
    b = Brand(code="BR03", name="Brand 3", is_active=True)
    db_session.add(b)
    db_session.flush()
    product = Product(
        external_source="test",
        external_id=f"ext-{uuid.uuid4().hex[:8]}",
        name="Prod A",
        sku=f"SKU-{uuid.uuid4().hex[:6]}",
        brand_id=b.id,
        is_active=True,
    )
    db_session.add(product)
    db_session.flush()
    vip = VipCustomer(customer_id="c4", customer_name="D")
    db_session.add(vip)
    db_session.flush()
    db_session.add(
        VipCustomerBrandLimit(vip_customer_id=vip.id, brand_id=b.id, min_expiry_months=19),
    )
    db_session.add(
        VipCustomerProductLimit(
            vip_customer_id=vip.id,
            product_id=product.id,
            min_expiry_months=24,
        ),
    )
    db_session.commit()
    assert resolve_vip_min_expiry_months(db_session, "c4", b.id, product.id) == 24
    assert resolve_vip_min_expiry_months(db_session, "c4", b.id) == 19


def test_resolve_vip_product_override_falls_back_without_row(db_session):
    b = Brand(code="BR04", name="Brand 4", is_active=True)
    db_session.add(b)
    db_session.flush()
    product = Product(
        external_source="test",
        external_id=f"ext-{uuid.uuid4().hex[:8]}",
        name="Prod B",
        sku=f"SKU-{uuid.uuid4().hex[:6]}",
        brand_id=b.id,
        is_active=True,
    )
    db_session.add(product)
    db_session.flush()
    vip = VipCustomer(customer_id="c5", customer_name="E")
    db_session.add(vip)
    db_session.flush()
    db_session.add(
        VipCustomerBrandLimit(vip_customer_id=vip.id, brand_id=b.id, min_expiry_months=15),
    )
    db_session.commit()
    assert resolve_vip_min_expiry_months(db_session, "c5", b.id, product.id) == 15
