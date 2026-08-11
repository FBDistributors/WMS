"""Ish haqi tariflarini o'qish — bir joydan, standart qiymatlar bilan.

Hisob serverda: tarif o'zgarsa hamma darrov bir xil raqamni ko'radi, eski
ilova versiyasidagi xodim boshqacha summa ko'rib qolmaydi.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.payroll_rate import PayrollRate
from app.services.order_source_group import SOURCE_GROUP_CITY, SOURCE_GROUP_REGION

#: Jadval bo'sh bo'lsa (migratsiyagacha yoki qator o'chirilgan) ishlatiladi.
DEFAULT_RATES: dict[tuple[str, str], Decimal] = {
    ("picker", SOURCE_GROUP_CITY): Decimal("463"),
    ("picker", SOURCE_GROUP_REGION): Decimal("1389"),
    ("controller", SOURCE_GROUP_CITY): Decimal("278"),
    ("controller", SOURCE_GROUP_REGION): Decimal("834"),
}


def payroll_role_for(user_role: str) -> str:
    """Foydalanuvchi roli -> tarif roli."""
    return "controller" if (user_role or "") == "inventory_controller" else "picker"


def load_rates(db: Session, role: str) -> dict[str, Decimal]:
    """`{'shahar': ..., 'region': ...}` — berilgan tarif roli uchun."""
    rows = db.query(PayrollRate).filter(PayrollRate.role == role).all()
    out = {
        group: DEFAULT_RATES.get((role, group), Decimal("0"))
        for group in (SOURCE_GROUP_CITY, SOURCE_GROUP_REGION)
    }
    for row in rows:
        if row.source_group in out:
            out[row.source_group] = Decimal(str(row.amount))
    return out
