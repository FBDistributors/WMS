"""Yakunlangan buyurtmalar yig'uvchi/controllerga qanchalik biriktirilganini tekshiradi.

FAQAT O'QIYDI (SELECT) — hech narsa o'zgartirmaydi.

Nega kerak: dashboardda "Yig'uvchilar" va "Controllerlar" kartalaridagi BUYURTMA
KPI raqamlari farq qilishi mumkin (masalan 63 va 64). Sabab odatda: ayrim
yakunlangan hujjatda `assigned_to_user_id` (yig'uvchi) yoki
`controlled_by_user_id` (controller) bo'sh, yoki o'sha foydalanuvchi o'chirilgan —
bunday hujjat o'sha rol reytingiga tushmaydi.

Ishga tushirish (VPS):
  set -a && source /etc/wms/api.env && set +a
  cd /var/www/wms/backend
  .venv/bin/python -m scripts.check_completed_attribution 2026-07-18
  .venv/bin/python -m scripts.check_completed_attribution 2026-07-01 2026-07-18
"""
from __future__ import annotations

import sys
from datetime import date

from sqlalchemy import and_

from app.api.v1.endpoints.dashboard import (
    COMPLETED_DOC_STATUSES,
    _day_bounds_in_tz,
    _document_completed_at_expr,
)
from app.db import SessionLocal
from app.models.document import Document
from app.models.user import User


def _parse(arg: str) -> date:
    y, m, d = (int(x) for x in arg.split("-"))
    return date(y, m, d)


def main() -> int:
    if len(sys.argv) < 2:
        print("Foydalanish: python -m scripts.check_completed_attribution <YYYY-MM-DD> [YYYY-MM-DD]")
        return 2
    d_from = _parse(sys.argv[1])
    d_to = _parse(sys.argv[2]) if len(sys.argv) > 2 else d_from

    db = SessionLocal()
    try:
        ts = _document_completed_at_expr()
        start, _ = _day_bounds_in_tz(d_from)
        _, end = _day_bounds_in_tz(d_to)
        base = [
            Document.doc_type == "SO",
            Document.status.in_(COMPLETED_DOC_STATUSES),
            ts >= start,
            ts <= end,
        ]
        docs = db.query(Document).filter(and_(*base)).all()
        print(f"Oraliq: {d_from} .. {d_to}")
        print(f"Yakunlangan SO hujjatlar (jami): {len(docs)}\n")

        user_ids = {u.id for u in db.query(User.id).all()}

        no_picker = [d for d in docs if d.assigned_to_user_id is None]
        no_ctrl = [d for d in docs if d.controlled_by_user_id is None]
        ghost_picker = [
            d for d in docs
            if d.assigned_to_user_id is not None and d.assigned_to_user_id not in user_ids
        ]
        ghost_ctrl = [
            d for d in docs
            if d.controlled_by_user_id is not None and d.controlled_by_user_id not in user_ids
        ]

        counted_picker = len(docs) - len(no_picker) - len(ghost_picker)
        counted_ctrl = len(docs) - len(no_ctrl) - len(ghost_ctrl)
        print(f"Yig'uvchi KPI'ga tushadi   : {counted_picker}")
        print(f"Controller KPI'ga tushadi  : {counted_ctrl}")
        if counted_picker != counted_ctrl:
            print("  -> FARQ shu sababdan (quyidagi hujjatlarga qarang).")
        print()

        def _dump(label: str, rows: list) -> None:
            if not rows:
                return
            print(f"{label} ({len(rows)}):")
            for d in rows:
                print(f"   doc_no={d.doc_no} status={d.status} id={d.id} "
                      f"completed_at={d.completed_at} order_id={d.order_id}")
            print()

        _dump("Yig'uvchisi YO'Q hujjatlar", no_picker)
        _dump("Controlleri YO'Q hujjatlar", no_ctrl)
        _dump("Yig'uvchisi o'chirilgan (mavjud emas)", ghost_picker)
        _dump("Controlleri o'chirilgan (mavjud emas)", ghost_ctrl)

        if not (no_picker or no_ctrl or ghost_picker or ghost_ctrl):
            print("Hammasi biriktirilgan — KPI raqamlari teng bo'lishi kerak.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
