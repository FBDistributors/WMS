"""Ikki profil bitta jismoniy xodimga tegishlimi — "to'rt ko'z" qoidasi uchun.

Yagona ishonchli manba: users.person_code (admin kiritadi). Ism, telefon yoki
boshqa maydonlar bo'yicha TAXMIN QILINMAYDI — noto'g'ri musbat xodimni ishdan
to'sib qo'yadi, noto'g'ri manfiy esa qoidani teshadi.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from app.models.user import User


def _norm(code: str | None) -> str | None:
    v = (code or "").strip().casefold()
    return v or None


def same_person(db: Session, user_id_a: UUID | None, user_id_b: UUID | None) -> bool:
    """True: id lar teng YOKI ikkala userning person_code i bo'sh emas va teng.

    Kod bo'sh (bog'lanmagan profil) — False: himoya faqat admin bog'lagan
    profillar uchun kuchga kiradi (xavfsiz rollout).
    """
    if not user_id_a or not user_id_b:
        return False
    if user_id_a == user_id_b:
        return True
    rows = (
        db.query(User.id, User.person_code)
        .filter(User.id.in_([user_id_a, user_id_b]))
        .all()
    )
    codes = {row[0]: _norm(row[1]) for row in rows}
    code_a = codes.get(user_id_a)
    code_b = codes.get(user_id_b)
    return code_a is not None and code_a == code_b


def linked_user_ids(db: Session, user_id: UUID, person_code: str | None) -> set[UUID]:
    """Shu jismoniy xodimga tegishli barcha profil id lari (o'zini ham o'z ichiga oladi).

    Ro'yxatlarda "o'zi yig'gan" belgisini N+1 siz hisoblash uchun: natijadagi
    to'plam bilan document.assigned_to_user_id solishtiriladi.
    """
    own = {user_id}
    code = _norm(person_code)
    if code is None:
        return own
    rows = db.query(User.id, User.person_code).filter(User.person_code.isnot(None)).all()
    for uid, raw in rows:
        if _norm(raw) == code:
            own.add(uid)
    return own
