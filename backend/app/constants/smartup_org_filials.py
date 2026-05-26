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


def _normalize_note_text(note: str | None) -> str:
    t = (note or "").strip().lower()
    t = t.replace("ё", "е")
    return re.sub(r"\s+", " ", t)


def _dealer_keyword_from_org_name(name: str) -> str:
    """«Дилер Таш обл (Мейрлан) Проф» → «таш обл»."""
    n = (name or "").strip().lower()
    m = re.search(r"дилер\s+([^()]+)", n, flags=re.IGNORECASE)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()
    return n


# Izohdagi shahar / xodim tokenlari (latin + kirill). Uzunroq alias ustun.
ORG_NOTE_ALIAS_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("8109116", ("munavvar", "munav", "мунаввар", "мунав")),
    ("8109106", ("sherdil", "шердил")),
    ("8109117", ("ildar prof", "ildar", "илдар")),
    ("8109115", ("izzatullo", "иззатулло")),
    ("8109109", ("andrey", "андрей")),
    ("8109113", ("ural", "урал", "нукус урал")),
    ("3964966", ("ippodrom", "ипподром")),
    ("8109104", ("таш обл", "tash obl", "мейрлан", "meйрлан", "meirlan")),
    ("8109098", ("таш.област", "tash.oblast", "ilhom", "илхом")),
    ("8109099", ("urikzor", "urikzor", "урикзор")),
    ("8109110", ("qarshi", "karshi", "карши")),
    ("8109111", ("termiz", "термез", "gayrat", "гайрат")),
    ("8109101", ("fargona", "fergana", "фергана", "tavakal", "тавакал")),
    ("8109103", ("namangan", "наманган")),
    ("8109102", ("andijan", "andijan", "андижан")),
    ("8109107", ("samarkand", "samarqand", "самарканд")),
    ("8109108", ("bukhara", "buxoro", "бухара")),
    ("8109109", ("nukus andrey",)),
    ("8109113", ("nukus ural",)),
    ("8109105", ("kokand", "коканд", "kamolov")),
    ("8109114", ("navoiy", "navoi", "навоий")),
    ("8109112", ("xorezm", "xorezm", "хорезм", "mansur", "мансур")),
    ("8109100", ("yangiyul", "yangiul", "янгиюль", "нодира")),
    ("8109116", ("jizzax", "jizax", "жиззах")),
]

# Bir nechta filial bir shaharda — barcha tokenlar izohda bo'lishi kerak.
ORG_NOTE_DISAMBIG_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("8109116", ("jizzax", "munav")),
    ("8109116", ("jizax", "munav")),
    ("8109106", ("jizzax", "sherdil")),
    ("8109106", ("jizax", "sherdil")),
    ("8109110", ("qarshi", "ulug")),
    ("8109110", ("karshi", "ulug")),
    ("8109099", ("urikzor", "ulug")),
    ("8109099", ("urikzor", "ulug")),
]


def _match_org_from_note_aliases(text: str) -> str | None:
    for org_id, required in ORG_NOTE_DISAMBIG_RULES:
        if org_id == "3788131":
            continue
        if all(tok in text for tok in required):
            return org_id
    best_id: str | None = None
    best_score = 0
    flat: list[tuple[str, str, int]] = []
    for org_id, aliases in ORG_NOTE_ALIAS_RULES:
        if org_id == "3788131":
            continue
        for alias in aliases:
            a = alias.strip().lower()
            if len(a) >= 4:
                flat.append((org_id, a, len(a)))
    flat.sort(key=lambda x: x[2], reverse=True)
    for org_id, alias, score in flat:
        if alias in text and score > best_score:
            best_score = score
            best_id = org_id
    return best_id


def _match_org_from_dealer_phrase(text: str) -> str | None:
    if not any(x in text for x in ("дилер", "diler", "накопительный", "nakopitel")):
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


def resolve_org_filial_id_from_note(note: str | None) -> str | None:
    """
    SmartUP movement note → org ID.
    «Заказ Дилер …», «Накопительный Дилер …», «XAYITLIK FARGONA …» va hokazo.
    """
    text = _normalize_note_text(note)
    if not text:
        return None
    return (
        _match_org_from_dealer_phrase(text)
        or _match_org_from_note_aliases(text)
    )
