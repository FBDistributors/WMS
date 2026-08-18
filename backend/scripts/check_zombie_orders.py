"""Zombi buyurtmalar diagnostikasi: hujjatsiz picking/picked da qotganlar.

FAQAT O'QIYDI (SELECT) — hech narsa o'zgartirmaydi.

Ikki toifa:
  A) SO hujjati UMUMAN yo'q, status picking/picked — hech qachon oldinga
     siljimaydi (yopish: completed);
  B) SO hujjat(lar)i bor, lekin HAMMASI cancelled, buyurtma esa
     allocated/picking/picked da qotgan (yopish: cancelled).

Ishga tushirish (VPS):
  set -a && source /etc/wms/api.env && set +a
  cd /var/www/wms/backend
  .venv/bin/python -m scripts.check_zombie_orders
"""
from __future__ import annotations

import sys
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import exists, func

from app.db import SessionLocal
from app.models.document import Document
from app.models.order import Order, OrderWmsState
from app.models.stock import StockMovement

ZOMBIE_STATUSES = ("picking", "picked")
CANCELLED_DOC_ORDER_STATUSES = ("allocated", "picking", "picked")
MIN_AGE_DAYS = 14


def main() -> int:
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=MIN_AGE_DAYS)
        has_so_doc = exists().where(
            (Document.order_id == Order.id) & (Document.doc_type == "SO")
        )

        print("=== A) HUJJATSIZ ZOMBILAR (picking/picked, SO hujjat yo'q) ===")
        zombies = (
            db.query(Order, OrderWmsState.status)
            .join(OrderWmsState, OrderWmsState.order_id == Order.id)
            .filter(OrderWmsState.status.in_(ZOMBIE_STATUSES), ~has_so_doc)
            .order_by(Order.created_at)
            .all()
        )
        by_month: Counter = Counter()
        by_source: Counter = Counter()
        too_young = 0
        for order, st in zombies:
            by_month[order.created_at.strftime("%Y-%m")] += 1
            by_source[order.source or "-"] += 1
            created = order.created_at
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if created >= cutoff:
                too_young += 1
        print(f"  jami: {len(zombies)} ta (shundan {MIN_AGE_DAYS} kundan yosh: {too_young} — yopilmaydi)")
        print(f"  oyma-oy: {dict(sorted(by_month.items()))}")
        print(f"  manba kesimi: {dict(by_source)}")
        if zombies:
            newest = zombies[-1][0]
            print(f"  ENG YANGISI: {newest.order_number} ({newest.created_at.date()}) — "
                  f"muammo {'HALI DAVOM ETYAPTI' if str(newest.created_at.date()) >= str((datetime.now(timezone.utc) - timedelta(days=30)).date()) else 'eski davrga oid'}")
        for order, st in zombies[:8]:
            print(f"    - {order.order_number} | {st} | {order.source} | {order.created_at.date()}")

        # Rezerv himoya tekshiruvi: zombi buyurtma qatorlari joylarida musbat rezerv bormi.
        print("\n  Rezerv tekshiruvi (zombi buyurtmalarga allocate yozuvlari):")
        zombie_ids = [o.id for o, _ in zombies]
        if zombie_ids:
            alloc_net = (
                db.query(func.coalesce(func.sum(StockMovement.qty_change), 0))
                .filter(
                    StockMovement.movement_type.in_(("allocate", "unallocate")),
                    StockMovement.source_document_type == "order",
                    StockMovement.source_document_id.in_(zombie_ids),
                )
                .scalar()
            )
            print(f"    order-manbali sof rezerv: {alloc_net} (0 bo'lishi kutiladi)")
        else:
            print("    (zombi yo'q)")

        print("\n=== B) HUJJATI CANCELLED, BUYURTMASI QOTGAN ===")
        all_docs_cancelled = ~exists().where(
            (Document.order_id == Order.id)
            & (Document.doc_type == "SO")
            & (Document.status != "cancelled")
        )
        stuck = (
            db.query(Order, OrderWmsState.status)
            .join(OrderWmsState, OrderWmsState.order_id == Order.id)
            .filter(
                OrderWmsState.status.in_(CANCELLED_DOC_ORDER_STATUSES),
                has_so_doc,
                all_docs_cancelled,
            )
            .order_by(Order.created_at)
            .all()
        )
        print(f"  jami: {len(stuck)} ta")
        for order, st in stuck[:10]:
            print(f"    - {order.order_number} | {st} | {order.source} | {order.created_at.date()}")

        print("\nTEKSHIRUV TUGADI — hech narsa o'zgartirilmadi.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
