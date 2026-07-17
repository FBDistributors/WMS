"""Resolve organization display names from settings_organizations."""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.constants.smartup_org_filials import is_smartup_org_filial_id, normalize_smartup_org_filial_id
from app.models.order import Order
from app.models.settings_organization import SettingsOrganization as SettingsOrganizationModel

# SmartUp so'rov header filiali — manzil tashkiloti emas.
_IGNORE_FILIAL_IDS_FOR_LOOKUP = frozenset({"3788131"})

# Izohdagi latin shahar tokenlari → kirill (settings nomi bilan solishtirish).
_LATIN_TO_CYR_FRAGMENTS: dict[str, str] = {
    "fargona": "фергана",
    "fergana": "фергана",
    "termiz": "термез",
    "jizzax": "жиззах",
    "jizax": "жиззах",
    "qarshi": "карши",
    "karshi": "карши",
    "namangan": "наманган",
    "samarkand": "самарканд",
    "samarqand": "самарканд",
    "bukhara": "бухара",
    "buxoro": "бухара",
    "andijan": "андижан",
    "kokand": "коканд",
    "navoiy": "навоий",
    "navoi": "навоий",
    "xorezm": "хорезм",
    "urikzor": "урикзор",
    "yangiyul": "янгиюль",
    "ippodrom": "ипподром",
    "nukus": "нукус",
    "munav": "мунав",
    "gayrat": "гайрат",
    "tavakal": "тавакал",
}


def load_org_name_map(db: Session) -> dict[str, str]:
    rows = db.query(SettingsOrganizationModel.org_id, SettingsOrganizationModel.name).all()
    out: dict[str, str] = {}
    for org_id, name in rows:
        oid = (org_id or "").strip()
        if not oid:
            continue
        label = (name or "").strip()
        if label:
            out[oid] = label
    return out


def _org_lookup_keys(
    filial_id: str | None,
    to_filial_code: str | None,
) -> list[str]:
    """Ombor kodi (001) emas, faqat organizatsiya ID (odatda 7+ raqam)."""
    keys: list[str] = []
    for raw in (to_filial_code, filial_id):
        if raw is None:
            continue
        k = str(raw).strip()
        if not k or k in keys:
            continue
        if is_smartup_org_filial_id(k) and k not in _IGNORE_FILIAL_IDS_FOR_LOOKUP:
            keys.append(k)
    return keys


def _normalize_note_text(note: str | None) -> str:
    t = (note or "").strip().lower()
    t = t.replace("ё", "е")
    t = re.sub(r"[.\u2010-\u2015-]+", " ", t)
    return re.sub(r"\s+", " ", t)


def _normalize_match_text(value: str) -> str:
    return _normalize_note_text(value)


def _dealer_keyword_from_org_name(name: str) -> str:
    n = (name or "").strip().lower()
    m = re.search(r"дилер\s+([^()]+)", n, flags=re.IGNORECASE)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()
    return n


def _match_tokens_from_org_name(name: str) -> list[str]:
    """Settings dagi nomdan izoh bilan solishtiriladigan tokenlar."""
    tokens: list[str] = []
    seen: set[str] = set()

    def add(tok: str) -> None:
        t = tok.strip().lower()
        if len(t) < 3 or t in seen:
            return
        seen.add(t)
        tokens.append(t)

    kw = _dealer_keyword_from_org_name(name)
    if len(kw) >= 3:
        add(kw)
    for m in re.finditer(r"\(([^)]+)\)", name):
        inner = m.group(1).strip().lower()
        for w in re.findall(r"[a-zа-яё]+", inner):
            if len(w) >= 3:
                add(w)
    for w in re.findall(r"[a-zа-яё]+", name.lower()):
        if w in ("дилер", "проф", "prof", "new", "старый", "old"):
            continue
        if len(w) >= 4:
            add(w)
    return tokens


def _token_match_variants(token: str) -> list[str]:
    base = _normalize_match_text(token)
    if not base:
        return []
    variants = [base]
    if "обл" in base and "област" not in base:
        variants.append(base.replace("обл", "область"))
    if "област" in base:
        variants.append(base.replace("область", "обл").replace("област", "обл"))
    return list(dict.fromkeys(variants))


