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


def resolve_org_display(
    filial_id: str | None,
    name_map: dict[str, str],
    *,
    to_warehouse_code: str | None = None,
) -> str | None:
    """filial_id (SmartUP to_filial_code) bo'yicha nom; zaxira: to_warehouse_code."""
    for key in (filial_id, to_warehouse_code):
        if key is None:
            continue
        k = str(key).strip()
        if not k:
            continue
        hit = name_map.get(k)
        if hit:
            return hit
    return None
