"""SmartUP organizatsiya ID (7+ raqam) → nom. settings_organizations bo'lmasa fallback."""

from __future__ import annotations

import re

ORG_FILIAL_ID_TO_NAME: dict[str, str] = {
    "3788131": "Головной Офис",
    "3964966": "Дилер Ипподром (Иззат)",
    "8109098": "Дилер Таш.область (Илхом)",
    "8109099": "Дилер Урикзор (Улугбек)",
    "8109100": "Дилер Янгиюль (Нодыра)",
    "8109101": "Дилер Фергана (Тавакал)",
    "8109102": "Дилер Андижан (Акмалжон)",
    "8109103": "Дилер Наманган (Шухрат)",
    "8109104": "Дилер Таш обл (Мейрлан) Проф",
    "8109105": "Дилер Коканд (Камолов Сардор)",
    "8109106": "Дилер Жиззах (Шердил)",
    "8109107": "Дилер Самарканд (Абдужалил)",
    "8109108": "Дилер Бухара (Жамшид)",
    "8109109": "Дилер Нукус (Андрей) Проф",
    "8109110": "Дилер Карши (Улугбек)",
    "8109111": "Дилер Термез (Гайрат)",
    "8109112": "Дилер Хорезм (Мансур)",
    "8109113": "Дилер Нукус (Урал)",
    "8109114": "Дилер Навоий (Жамшид)",
    "8109115": "Дилер Андижан (Иззатулло) (старый)",
    "8109116": "Дилер Жиззах (Мунаввар) Проф",
    "8109117": "Дилер Самарканд (Илдар) проф",
}


def is_smartup_org_filial_id(value: str | None) -> bool:
    k = (value or "").strip()
    return len(k) >= 7 and k.isdigit()


def normalize_smartup_org_filial_id(value: str | None) -> str | None:
    k = (value or "").strip()
    if is_smartup_org_filial_id(k):
        return k
    return None


def _dealer_keyword_from_org_name(name: str) -> str:
    """«Дилер Таш обл (Мейрлан) Проф» → «таш обл»."""
    n = (name or "").strip().lower()
    m = re.search(r"дилер\s+([^()]+)", n, flags=re.IGNORECASE)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()
    return n


def resolve_org_filial_id_from_note(note: str | None) -> str | None:
    """
    SmartUP movement note: «Заказ Дилер Таш обл…» → org ID.
    Flat eksportda to_filial_code bo'lmasa ishlatiladi.
    """
    text = (note or "").strip().lower()
    if not text or "дилер" not in text:
        return None
    best_id: str | None = None
    best_score = 0
    for org_id, name in ORG_FILIAL_ID_TO_NAME.items():
        if org_id == "3788131":
            continue
        keyword = _dealer_keyword_from_org_name(name)
        if len(keyword) < 4:
            continue
        if keyword in text:
            score = len(keyword)
            if score > best_score:
                best_score = score
                best_id = org_id
    return best_id
