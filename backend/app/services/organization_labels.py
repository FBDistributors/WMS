"""Resolve organization display names from settings_organizations."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.settings_organization import SettingsOrganization as SettingsOrganizationModel


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
        if len(k) >= 7 and k.isdigit():
            keys.append(k)
    return keys


def resolve_org_display(
    filial_id: str | None,
    name_map: dict[str, str],
    *,
    to_filial_code: str | None = None,
    to_warehouse_code: str | None = None,
) -> str | None:
    """SmartUP to_filial_code (organizatsiya ID) bo'yicha nom."""
    _ = to_warehouse_code
    for key in _org_lookup_keys(filial_id, to_filial_code):
        hit = name_map.get(key)
        if hit:
            return hit
    return None
