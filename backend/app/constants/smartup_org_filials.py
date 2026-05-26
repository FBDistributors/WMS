"""SmartUP organizatsiya ID validatsiyasi (nomlar — faqat settings_organizations)."""

from __future__ import annotations


def is_smartup_org_filial_id(value: str | None) -> bool:
    k = (value or "").strip()
    return len(k) >= 7 and k.isdigit()


def normalize_smartup_org_filial_id(value: str | None) -> str | None:
    k = (value or "").strip()
    if is_smartup_org_filial_id(k):
        return k
    return None
