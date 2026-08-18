"""Egasiz qaytarish sessiyalarini ma'muriy yopish (xodim ketgan, tovar javonga
qaytarilgan va inventarizatsiya bilan qamralgan holat uchun).

STOCK'GA TEGMAYDI: qaytarish harakatlari (pick rollback) yozilmaydi — fizik
qoldiq allaqachon inventarizatsiya bilan to'g'rilangan. Faqat:
  1) sessiya -> completed;
  2) hujjat qatorlari joylaridagi qolgan rezerv bo'shatiladi (unallocate,
     joydagi HAQIQIY rezerv bilan cheklangan — release_document_reserve_on_cancel);
  3) hujjat -> cancelled, buyurtma -> cancelled;
  4) har buyurtma uchun audit yozuvi.

picked_qty ataylab nolga tushirilmaydi — xodim qancha tergani tarixda qoladi
(oddiy yakunlashda nollanadi, chunki u stockni qaytaradi; bu yerda qaytarmaymiz).

DRY-RUN default: --apply berilmasa hech narsa yozilmaydi.

Ishga tushirish (VPS):
  set -a && source /etc/wms/api.env && set +a
  cd /var/www/wms/backend
  # avval ko'rish:
  .venv/bin/python -m scripts.close_orphan_return_sessions --by <admin_username> 104099 104102 103631
  # tasdiqlab bajarish:
  .venv/bin/python -m scripts.close_orphan_return_sessions --by <admin_username> --apply 104099 104102 103631
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from app.db import SessionLocal
from app.models.document import Document
from app.models.order import Order
from app.models.safe_cancel_return import SafeCancelReturnSession
from app.models.user import User
from app.services.audit_service import ACTION_UPDATE, log_action
from app.services.order_reserve_release import release_document_reserve_on_cancel

EXPECTED_ORDER_STATUS = "cancelling_in_progress"
EXPECTED_SESSION_STATUS = "returns_pending"


def close_order(db, order_number: str, admin: User, apply: bool) -> bool:
    """True — yopildi (yoki dry-run da yopilishi rejalashtirildi)."""
    print(f"\n--- {order_number} ---")
    order = (
        db.query(Order).filter(Order.order_number == order_number).one_or_none()
    )
    if not order or not order.wms_state:
        print("  [SKIP] buyurtma yoki wms_state topilmadi")
        return False
    if order.wms_state.status != EXPECTED_ORDER_STATUS:
        print(
            f"  [SKIP] buyurtma holati {order.wms_state.status!r} — "
            f"{EXPECTED_ORDER_STATUS!r} kutilgan edi. Qo'lda ko'rib chiqing."
        )
        return False

    doc = (
        db.query(Document)
        .filter(Document.order_id == order.id, Document.doc_type == "SO")
        .one_or_none()
    )
    if not doc:
        print("  [SKIP] SO hujjat topilmadi")
        return False

    sessions = (
        db.query(SafeCancelReturnSession)
        .filter(
            SafeCancelReturnSession.document_id == doc.id,
            SafeCancelReturnSession.status == EXPECTED_SESSION_STATUS,
        )
        .all()
    )

    now = datetime.now(timezone.utc)
    print(f"  buyurtma: {order.wms_state.status} -> cancelled")
    print(f"  hujjat {doc.doc_no}: {doc.status} -> cancelled")
    for s in sessions:
        print(f"  sessiya {s.id}: {s.status} -> completed")
    if not sessions:
        print("  [!] ochiq sessiya yo'q — faqat hujjat/buyurtma yopiladi")

    if not apply:
        print("  (dry-run: rezerv bo'shatish miqdori apply da hisoblanadi — joydagi haqiqiy rezerv bilan cheklangan)")
        return True

    # 1) Qolgan rezervni bo'shatish — required-picked, joydagi haqiqiy rezerv bilan cheklangan.
    released = release_document_reserve_on_cancel(db, doc, doc.lines, admin.id)
    print(f"  rezerv bo'shatildi: {released} ta qator bo'yicha")

    # 2) Holatlar.
    for s in sessions:
        s.status = "completed"
        s.completed_at = now
    doc.status = "cancelled"
    order.wms_state.status = "cancelled"
    order.wms_state.cancelled_at = now
    if not order.wms_state.cancelled_by_user_id:
        order.wms_state.cancelled_by_user_id = admin.id

    # 3) Audit.
    log_action(
        db,
        user_id=admin.id,
        action=ACTION_UPDATE,
        entity_type="order",
        entity_id=str(order.id),
        old_data={"status": EXPECTED_ORDER_STATUS},
        new_data={
            "status": "cancelled",
            "action": "orphan_return_admin_close",
            "reason": "xodim ketgan, tovar javonga qaytarilgan, inventarizatsiya qamragan",
            "document_id": str(doc.id),
            "sessions_closed": [str(s.id) for s in sessions],
            "reserve_lines_released": released,
        },
    )
    db.commit()
    print("  [OK] yopildi")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--by", required=True, help="Admin username (audit va unallocate muallifi)")
    parser.add_argument("--apply", action="store_true", help="Haqiqatan bajarish (default: dry-run)")
    parser.add_argument("numbers", nargs="+", help="Buyurtma raqamlari")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == args.by).one_or_none()
        if not admin:
            print(f"[XATO] username={args.by!r} topilmadi")
            return 1
        if not args.apply:
            print("DRY-RUN: hech narsa yozilmaydi. Bajarish uchun --apply qo'shing.")
        done = 0
        for n in args.numbers:
            try:
                if close_order(db, n.strip(), admin, args.apply):
                    done += 1
            except Exception as exc:  # noqa: BLE001
                db.rollback()
                print(f"  [XATO] {n}: {exc} — rollback qilindi, keyingisiga o'tildi")
        print(f"\nJami: {done}/{len(args.numbers)} ta buyurtma {'yopildi' if args.apply else 'yopishga tayyor'}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
