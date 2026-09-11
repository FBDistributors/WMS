"""Diller sanovini Smartup qoldig'i bilan solishtirish.

Diller Smartup'da filial (`settings_organizations.org_id`), `balance$export`
esa filial + ombor kodi (`smartup_warehouse_code`, masalan `wh30`) talab qiladi.
Sinov (2026-09-11, Samarqand): javobda `product_code` bizning SKU bilan 100%
mos keladi, muddat (`expiry_date`) esa dillerda hech qachon yo'q — shuning uchun
solishtirish faqat SKU darajasida, partiyalar va muddatlar yig'iladi.

Bugungi javob diskda keshlanadi (mavjud `balance_disk_cache`), `refresh` bilan
qayta so'raladi — Smartup API'ga ortiqcha yuk bermaslik uchun.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.integrations.smartup.balance_disk_cache import (
    cache_loaded_at,
    read_balance_cache,
    write_balance_cache,
)
from app.integrations.smartup.balance_export import fetch_balance_from_smartup
from app.models.dealer_stock_count import DealerStockCount
from app.models.product import Product as ProductModel
from app.models.settings_organization import SettingsOrganization

NO_WAREHOUSE_CODE_DETAIL = (
    "Diller uchun Smartup ombor kodi kiritilmagan — Sozlamalar → Organizatsiya bo'limida "
    "to'ldiring (masalan wh30)"
)


def _to_float(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def aggregate_balance_by_sku(rows: list[dict]) -> dict[str, float]:
    """Smartup qatorlari (partiya darajasida) → SKU bo'yicha jami dona."""
    out: dict[str, float] = {}
    for r in rows:
        code = str(r.get("product_code") or "").strip()
        if not code:
            continue
        out[code] = out.get(code, 0.0) + _to_float(r.get("quantity"))
    return out


def build_compare_rows(
    counted: dict[str, float],
    smartup: dict[str, float],
    names: dict[str, str],
) -> list[dict]:
    """Ikki tomon birlashmasi: sanaldi / Smartup / farq. Katta farq yuqorida."""
    skus = set(counted) | set(smartup)
    rows: list[dict] = []
    for sku in skus:
        c = counted.get(sku, 0.0)
        s = smartup.get(sku, 0.0)
        rows.append(
            {
                "sku": sku,
                "product_name": names.get(sku),
                "counted": c,
                "smartup": s,
                "diff": c - s,
                "only_in": "count" if sku not in smartup else ("smartup" if sku not in counted else None),
            }
        )
    rows.sort(key=lambda r: (-abs(r["diff"]), r["sku"]))
    return rows


def compare_dealer_count(db: Session, item: DealerStockCount, *, refresh: bool) -> dict:
    org = (
        db.query(SettingsOrganization)
        .filter(SettingsOrganization.org_id == item.dealer_org_id)
        .one_or_none()
    )
    wh = (org.smartup_warehouse_code or "").strip() if org else ""
    if not wh:
        raise HTTPException(status_code=400, detail=NO_WAREHOUSE_CODE_DETAIL)

    today = date.today().isoformat()
    payload: Optional[dict] = None if refresh else read_balance_cache(today, wh, item.dealer_org_id)
    source = "cache"
    if payload is None:
        try:
            payload = fetch_balance_from_smartup(item.dealer_org_id, wh)
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        try:
            write_balance_cache(today, wh, item.dealer_org_id, payload)
        except OSError:
            pass
        source = "live"
    balance_rows = payload.get("balance", []) if isinstance(payload, dict) else []
    smartup = aggregate_balance_by_sku(balance_rows if isinstance(balance_rows, list) else [])

    # Sanov qatorlari → SKU bo'yicha (muddatlar yig'iladi); tanilmaganlar solishtirilmaydi.
    pids = {ln.product_id for ln in item.lines if ln.product_id}
    products = (
        {p.id: p for p in db.query(ProductModel).filter(ProductModel.id.in_(pids)).all()}
        if pids
        else {}
    )
    counted: dict[str, float] = {}
    names: dict[str, str] = {}
    unknown_lines = 0
    for ln in item.lines:
        p = products.get(ln.product_id) if ln.product_id else None
        if not p:
            unknown_lines += 1
            continue
        counted[p.sku] = counted.get(p.sku, 0.0) + float(Decimal(str(ln.qty)))
        names[p.sku] = p.name
    # Smartup'da bor, sanovda yo'q mahsulotlarning nomi bizning katalogdan.
    missing = [s for s in smartup if s not in names]
    if missing:
        for p in db.query(ProductModel).filter(ProductModel.sku.in_(missing)).all():
            names[p.sku] = p.name

    rows = build_compare_rows(counted, smartup, names)
    loaded_at = cache_loaded_at(today, wh, item.dealer_org_id) if source == "cache" else None
    return {
        "dealer_org_id": item.dealer_org_id,
        "warehouse_code": wh,
        "source": source,
        "balance_date": today,
        "loaded_at": loaded_at or datetime.now(timezone.utc).isoformat(),
        "unknown_lines": unknown_lines,
        "totals": {
            "counted": sum(counted.values()),
            "smartup": sum(smartup.values()),
            "diff": sum(counted.values()) - sum(smartup.values()),
            "only_in_count": sum(1 for r in rows if r["only_in"] == "count"),
            "only_in_smartup": sum(1 for r in rows if r["only_in"] == "smartup"),
            "rows": len(rows),
        },
        "rows": rows,
    }
