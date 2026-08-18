"""Egasiz qolgan qaytarish sessiyalari diagnostikasi (xodim ketgan, yakunlanmagan).

FAQAT O'QIYDI (SELECT) — hech narsa o'zgartirmaydi.

Har buyurtma raqami bo'yicha ko'rsatadi: buyurtma/hujjat/sessiya holati, sessiya
qatorlari (nechta skanerlangan), va hujjat qatorlari joylarida qancha rezerv
osilib turgani. Ma'muriy yopishdan (close_orphan_return_sessions) OLDIN ishga
tushirilib, holat kutilganga mosligini tasdiqlash uchun.

Ishga tushirish (VPS):
  set -a && source /etc/wms/api.env && set +a
  cd /var/www/wms/backend
  .venv/bin/python -m scripts.check_orphan_return_sessions 104099 104102 103631
"""
from __future__ import annotations

import sys
from decimal import Decimal

from app.db import SessionLocal
from app.models.document import Document, DocumentLine
from app.models.location import Location
from app.models.order import Order
from app.models.safe_cancel_return import SafeCancelReturnSession
from app.models.stock import StockLot
from app.models.user import User
from app.services.stock_availability import compute_lot_location_balances


def _user_label(db, user_id) -> str:
    if not user_id:
        return "—"
    u = db.get(User, user_id)
    if not u:
        return str(user_id)
    return (u.full_name or u.username or str(user_id)).strip()


def check_order(db, order_number: str) -> None:
    print(f"\n{'=' * 70}")
    print(f"BUYURTMA: {order_number}")
    print("=" * 70)

    orders = db.query(Order).filter(Order.order_number == order_number).all()
    if not orders:
        print("  [TOPILMADI] bunday order_number yo'q")
        return
    for order in orders:
        ws = order.wms_state
        print(f"  order_id={order.id} source={order.source}")
        print(f"  wms_status={ws.status if ws else '(wms_state yoq)'}")
        if ws and ws.cancelled_at:
            print(f"  cancelled_at={ws.cancelled_at} by={_user_label(db, ws.cancelled_by_user_id)}")

        docs = (
            db.query(Document)
            .filter(Document.order_id == order.id, Document.doc_type == "SO")
            .all()
        )
        if not docs:
            print("  [!] SO hujjat topilmadi")
            continue
        for doc in docs:
            print(f"\n  HUJJAT {doc.doc_no}: status={doc.status}")
            print(f"    yig'uvchi: {_user_label(db, doc.assigned_to_user_id)}")

            sessions = (
                db.query(SafeCancelReturnSession)
                .filter(SafeCancelReturnSession.document_id == doc.id)
                .all()
            )
            if not sessions:
                print("    [!] qaytarish sessiyasi yo'q")
            for s in sessions:
                confirmed = sum(1 for l in s.lines if l.product_confirmed)
                print(
                    f"    SESSIYA {s.id}: status={s.status} "
                    f"qatorlar={len(s.lines)} skanerlangan={confirmed} "
                    f"yaratilgan={s.created_at:%Y-%m-%d}"
                )
                print(f"      yig'uvchi: {_user_label(db, s.picker_user_id)}")

            # Hujjat qatorlari joylaridagi rezerv holati.
            lines = db.query(DocumentLine).filter(DocumentLine.document_id == doc.id).all()
            print(f"\n    QATORLAR ({len(lines)} ta) va joylardagi rezerv:")
            seen_pairs: set = set()
            total_stuck = Decimal("0")
            for ln in lines:
                if not ln.lot_id or not ln.location_id:
                    print(f"      - {ln.product_name[:40]}: lot/joy yo'q (ajratilmagan)")
                    continue
                rem = Decimal(str(ln.required_qty or 0)) - Decimal(str(ln.picked_qty or 0))
                pair = (ln.lot_id, ln.location_id)
                pair_note = ""
                if pair not in seen_pairs:
                    seen_pairs.add(pair)
                    on_hand, reserved, available = compute_lot_location_balances(
                        db, ln.lot_id, ln.location_id
                    )
                    loc = db.get(Location, ln.location_id)
                    lot = db.get(StockLot, ln.lot_id)
                    pair_note = (
                        f" | joy={loc.code if loc else ln.location_id} "
                        f"partiya={lot.batch if lot else '?'} "
                        f"on_hand={on_hand} reserved={reserved} available={available}"
                    )
                    if reserved > 0:
                        total_stuck += reserved
                print(
                    f"      - {ln.product_name[:40]}: required={ln.required_qty} "
                    f"picked={ln.picked_qty} rem={rem}{pair_note}"
                )
            print(f"\n    Joylardagi jami rezerv (shu hujjat joylari bo'yicha): {total_stuck}")
            print(
                "    Eslatma: reserved umumiy hovuz — boshqa faol buyurtmaniki ham "
                "bo'lishi mumkin; yopish skripti rem bilan cheklab bo'shatadi."
            )


def main() -> int:
    numbers = [a.strip() for a in sys.argv[1:] if a.strip()]
    if not numbers:
        print("Foydalanish: python -m scripts.check_orphan_return_sessions 104099 104102 ...")
        return 1
    db = SessionLocal()
    try:
        for n in numbers:
            check_order(db, n)
        print(f"\n{'=' * 70}")
        print("Tekshiruv tugadi — hech narsa o'zgartirilmadi.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
