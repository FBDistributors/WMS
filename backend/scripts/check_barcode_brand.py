"""Bitta shtrix-kod bo'yicha mahsulot brendini diagnostika qiladi.

FAQAT O'QIYDI (SELECT) — hech narsa o'zgartirmaydi.

Nega kerak: ilovada mahsulot brendi ko'rinmasa, sabab odatda ma'lumotda —
mahsulotga brend biriktirilmagan. Brend Smartup `groups` ichidagi
group_id=31426 dan olinadi va `brands` jadvalidagi `code` ga moslanadi
(qarang: app/integrations/smartup/products_sync.py). Bu skript shu
zanjirning qaysi bo'g'ini uzilganini ko'rsatadi.

Ishga tushirish (VPS):
  set -a && source /etc/wms/api.env && set +a
  /var/www/wms/backend/.venv/bin/python -m scripts.check_barcode_brand 4605922033578

Lokalda (DATABASE_URL to'g'ri bo'lsa):
  python -m scripts.check_barcode_brand 4605922033578
"""
from __future__ import annotations

import sys

from app.db import SessionLocal
from app.integrations.smartup.products_sync import _extract_brand_code
from app.models.brand import Brand
from app.models.product import Product, ProductBarcode


def _find_product(db, barcode: str) -> Product | None:
    # Avval asosiy barcode, keyin qo'shimcha barcode'lar jadvali.
    p = db.query(Product).filter(Product.barcode == barcode).first()
    if p:
        return p
    pb = db.query(ProductBarcode).filter(ProductBarcode.barcode == barcode).first()
    return pb.product if pb else None


def main() -> int:
    barcode = (sys.argv[1] if len(sys.argv) > 1 else "4605922033578").strip()
    db = SessionLocal()
    try:
        p = _find_product(db, barcode)
        if p is None:
            print(f"[TOPILMADI] Bu shtrix-kodli mahsulot yo'q: {barcode}")
            print("  -> Smartup sinxroni bu mahsulotni hali import qilmagan bo'lishi mumkin.")
            return 0

        all_barcodes = [b.barcode for b in p.barcodes]
        print(f"Mahsulot: {p.name}")
        print(f"  id            = {p.id}")
        print(f"  sku           = {p.sku}")
        print(f"  is_active     = {p.is_active}")
        print(f"  asosiy barcode= {p.barcode}")
        print(f"  barcodes[]    = {all_barcodes}")
        print(f"  brand (str)   = {p.brand!r}")
        print(f"  brand_id      = {p.brand_id}")
        print(f"  brand_code    = {p.brand_code!r}")
        brand_ref = getattr(p, "brand_ref", None)
        print(f"  brand_ref     = {brand_ref.name if brand_ref else None!r}")

        # Smartup groups'dan brend kodini qayta hisoblaymiz.
        groups = p.smartup_groups or (p.raw_payload or {}).get("groups")
        g31426 = None
        if isinstance(groups, list):
            for g in groups:
                if isinstance(g, dict) and str(g.get("group_id") or g.get("id")) == "31426":
                    g31426 = g
                    break
        computed = _extract_brand_code(groups if isinstance(groups, list) else None)
        print()
        print(f"  Smartup group 31426 = {g31426}")
        print(f"  Hisoblangan brand_code = {computed!r}")

        # Xulosa.
        print()
        if not p.is_active:
            print("VERDIKT: Mahsulot NOFAOL (is_active=false) -> sinxron brendni ataylab tozalaydi.")
        elif computed is None:
            print("VERDIKT: Smartup'da 31426 (brend) guruhi yo'q -> brend biriktirilmagan.")
            print("  Tuzatish: Smartup'da shu mahsulotga brend guruhini belgilang, keyin sinxron.")
        else:
            brand = db.query(Brand).filter(Brand.code == computed).one_or_none()
            if brand is None:
                print(f"VERDIKT: brand_code={computed} bor, lekin 'brands' jadvalida bunday kod YO'Q.")
                print("  Tuzatish: shu kod uchun Brand yozuvini yarating (yoki kodни to'g'rilang).")
            elif not brand.is_active:
                print(f"VERDIKT: Brand '{brand.name}' (code={computed}) mavjud, lekin NOFAOL.")
                print("  Tuzatish: brendni faollashtiring, keyin sinxron.")
            else:
                print(f"VERDIKT: Brand '{brand.name}' (code={computed}) FAOL va mavjud.")
                if p.brand_id != brand.id:
                    print("  Ammo mahsulotning brand_id'si moslanmagan -> qayta sinxron kerak.")
                else:
                    print("  Mahsulot to'g'ri bog'langan -> muammo displey/keshda bo'lishi mumkin.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
