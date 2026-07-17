"""Tashkiliy harakat buyurtmasida "mijoz"/tashkilot nomi qanday aniqlanishini diagnostika qiladi.

FAQAT O'QIYDI (SELECT) — hech narsa o'zgartirmaydi.

Nega kerak: harakat buyurtmasida noto'g'ri tashkilot ko'rinsa, sabab odatda
order'ning `to_filial_code`/`filial_id` maydoniga (import paytidagi) eski/noto'g'ri
org_id saqlanib qolgani. Bu skript har bir resolve yo'li nima qaytarayotganini
ko'rsatadi: to'g'ridan-to'g'ri org_id moslik va izoh (movement_note) fuzzy-matchi.

Ishga tushirish (VPS):
  set -a && source /etc/wms/api.env && set +a
  /var/www/wms/backend/.venv/bin/python -m scripts.check_movement_org 101667
"""
from __future__ import annotations

import sys

from app.db import SessionLocal
from app.models.order import Order
from app.services.organization_labels import (
    _best_org_match_from_note,
    _match_tokens_from_org_name,
    _note_contains_token,
    _normalize_note_text,
    load_org_name_map,
    resolve_org_display,
)


def main() -> int:
    order_number = (sys.argv[1] if len(sys.argv) > 1 else "101667").strip()
    db = SessionLocal()
    try:
        orders = db.query(Order).filter(Order.order_number == order_number).all()
        if not orders:
            print(f"[TOPILMADI] order_number={order_number} bo'yicha buyurtma yo'q")
            return 0
        name_map = load_org_name_map(db)
        print(f"settings_organizations: {len(name_map)} ta tashkilot yuklandi\n")

        for o in orders:
            print(f"=== Order {o.order_number} (source={o.source}, id={o.id}) ===")
            print(f"  filial_id          = {o.filial_id!r}")
            print(f"  to_filial_code     = {getattr(o, 'to_filial_code', None)!r}")
            print(f"  from_warehouse_code= {getattr(o, 'from_warehouse_code', None)!r}")
            print(f"  to_warehouse_code  = {getattr(o, 'to_warehouse_code', None)!r}")
            print(f"  customer_name      = {o.customer_name!r}")
            print(f"  movement_note      = {getattr(o, 'movement_note', None)!r}")

            # 1) To'g'ridan-to'g'ri org_id moslik (aynan shu qiymat settingsda bormi).
            for label, key in (("filial_id", o.filial_id),
                               ("to_filial_code", getattr(o, "to_filial_code", None))):
                k = (key or "").strip()
                if k:
                    hit = name_map.get(k)
                    print(f"  [org_id moslik] {label}={k} -> {hit!r}")

            # 2) Izoh fuzzy-matchi (Бухара endi qo'shilgani uchun nima chiqadi).
            best_id, best_name = _best_org_match_from_note(
                getattr(o, "movement_note", None), name_map
            )
            print(f"  [izoh fuzzy-match] -> org_id={best_id!r}, name={best_name!r}")

            # 3) Umumiy resolve (admin ro'yxatida ishlatiladigan).
            display = resolve_org_display(
                o.filial_id,
                name_map,
                to_filial_code=getattr(o, "to_filial_code", None),
                movement_note=getattr(o, "movement_note", None),
            )
            print(f"  [resolve_org_display] -> {display!r}   <-- HOZIR KO'RINAYOTGAN NOM")

            # 4) Izohga mos keladigan BARCHA tashkilotlar (raqobat: Хорезм vs Бухара).
            note_text = _normalize_note_text(getattr(o, "movement_note", None))
            matches = []
            for org_id, name in name_map.items():
                for token in _match_tokens_from_org_name(name):
                    if _note_contains_token(note_text, token):
                        matches.append((org_id, name, token))
                        break
            if matches:
                print("  [izohga mos barcha tashkilotlar]:")
                for org_id, name, token in matches:
                    print(f"      - {name} (org_id={org_id}, token='{token}')")
            else:
                print("  [izohga mos tashkilot topilmadi]")
            print()
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
