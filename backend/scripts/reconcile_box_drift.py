"""Quti drift'ini stock daftariga moslashtirish (ledger = haqiqat manbasi).

Har lot/joyda `units_in_boxes > on_hand` bo'lsa, ortiqcha SEALED quti
yozuvlarini `status=removed` qilib, invariantni tiklaydi. **Fizik qoldiqqa
(on_hand) TEGILMAYDI** — hech qanday stock_movement qo'shilmaydi, faqat
fantom quti yozuvlari kamaytiriladi.

Standart rejim — DRY-RUN (hech narsa o'zgarmaydi). Qo'llash uchun `--apply`.

Ishga tushirish (VPS):
  set -a && source /etc/wms/api.env && set +a
  .../python reconcile_box_drift.py            # dry-run
  .../python reconcile_box_drift.py --apply    # haqiqiy tuzatish
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, joinedload

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.location import Location as LocationModel  # noqa: E402
from app.models.location_box_placement import (  # noqa: E402
    PLACEMENT_REMOVED,
    PLACEMENT_SEALED,
    LocationBoxPlacement,
)
from app.models.product import Product as ProductModel  # noqa: E402
from app.models.stock import StockLot as StockLotModel  # noqa: E402
from app.services.stock_availability import compute_lot_location_balances  # noqa: E402


def _sealed_pairs(db: Session) -> list[tuple]:
    """Distinct (lot_id, location_id) with at least one active sealed placement."""
    rows = (
        db.query(LocationBoxPlacement.lot_id, LocationBoxPlacement.location_id)
        .join(LocationBoxPlacement.product_box)
        .filter(LocationBoxPlacement.status == PLACEMENT_SEALED)
        .distinct()
        .all()
    )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Haqiqiy o'zgartirish (aks holda dry-run)")
    parser.add_argument("--limit", type=int, default=0, help="Faqat birinchi N lot/joyni qayta ishlash (sinov uchun)")
    args = parser.parse_args()

    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL env var kerak", file=sys.stderr)
        return 1

    engine = create_engine(url)
    db = Session(bind=engine)

    total_pairs = 0
    fixed_pairs = 0
    removed_placements = 0
    cleared_units = 0
    samples: list[str] = []
    now = datetime.now(timezone.utc)

    try:
        pairs = _sealed_pairs(db)
        for lot_id, location_id in pairs:
            total_pairs += 1
            on_hand, _reserved, _available = compute_lot_location_balances(db, lot_id, location_id)
            H = max(0, int(on_hand))

            placements = (
                db.query(LocationBoxPlacement)
                .options(joinedload(LocationBoxPlacement.product_box))
                .filter(
                    LocationBoxPlacement.lot_id == lot_id,
                    LocationBoxPlacement.location_id == location_id,
                    LocationBoxPlacement.status == PLACEMENT_SEALED,
                )
                .order_by(LocationBoxPlacement.placed_at.desc())  # eng yangisidan o'chir
                .all()
            )
            active = [p for p in placements if p.product_box and p.product_box.is_active]
            units_in_boxes = sum(int(p.product_box.units_per_box) for p in active)
            if units_in_boxes <= H:
                continue  # invariant saqlangan, drift yo'q

            # Ortiqcha qutilarni (eng yangisidan) olib tashlash — units_in_boxes <= H bo'lguncha.
            to_remove: list[LocationBoxPlacement] = []
            remaining = units_in_boxes
            for p in active:
                if remaining <= H:
                    break
                to_remove.append(p)
                remaining -= int(p.product_box.units_per_box)

            if not to_remove:
                continue

            fixed_pairs += 1
            if args.limit and fixed_pairs > args.limit:
                fixed_pairs -= 1
                break

            removed_here = len(to_remove)
            units_here = units_in_boxes - remaining
            removed_placements += removed_here
            cleared_units += units_here

            if len(samples) < 25:
                loc = db.get(LocationModel, location_id)
                lot = db.get(StockLotModel, lot_id)
                prod = db.get(ProductModel, lot.product_id) if lot else None
                samples.append(
                    f"  {loc.code if loc else location_id:<12} {(prod.sku if prod else '?'):<10} "
                    f"on_hand={H:>5}  quti: {units_in_boxes}->{remaining}  "
                    f"(-{removed_here} yozuv, -{units_here} fantom dona)"
                )

            if args.apply:
                for p in to_remove:
                    p.status = PLACEMENT_REMOVED
                    p.removed_at = now
                    p.remove_reason = "drift_reconcile"

        print(f"Sealed lot/joy juftliklari: {total_pairs}")
        print(f"Drift (tuzatiladigan) juftliklar: {fixed_pairs}")
        print(f"Olib tashlanadigan quti yozuvlari: {removed_placements}")
        print(f"Tozalanadigan fantom dona (quti tarafida): {cleared_units}")
        print(f"Fizik qoldiq (on_hand) o'zgarishi: 0 (tegilmaydi)")
        print()
        print("Namuna (birinchi 25):")
        print("\n".join(samples) if samples else "  (yo'q)")

        if args.apply:
            db.commit()
            print("\n✅ QO'LLANDI — o'zgarishlar saqlandi.")
        else:
            db.rollback()
            print("\n(DRY-RUN — hech narsa o'zgartirilmadi. Qo'llash: --apply)")
    finally:
        db.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
