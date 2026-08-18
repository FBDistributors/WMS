"""Egasiz mijoz qaytimini (customer_return) ma'muriy bekor qilish.

Holat: qaytim yig'uvchiga biriktirilgan, lekin xodim ketgan/joylashtirish
unutilgan. Yakunlanmagan qaytim stock'ka HECH NARSA yozmagan (kirim faqat
complete da bo'ladi) — shuning uchun bekor qilish stock'ka tegmaydi.

Nima qilinadi:
  1) customer_return.status -> cancelled;
  2) bog'langan smartup_return (bo'lsa): wms_status -> new, customer_return_id
     tozalanadi — qaytim Qaytimlar ro'yxatiga qaytadi va kerak bo'lsa keyin
     boshqa yig'uvchiga qayta yuborsa bo'ladi. DIQQAT: tovar allaqachon javonga
     qo'yilib inventarizatsiya bilan sanalgan bo'lsa, QAYTA YUBORMANG — complete
     stock'ni ikkinchi marta oshiradi;
  3) audit yozuvi.

Himoya: qaytim bo'yicha stock harakati allaqachon yozilgan bo'lsa — to'xtaydi.

DRY-RUN default: --apply berilmasa hech narsa yozilmaydi.

Ishga tushirish (VPS):
  set -a && source /etc/wms/api.env && set +a
  cd /var/www/wms/backend
  .venv/bin/python -m scripts.close_orphan_customer_return --by <admin_username> CRET-20260714-1581F8
  .venv/bin/python -m scripts.close_orphan_customer_return --by <admin_username> --apply CRET-20260714-1581F8
"""
from __future__ import annotations

import argparse
import sys

from app.db import SessionLocal
from app.models.customer_return import (
    CUSTOMER_RETURN_STATUS_CANCELLED,
    CustomerReturn,
)
from app.models.smartup_return import SmartupReturn
from app.models.stock import StockMovement
from app.models.user import User
from app.services.audit_service import ACTION_UPDATE, log_action

OPEN_STATUSES = ("pending_controller", "approved", "assigned_to_picker")


def close_return(db, doc_no: str, admin: User, apply: bool) -> bool:
    print(f"\n--- {doc_no} ---")
    cr = (
        db.query(CustomerReturn)
        .filter(CustomerReturn.doc_no == doc_no)
        .one_or_none()
    )
    if not cr:
        print("  [SKIP] topilmadi")
        return False
    if cr.status not in OPEN_STATUSES:
        print(f"  [SKIP] holati {cr.status!r} — ochiq emas")
        return False

    posted = (
        db.query(StockMovement.id)
        .filter(
            StockMovement.source_document_type == "customer_return",
            StockMovement.source_document_id == cr.id,
        )
        .first()
    )
    if posted:
        print("  [SKIP] bu qaytim bo'yicha stock harakati bor — bekor qilib bo'lmaydi")
        return False

    sr = (
        db.query(SmartupReturn)
        .filter(SmartupReturn.customer_return_id == cr.id)
        .one_or_none()
    )
    print(f"  qaytim: {cr.status} -> cancelled ({len(cr.lines)} qator, mijoz: {cr.customer_name})")
    if sr:
        print(f"  smartup_return deal_id={sr.deal_id}: wms_status {sr.wms_status!r} -> 'new', bog'lanish tozalanadi")
    else:
        print("  smartup_return bog'lanishi yo'q")

    if not apply:
        return True

    old_status = cr.status
    cr.status = CUSTOMER_RETURN_STATUS_CANCELLED
    if sr:
        sr.wms_status = "new"
        sr.customer_return_id = None

    log_action(
        db,
        user_id=admin.id,
        action=ACTION_UPDATE,
        entity_type="customer_return",
        entity_id=str(cr.id),
        old_data={"status": old_status},
        new_data={
            "status": CUSTOMER_RETURN_STATUS_CANCELLED,
            "action": "orphan_customer_return_admin_close",
            "reason": "biriktirilgan xodim ketgan, joylashtirish bajarilmagan",
            "doc_no": cr.doc_no,
            "smartup_return_reverted": str(sr.deal_id) if sr else None,
        },
    )
    db.commit()
    print("  [OK] bekor qilindi")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--by", required=True, help="Admin username (audit muallifi)")
    parser.add_argument("--apply", action="store_true", help="Haqiqatan bajarish (default: dry-run)")
    parser.add_argument("doc_nos", nargs="+", help="Qaytim hujjat raqamlari (doc_no)")
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
        for doc_no in args.doc_nos:
            try:
                if close_return(db, doc_no.strip(), admin, args.apply):
                    done += 1
            except Exception as exc:  # noqa: BLE001
                db.rollback()
                print(f"  [XATO] {doc_no}: {exc} — rollback qilindi")
        print(f"\nJami: {done}/{len(args.doc_nos)} ta qaytim {'bekor qilindi' if args.apply else 'bekorga tayyor'}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
