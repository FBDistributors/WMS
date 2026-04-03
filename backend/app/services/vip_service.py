"""VIP customers: min_expiry_months for allocation (default + per-brand)."""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.models.vip_customer import VipCustomer
from app.models.vip_customer_brand_limit import VipCustomerBrandLimit


def resolve_vip_min_expiry_months(
    db: Session,
    customer_id: str | None,
    brand_id: uuid.UUID | None,
) -> int:
    """
    VIP emas -> 0.
    VIP + brend uchun alohida qator bo'lsa -> shu oy.
    Aks holda -> vip_customers.min_expiry_months (standart).
    """
    if not customer_id or not str(customer_id).strip():
        return 0
    cid = str(customer_id).strip()
    vip = db.query(VipCustomer).filter(VipCustomer.customer_id == cid).one_or_none()
    if not vip:
        return 0
    if brand_id is not None:
        row = (
            db.query(VipCustomerBrandLimit)
            .filter(
                VipCustomerBrandLimit.vip_customer_id == vip.id,
                VipCustomerBrandLimit.brand_id == brand_id,
            )
            .one_or_none()
        )
        if row is not None:
            return row.min_expiry_months
    return vip.min_expiry_months


def get_vip_customer_expiry_months(db: Session) -> dict[str, int]:
    """Eski API: customer_id -> min_expiry_months (faqat jadvaldagi standart qiymat)."""
    rows = db.query(VipCustomer.customer_id, VipCustomer.min_expiry_months).all()
    return {r.customer_id: r.min_expiry_months for r in rows}
