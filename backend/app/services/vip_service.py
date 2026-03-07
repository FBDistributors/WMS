"""VIP customers: get customer_id -> min_expiry_months for allocation rules."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.vip_customer import VipCustomer


def get_vip_customer_expiry_months(db: Session) -> dict[str, int]:
    """Return mapping customer_id -> min_expiry_months for all VIP customers."""
    rows = db.query(VipCustomer.customer_id, VipCustomer.min_expiry_months).all()
    return {r.customer_id: r.min_expiry_months for r in rows}
