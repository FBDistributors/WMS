"""Zombi buyurtmalarni ma'muriy yopish.

Ikki toifa (check_zombie_orders bilan bir xil ta'rif):
  A) SO hujjati UMUMAN yo'q, status picking/picked -> **completed**
     (hujjatsiz buyurtma hech qachon oldinga siljimaydi; ish haqi hujjatdan
     sanalgani uchun ball hisobiga ta'sir yo'q);
  B) SO hujjat(lar)i bor, lekin HAMMASI cancelled, buyurtma
     allocated/picking/picked da qotgan -> **cancelled** (hujjatiga mos) +
     qolgan rezerv bo'shatiladi (joydagi haqiqiy rezerv bilan cheklangan).

Himoyalar:
  - Yosh chegarasi: created_at kamida 14 kun eski — oqim o'rtasidagi yangi
    buyurtma tasodifan tushib qolmasin;
  - A toifada har qanday statusdagi SO hujjat bo'lsa ham — SKIP (joriy ish);
  - Stock'ka tegilmaydi (B da faqat unallocate, cap bilan).

DRY-RUN default: --apply berilmasa hech narsa yozilmaydi.

Ishga tushirish (VPS):
  set -a && source /etc/wms/api.env && set +a
  cd /var/www/wms/backend
  .venv/bin/python -m scripts.close_zombie_orders --by <admin_username>
  .venv/bin/python -m scripts.close_zombie_orders --by <admin_username> --apply
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import exists

from app.db import SessionLocal
from app.models.document import Document
from app.models.order import Order, OrderWmsState
from app.models.user import User
from app.services.audit_service import ACTION_UPDATE, log_action
from app.services.order_reserve_release import release_document_reserve_on_cancel

ZOMBIE_STATUSES = ("picking", "picked")
CANCELLED_DOC_ORDER_STATUSES = ("allocated", "picking", "picked")
MIN_AGE_DAYS = 14
BATCH_COMMIT = 100


def _old_enough(order: Order, cutoff: datetime) -> bool:
    created = order.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return created < cutoff


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--by", required=True, help="Admin username (audit muallifi)")
    parser.add_argument("--apply", action="store_true", help="Haqiqatan bajarish (default: dry-run)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == args.by).one_or_none()
        if not admin:
            print(f"[XATO] username={args.by!r} topilmadi")
            return 1
        if not args.apply:
            print("DRY-RUN: hech narsa yozilmaydi. Bajarish uchun --apply qo'shing.")

        cutoff = datetime.now(timezone.utc) - timedelta(days=MIN_AGE_DAYS)
        now = datetime.now(timezone.utc)
        has_so_doc = exists().where(
            (Document.order_id == Order.id) & (Document.doc_type == "SO")
        )

        # --- A: hujjatsiz -> completed ---
        zombies = (
            db.query(Order)
            .join(OrderWmsState, OrderWmsState.order_id == Order.id)
            .filter(OrderWmsState.status.in_(ZOMBIE_STATUSES), ~has_so_doc)
            .order_by(Order.created_at)
            .all()
        )
        done_a = skipped_young = 0
        for order in zombies:
            if not _old_enough(order, cutoff):
                skipped_young += 1
                continue
            old_status = order.wms_state.status
            print(f"  A {order.order_number} ({order.created_at.date()}, {order.source}): {old_status} -> completed")
            if not args.apply:
                done_a += 1
                continue
            order.wms_state.status = "completed"
            log_action(
                db,
                user_id=admin.id,
                action=ACTION_UPDATE,
                entity_type="order",
                entity_id=str(order.id),
                old_data={"status": old_status},
                new_data={
                    "status": "completed",
                    "action": "zombie_order_admin_close",
                    "reason": "SO hujjatsiz qotib qolgan buyurtma (hujjat yo'qolgan)",
                },
            )
            done_a += 1
            if done_a % BATCH_COMMIT == 0:
                db.commit()
        if args.apply:
            db.commit()

        # --- B: hamma hujjati cancelled -> cancelled ---
        all_docs_cancelled = ~exists().where(
            (Document.order_id == Order.id)
            & (Document.doc_type == "SO")
            & (Document.status != "cancelled")
        )
        stuck = (
            db.query(Order)
            .join(OrderWmsState, OrderWmsState.order_id == Order.id)
            .filter(
                OrderWmsState.status.in_(CANCELLED_DOC_ORDER_STATUSES),
                has_so_doc,
                all_docs_cancelled,
            )
            .order_by(Order.created_at)
            .all()
        )
        done_b = 0
        for order in stuck:
            if not _old_enough(order, cutoff):
                skipped_young += 1
                continue
            old_status = order.wms_state.status
            print(f"  B {order.order_number} ({order.created_at.date()}, {order.source}): {old_status} -> cancelled")
            if not args.apply:
                done_b += 1
                continue
            doc = (
                db.query(Document)
                .filter(Document.order_id == order.id, Document.doc_type == "SO")
                .first()
            )
            released = 0
            if doc:
                # Qolgan rezerv (bo'lsa) — joydagi haqiqiy rezerv bilan cheklangan.
                released = release_document_reserve_on_cancel(db, doc, doc.lines, admin.id)
            order.wms_state.status = "cancelled"
            order.wms_state.cancelled_at = now
            if not order.wms_state.cancelled_by_user_id:
                order.wms_state.cancelled_by_user_id = admin.id
            log_action(
                db,
                user_id=admin.id,
                action=ACTION_UPDATE,
                entity_type="order",
                entity_id=str(order.id),
                old_data={"status": old_status},
                new_data={
                    "status": "cancelled",
                    "action": "zombie_order_admin_close",
                    "reason": "hujjati bekor qilingan, buyurtma statusi qotib qolgan",
                    "reserve_lines_released": released,
                },
            )
            done_b += 1
        if args.apply:
            db.commit()

        verb = "yopildi" if args.apply else "yopishga tayyor"
        print(f"\nJami: A (completed) — {done_a} ta, B (cancelled) — {done_b} ta {verb}; "
              f"yosh sababli skip: {skipped_young}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
