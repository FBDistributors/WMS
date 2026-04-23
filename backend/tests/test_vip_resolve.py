"""VIP muddat: faqat brend limitlari."""
from __future__ import annotations

import uuid

from app.models.brand import Brand
from app.models.vip_customer import VipCustomer
from app.models.vip_customer_brand_limit import VipCustomerBrandLimit
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