def _note_contains_token(text: str, token: str) -> bool:
    for variant in _token_match_variants(token):
        if variant in text:
            return True
    for lat, cyr in _LATIN_TO_CYR_FRAGMENTS.items():
        norm_lat = _normalize_match_text(lat)
        norm_cyr = _normalize_match_text(cyr)
        if _normalize_match_text(token) in (norm_lat, norm_cyr):
            if norm_lat in text or norm_cyr in text:
                return True
    return False


def _parenthetical_tokens(note: str | None) -> list[str]:
    tokens: list[str] = []
    for m in re.finditer(r"\(([^)]+)\)", note or ""):
        for w in re.findall(r"[a-zа-яё]+", m.group(1).lower()):
            if len(w) >= 4:
                tokens.append(w)
    return tokens


def _best_org_match_from_note(
    note: str | None,
    name_map: dict[str, str],
) -> tuple[str | None, str | None]:
    """(org_id, display_name) — eng yaxshi mos settings qatori."""
    text = _normalize_note_text(note)
    if not text or not name_map:
        return None, None
    paren_tokens = _parenthetical_tokens(note)
    best_id: str | None = None
    best_name: str | None = None
    best_score = 0
    for org_id, name in name_map.items():
        name_l = _normalize_match_text(name)
        for paren in paren_tokens:
            if paren in name_l:
                score = len(paren) + 20
                if score > best_score:
                    best_score = score
                    best_id = org_id
                    best_name = name
        for token in _match_tokens_from_org_name(name):
            if _note_contains_token(text, token):
                score = len(token)
                if score > best_score:
                    best_score = score
                    best_id = org_id
                    best_name = name
    if best_id:
        return best_id, best_name
    for lat, cyr in _LATIN_TO_CYR_FRAGMENTS.items():
        if len(lat) < 4 or lat not in text:
            continue
        for org_id, name in name_map.items():
            if cyr in _normalize_match_text(name):
                if len(lat) > best_score:
                    best_score = len(lat)
                    best_id = org_id
                    best_name = name
    return best_id, best_name


def resolve_org_filial_id_from_note(
    note: str | None,
    name_map: dict[str, str],
) -> str | None:
    """Izoh → settings_organizations.org_id."""
    org_id, _ = _best_org_match_from_note(note, name_map)
    return org_id


def reconcile_diller_orders_filial_from_settings(db: Session) -> int:
    """Mavjud diller buyurtmalarga settings org_id (izoh/to_filial bo'yicha) yozadi."""
    name_map = load_org_name_map(db)
    if not name_map:
        return 0
    rows = db.query(Order).filter(Order.source == "diller").all()
    updated = 0
    for order in rows:
        before = (order.to_filial_code or order.filial_id or "").strip()
        # Faqat haqiqiy org_id (to_filial_code/filial_id) normalizatsiya qilinadi.
        # Izohdan fuzzy-taxmin ATAYLAB ishlatilmaydi — u haqiqiy org_id ni noto'g'ri
        # tashkilotga almashtirib qo'yardi (masalan Бухара -> Хорезм). Endi hech qachon
        # almashtirilmaydi; org_id topilmasa order o'z holicha qoladi.
        org_id = normalize_smartup_org_filial_id(order.to_filial_code) or normalize_smartup_org_filial_id(
            order.filial_id
        )
        if org_id in _IGNORE_FILIAL_IDS_FOR_LOOKUP:
            org_id = None
        if org_id and org_id != before:
            order.to_filial_code = org_id
            order.filial_id = org_id
            updated += 1
    if updated:
        db.commit()
    return updated


def resolve_org_display(
    filial_id: str | None,
    name_map: dict[str, str],
    *,
    to_filial_code: str | None = None,
    to_warehouse_code: str | None = None,
    movement_note: str | None = None,
) -> str | None:
    """Tashkiliy harakat: settings_organizations dan faqat ID (org_id) orqali nom.

    Izohdan fuzzy-taxmin ATAYLAB ishlatilmaydi — noto'g'ri tashkilotni tanlab
    qo'yardi. ID topilmasa None (mijoz nomi bo'sh turadi).
    """
    _ = to_warehouse_code
    _ = movement_note
    for key in _org_lookup_keys(filial_id, to_filial_code):
        hit = name_map.get(key)
        if hit:
            return hit
    return None
