"""Bitta tashkiliy harakat buyurtmasining tashkilotini (org_id) qo'lda to'g'irlaydi.

YOZADI (UPDATE) — order.to_filial_code va order.filial_id ni beriladigan org_id ga
o'rnatadi. org_id settings_organizations da mavjud bo'lishi shart (aks holda rad etadi).

Nega kerak: eski fuzzy-reconcile ba'zi order'larning to_filial_code'sini noto'g'ri
tashkilotga almashtirib qo'ygan (masalan Бухара -> Хорезм). Qayta sinxron buni
avtomatik tiklaydi; Smartup ishlamasa, shu skript bilan qo'lda to'g'irlanadi.

Ishga tushirish (VPS):
  set -a && source /etc/wms/api.env && set +a
  cd /var/www/wms/backend
  # Avval to'g'ri org_id ni bilib oling (Sozlamalar -> Organizatsiya jadvalidan):
  .venv/bin/python -m scripts.fix_order_filial 101667 12398877
"""
from __future__ import annotations

import sys

from app.db import SessionLocal
from app.models.order import Order
from app.models.settings_organization import SettingsOrganization


def main() -> int:
    if len(sys.argv) < 3:
        print("Foydalanish: python -m scripts.fix_order_filial <order_number> <org_id>")
        return 2
    order_number = sys.argv[1].strip()
    org_id = sys.argv[2].strip()

    db = SessionLocal()
    try:
        org = (
            db.query(SettingsOrganization)
            .filter(SettingsOrganization.org_id == org_id)
            .one_or_none()
        )
        if org is None:
            print(f"[RAD] org_id={org_id} settings_organizations da topilmadi. "
                  "Avval Sozlamalar -> Organizatsiya ga qo'shing.")
            return 1

        orders = db.query(Order).filter(Order.order_number == order_number).all()
        if not orders:
            print(f"[TOPILMADI] order_number={order_number} bo'yicha buyurtma yo'q")
            return 1

        for o in orders:
            before = (o.to_filial_code, o.filial_id)
            o.to_filial_code = org_id
            o.filial_id = org_id
            print(f"Order {o.order_number} (id={o.id}): {before} -> ('{org_id}','{org_id}') "
                  f"= {org.name!r}")
        db.commit()
        print(f"Yangilandi: {len(orders)} ta order -> {org.name} (org_id={org_id})")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
