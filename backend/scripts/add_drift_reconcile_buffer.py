"""Drift-reconcile qilingan joylarga vaqtincha loose (dona) qoldiq qo'shish.

Nima uchun: `reconcile_box_drift.py --apply` fantom qutilarni olib tashlagach,
ba'zi (lot, joy) larda on_hand past bo'lib, ombordagi harakat (terish) to'xtab
qolishi mumkin. Bu skript o'sha juftliklarga **vaqtincha** buffer sifatida
`--qty` (standart 1000) dona qo'shadi. Bu FIZIK inventarizatsiya emas —
keyinchalik inventarizatsiya bilan to'g'rilanadi. Movement `movement_type=adjust`,
`reason_code=drift_reconcile_buffer` bilan yoziladi (audit va keyin qaytarish uchun).

Faqat quti tomonga tegilmaydi — loose oshadi, invariant `units_in_boxes <= on_hand`
saqlanadi (hatto mustahkamlanadi).

Idempotent: agar (lot, joy) uchun `--since` dan keyin allaqachon
`drift_reconcile_buffer` movement bo'lsa, qayta qo'shmaydi.

Ishga tushirish (VPS):
  set -a && source /etc/wms/api.env && set +a
  .../python scripts/add_drift_reconcile_buffer.py            # dry-run
  .../python scripts/add_drift_reconcile_buffer.py --apply    # haqiqiy qo'shish
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, time, timezone
from decimal import Decimal

from sqlalchemy import create_engine, func
from sqlalchemy.orm import Session

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.location import Location as LocationModel  # noqa: E402
from app.models.location_box_placement import LocationBoxPlacement  # noqa: E402
from app.models.product import Product as ProductModel  # noqa: E402
from app.models.stock import StockLot as StockLotModel, StockMovement as StockMovementModel  # noqa: E402
from app.models.user import User as UserModel  # noqa: E402
from app.services.stock_availability import compute_lot_location_balances  # noqa: E402

REMOVE_REASON = "drift_reconcile"
BUFFER_REASON = "drift_reconcile_buffer"


def _target_pairs(db: Session, since: datetime) -> list[tuple]:
    """`since` dan keyin drift_reconcile bilan olib tashlangan distinct (lot_id, location_id)."""
    return (
        db.query(LocationBoxPlacement.lot_id, LocationBoxPlacement.location_id)
        .filter(
            LocationBoxPlacement.remove_reason == REMOVE_REASON,
            LocationBoxPlacement.removed_at >= since,
        )
        .distinct()
        .all()
    )


def _already_buffered(db: Session, lot_id, location_id, since: datetime) -> bool:
    return (
        db.query(StockMovementModel.id)
        .filter(
            StockMovementModel.lot_id == lot_id,
            StockMovementModel.location_id == location_id,
            StockMovementModel.reason_code == BUFFER_REASON,
            StockMovementModel.created_at >= since,
        )
        .first()
        is not None
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Haqiqiy qo'shish (aks holda dry-run)")
    parser.add_argument("--qty", type=int, default=1000, help="Har (lot, joy) uchun qo'shiladigan dona (standart 1000)")
    parser.add_argument(
        "--since",
        default="today",
        help="ISO sana (YYYY-MM-DD) yoki 'today' — shu vaqtdan keyin olib tashlangan juftliklar (standart: bugun UTC)",
    )
    args = parser.parse_args()

    if args.qty <= 0:
        print("--qty musbat bo'lishi kerak", file=sys.stderr)
        return 1

    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL env var kerak", file=sys.stderr)
        return 1

    if args.since == "today":
        since = datetime.combine(datetime.now(timezone.utc).date(), time.min, tzinfo=timezone.utc)
    else:
        since = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc)

    engine = create_engine(url)
    db = Session(bind=engine)

    qty = Decimal(args.qty)
    total_pairs = 0
    added_pairs = 0
    skipped_existing = 0
    total_units = 0
    samples: list[str] = []

    try:
        admin = (
            db.query(UserModel)
            .filter(UserModel.role == "warehouse_admin", UserModel.is_active.is_(True))
            .order_by(UserModel.created_at.asc())
            .first()
        )
        admin_id = admin.id if admin else None
        author = admin.username if admin else "NULL"
        print(f"Buffer muallifi (created_by): {author}")
        print(f"since: {since.isoformat()}  |  qty/joy: {args.qty}")
        print()

        pairs = _target_pairs(db, since)
        for lot_id, location_id in pairs:
            total_pairs += 1
            if _already_buffered(db, lot_id, location_id, since):
                skipped_existing += 1
                continue

            lot = db.get(StockLotModel, lot_id)
            if lot is None:
                continue
            on_hand, _res, _avail = compute_lot_location_balances(db, lot_id, location_id)
            H = int(on_hand)

            added_pairs += 1
            total_units += args.qty

            if len(samples) < 25:
                loc = db.get(LocationModel, location_id)
                prod = db.get(ProductModel, lot.product_id)
                samples.append(
                    f"  {loc.code if loc else location_id:<12} {(prod.sku if prod else '?'):<10} "
                    f"on_hand {H} -> {H + args.qty}  (+{args.qty})"
                )

            if args.apply:
                db.add(
                    StockMovementModel(
                        product_id=lot.product_id,
                        lot_id=lot_id,
                        location_id=location_id,
                        qty_change=qty,
                        movement_type="adjust",
                        source_document_type=None,
                        source_document_id=None,
                        created_by_user_id=admin_id,
                        reason_code=BUFFER_REASON,
                    )
                )

        print(f"Nishon (lot, joy) juftliklar: {total_pairs}")
        print(f"Allaqachon buffer bor (o'tkazildi): {skipped_existing}")
        print(f"Qo'shiladigan juftliklar: {added_pairs}")
        print(f"Jami qo'shiladigan dona: {total_units}")
        print()
        print("Namuna (birinchi 25):")
        print("\n".join(samples) if samples else "  (yo'q)")

        if args.apply:
            db.commit()
            print("\n✅ QO'LLANDI — buffer qoldiq qo'shildi (reason_code=drift_reconcile_buffer).")
        else:
            db.rollback()
            print("\n(DRY-RUN — hech narsa o'zgartirilmadi. Qo'llash: --apply)")
    finally:
        db.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
