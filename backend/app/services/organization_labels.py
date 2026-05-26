"""Resolve organization display names from settings_organizations."""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.constants.smartup_org_filials import is_smartup_org_filial_id, normalize_smartup_org_filial_id
from app.models.settings_organization import SettingsOrganization as SettingsOrganizationModel

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
        if is_smartup_org_filial_id(k):
            keys.append(k)
    return keys


def _normalize_note_text(note: str | None) -> str:
    t = (note or "").strip().lower()
    t = t.replace("ё", "е")
    return re.sub(r"\s+", " ", t)


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


def _note_contains_token(text: str, token: str) -> bool:
    if token in text:
        return True
    for lat, cyr in _LATIN_TO_CYR_FRAGMENTS.items():
        if token == cyr and lat in text:
            return True
        if token == lat and cyr in text:
            return True
    return False


def resolve_org_filial_id_from_note(
    note: str | None,
    name_map: dict[str, str],
) -> str | None:
    """
    Izoh → settings_organizations.org_id (nom bo'yicha, qattiq ro'yxat emas).
  """
    text = _normalize_note_text(note)
    if not text or not name_map:
        return None

    best_id: str | None = None
    best_score = 0

    for org_id, name in name_map.items():
        for token in _match_tokens_from_org_name(name):
            if _note_contains_token(text, token):
                score = len(token)
                if score > best_score:
                    best_score = score
                    best_id = org_id

    if best_id:
        return best_id

    for lat, cyr in _LATIN_TO_CYR_FRAGMENTS.items():
        if len(lat) < 4 or lat not in text:
            continue
        for org_id, name in name_map.items():
            if cyr in name.lower():
                if len(lat) > best_score:
                    best_score = len(lat)
                    best_id = org_id
    return best_id


def resolve_org_display(
    filial_id: str | None,
    name_map: dict[str, str],
    *,
    to_filial_code: str | None = None,
    to_warehouse_code: str | None = None,
    movement_note: str | None = None,
) -> str | None:
    """SmartUP org ID yoki izoh → settings_organizations nomi."""
    _ = to_warehouse_code
    for key in _org_lookup_keys(filial_id, to_filial_code):
        hit = name_map.get(key)
        if hit:
            return hit
    inferred_id = resolve_org_filial_id_from_note(movement_note, name_map)
    if inferred_id:
        return name_map.get(inferred_id)
    return None
