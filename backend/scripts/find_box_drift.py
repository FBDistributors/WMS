"""Quti/dona drift hisoboti — ko'chirishni bloklaydigan mahsulotlarni topadi.

FAQAT O'QIYDI (SELECT) — hech narsa o'zgartirmaydi.

Ikki bo'lim:
  A) DRIFT: lot/joyda sealed qutilardagi dona (units_in_boxes) fizik qoldiqdan
     (on_hand) ko'p — invariant buzilgan. Bunday joyda quti ko'chirish 409
     ("Quti invariant buzildi") beradi, dona ko'chirish esa loose kamaygani
     uchun "Qutidagi zaxirani dona qilib ko'chirib bo'lmaydi" bilan bloklanadi.
     Tuzatish: mobil ilovada shu joyni SANOQ (count) qilish.

  B) REZERV+QUTI: joyda sealed quti bor VA rezerv > 0 — "butun palet" (full)
     ko'chirish ataylab bloklanadi (rezerv buziladi). Bu drift emas, lekin
     ko'chirishda xato ko'rgan operator uchun sabab shu bo'lishi mumkin.

Ishga tushirish (VPS):
  set -a && source /etc/wms/api.env && set +a
  /var/www/wms/backend/.venv/bin/python find_box_drift.py [--csv drift.csv]
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from datetime import date

from sqlalchemy import bindparam, create_engine, text

PHYSICAL_TYPES = (
    "opening_balance",
    "receipt",
    "putaway",
    "pick",
    "ship",
    "adjust",
    "transfer_in",
    "transfer_out",
)

# Har lot/joy uchun: fizik qoldiq, rezerv, sealed qutilardagi dona/quti soni.
BALANCES_SQL = """
WITH movement_balances AS (
    SELECT
        sm.lot_id,
        sm.location_id,
        SUM(CASE WHEN sm.movement_type IN :physical_types THEN sm.qty_change ELSE 0 END) AS on_hand,
        SUM(CASE WHEN sm.movement_type IN ('allocate', 'unallocate') THEN sm.qty_change ELSE 0 END) AS reserved
    FROM stock_movements sm
    GROUP BY sm.lot_id, sm.location_id
),
sealed AS (
    SELECT
        lbp.lot_id,
        lbp.location_id,
        COUNT(*) AS box_count,
        SUM(pb.units_per_box) AS units_in_boxes,
        MIN(pb.units_per_box) AS min_upb,
        MAX(pb.units_per_box) AS max_upb
    FROM location_box_placements lbp
    JOIN product_boxes pb ON pb.id = lbp.product_box_id AND pb.is_active = TRUE
    WHERE lbp.status = 'sealed'
    GROUP BY lbp.lot_id, lbp.location_id
)
SELECT
    l.code AS location_code,
    p.sku,
    p.name AS product_name,
    sl.batch,
    sl.expiry_date,
    COALESCE(mb.on_hand, 0) AS on_hand,
    COALESCE(mb.reserved, 0) AS reserved,
    s.box_count,
    s.units_in_boxes,
    s.min_upb,
    s.max_upb
FROM sealed s
JOIN stock_lots sl ON sl.id = s.lot_id
JOIN products p ON p.id = sl.product_id
JOIN locations l ON l.id = s.location_id
LEFT JOIN movement_balances mb
    ON mb.lot_id = s.lot_id AND mb.location_id = s.location_id
ORDER BY l.code, p.sku
"""


def fmt_expiry(d: date | None) -> str:
    return d.strftime("%Y-%m") if d else ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", help="Drift bo'limini CSV faylga yozish (ixtiyoriy)")
    args = parser.parse_args()

    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL env var kerak", file=sys.stderr)
        return 1

    engine = create_engine(url)
    with engine.connect() as conn:
        stmt = text(BALANCES_SQL).bindparams(
            bindparam("physical_types", value=list(PHYSICAL_TYPES), expanding=True)
        )
        rows = conn.execute(stmt).mappings().all()

    drift = []
    reserved_with_boxes = []
    for r in rows:
        on_hand = max(0, int(r["on_hand"]))
        units = int(r["units_in_boxes"])
        if units > on_hand:
            drift.append(r)
        elif int(r["reserved"]) > 0:
            reserved_with_boxes.append(r)

    def upb_label(r) -> str:
        return str(r["min_upb"]) if r["min_upb"] == r["max_upb"] else f"{r['min_upb']}-{r['max_upb']}"

    print(f"Jami sealed lot/joy juftliklari: {len(rows)}")
    print()
    print(f"=== A) DRIFT — quti > fizik qoldiq ({len(drift)} ta, ko'chirish BLOKLANADI) ===")
    if drift:
        print(f"{'Joy':<12} {'SKU':<10} {'Qoldiq':>7} {'Qutida':>7} {'Quti':>5} {'D/q':>6} {'Muddat':<8} Nomi")
        for r in drift:
            print(
                f"{r['location_code']:<12} {r['sku']:<10} {int(r['on_hand']):>7} "
                f"{int(r['units_in_boxes']):>7} {int(r['box_count']):>5} {upb_label(r):>6} "
                f"{fmt_expiry(r['expiry_date']):<8} {r['product_name'][:45]}"
            )
    else:
        print("  (topilmadi — invariant hamma joyda saqlangan)")

    print()
    print(f"=== B) REZERV + QUTI — full ko'chirish bloklanadi ({len(reserved_with_boxes)} ta) ===")
    if reserved_with_boxes:
        print(f"{'Joy':<12} {'SKU':<10} {'Qoldiq':>7} {'Rezerv':>7} {'Qutida':>7} {'Muddat':<8} Nomi")
        for r in reserved_with_boxes:
            print(
                f"{r['location_code']:<12} {r['sku']:<10} {int(r['on_hand']):>7} "
                f"{int(r['reserved']):>7} {int(r['units_in_boxes']):>7} "
                f"{fmt_expiry(r['expiry_date']):<8} {r['product_name'][:45]}"
            )
    else:
        print("  (topilmadi)")

    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow([
                "Joy", "SKU", "Fizik qoldiq", "Qutida yozilgan (dona)",
                "Quti soni", "Dona/quti", "Muddat", "Mahsulot nomi",
            ])
            for r in drift:
                w.writerow([
                    r["location_code"], r["sku"], int(r["on_hand"]),
                    int(r["units_in_boxes"]), int(r["box_count"]), upb_label(r),
                    fmt_expiry(r["expiry_date"]), r["product_name"],
                ])
        print(f"\nCSV yozildi: {args.csv} ({len(drift)} qator)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
