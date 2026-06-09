"""VIP customers: brend va mahsulot bo'yicha min_expiry_months (ajratish)."""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.models.vip_customer import VipCustomer
from app.models.vip_customer_brand_limit import VipCustomerBrandLimit
from app.models.vip_customer_product_limit import VipCustomerProductLimit


def resolve_vip_min_expiry_months(
    db: Session,
    customer_id: str | None,
    brand_id: uuid.UUID | None,
    product_id: uuid.UUID | None = None,
) -> int:
    """
    VIP emas yoki brend yo'q yoki limit qatori yo'q -> 0.
    VIP + brend uchun qator bo'lsa -> mahsulot limiti mavjud bo'lsa shu oy, aks holda brend oyi.
    """
    if not customer_id or not str(customer_id).strip():
        return 0
    cid = str(customer_id).strip()
    vip = db.query(VipCustomer).filter(VipCustomer.customer_id == cid).one_or_none()
    if not vip:
        return 0
    if brand_id is None:
        return 0
    if product_id is not None:
        pl = (
            db.query(VipCustomerProductLimit)
            .filter(
                VipCustomerProductLimit.vip_customer_id == vip.id,
                VipCustomerProductLimit.product_id == product_id,
            )
            .one_or_none()
        )
        if pl is not None:
            return pl.min_expiry_months
    row = (
        db.query(VipCustomerBrandLimit)
        .filter(
            VipCustomerBrandLimit.vip_customer_id == vip.id,
            VipCustomerBrandLimit.brand_id == brand_id,
        )
        .one_or_none()
    )
    if row is None:
        return 0
    return row.min_expiry_months
