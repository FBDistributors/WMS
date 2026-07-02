"""Smartup → Uzum Market qoldiq sinxronizatsiyasi (masking bilan).

Oqim:
  1. Smartup balance$export dan 001 (qoldiq) va 002 (bron) omborlari tortiladi.
  2. Sotuvga yaroqli qoldiq = 001 − 002 (product_code bo'yicha yig'ilgan).
  3. Masking: qoldiq >= UZUM_STOCK_CAP (default 30) bo'lsa CAP, aks holda 0 —
     haqiqiy qoldiq Uzumga hech qachon yuborilmaydi.
  4. product_code → barcode: WMS products jadvali orqali (Smartupdan sinxronlangan).
  5. Uzumdagi joriy qiymatdan farq qilgan SKU largina POST /v2/fbs/sku/stocks ga yuboriladi.

Xavfsizlik: Smartup so'rovi xato bersa yoki balans bo'sh kelsa sinxronizatsiya
to'xtaydi — Uzumga hech narsa yuborilmaydi (hammani 0 qilib yubormaslik uchun).
"""

from __future__ import annotations

import logging
import os
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import SessionLocal
from app.integrations.smartup.balance_export import fetch_balance_from_smartup
from app.integrations.smartup.filial_list import get_filial_ids
from app.integrations.uzum.client import UzumSellerClient
from app.models.product import Product

logger = logging.getLogger(__name__)

WAREHOUSE_STOCK = "001"
WAREHOUSE_RESERVED = "002"


def _stock_cap() -> int:
    try:
        return max(1, int(os.getenv("UZUM_STOCK_CAP", "30")))
    except ValueError:
        return 30


def masked_amount(available: float, cap: int) -> int:
    """Haqiqiy qoldiqni yashiruvchi qiymat: >= cap bo'lsa cap, aks holda 0."""
    return cap if available >= cap else 0


def _fetch_balance_rows(warehouse_code: str) -> list[dict[str, Any]]:
    """Smartup balansini oladi. UZUM_BALANCE_FILIAL_ID: bo'sh = default filial, 'all' = hammasi."""
    fid_param = (os.getenv("UZUM_BALANCE_FILIAL_ID") or "").strip()
    if fid_param.lower() == "all":
        rows: list[dict[str, Any]] = []
        for fid in get_filial_ids():
            part = fetch_balance_from_smartup(fid, warehouse_code)
            rows.extend(part.get("balance") or [])
        return rows
    part = fetch_balance_from_smartup(fid_param or None, warehouse_code)
    return part.get("balance") or []


def _aggregate_by_product_code(rows: list[dict[str, Any]]) -> dict[str, float]:
    """Balans qatorlarini (partiyalar bo'yicha bo'lingan) product_code bo'yicha yig'adi."""
    totals: dict[str, float] = {}
    for row in rows:
        code = str(row.get("product_code") or row.get("code") or "").strip()
        if not code:
            continue
        try:
            qty = float(row.get("quantity") or 0)
        except (TypeError, ValueError):
            qty = 0.0
        totals[code] = totals.get(code, 0.0) + qty
    return totals


def _barcodes_by_product_code(db: Session, codes: set[str]) -> dict[str, list[str]]:
    """WMS products jadvalidan product_code (sku) → barcha barcode lar."""
    if not codes:
        return {}
    result: dict[str, list[str]] = {}
    products = (
        db.execute(
            select(Product)
            .options(selectinload(Product.barcodes))
            .where(Product.sku.in_(codes), Product.is_active.is_(True))
        )
        .scalars()
        .all()
    )
    for product in products:
        barcodes: list[str] = []
        if product.barcode:
            barcodes.append(product.barcode.strip())
        for extra in product.barcodes:
            value = (extra.barcode or "").strip()
            if value and value not in barcodes:
                barcodes.append(value)
        if barcodes:
            result[product.sku] = barcodes
    return result


def run_uzum_stock_sync(dry_run: bool = False) -> dict[str, Any]:
    """Bitta sinxronizatsiya sikli. Natija: hisobot dict (log/endpoint uchun)."""
    cap = _stock_cap()

    # 1-2. Smartup: qoldiq va bron (xato bo'lsa exception — Uzumga hech narsa ketmaydi)
    stock_rows = _fetch_balance_rows(WAREHOUSE_STOCK)
    if not stock_rows:
        raise RuntimeError("Smartup balance (001) bo'sh keldi — sinxronizatsiya bekor qilindi.")
    reserved_rows = _fetch_balance_rows(WAREHOUSE_RESERVED)

    stock_totals = _aggregate_by_product_code(stock_rows)
    reserved_totals = _aggregate_by_product_code(reserved_rows)
    available: dict[str, float] = {
        code: max(qty - reserved_totals.get(code, 0.0), 0.0) for code, qty in stock_totals.items()
    }
    # Faqat bronda ko'ringan (001 da yo'q) mahsulotlar — qoldiq 0
    for code in reserved_totals:
        available.setdefault(code, 0.0)

    # 3. Masking — barcode bo'yicha yuboriladigan qiymat
    desired_by_code = {code: masked_amount(qty, cap) for code, qty in available.items()}

    # 4. product_code → barcode (WMS DB)
    db = SessionLocal()
    try:
        barcode_map = _barcodes_by_product_code(db, set(desired_by_code))
    finally:
        db.close()

    desired_by_barcode: dict[str, int] = {}
    for code, amount in desired_by_code.items():
        for barcode in barcode_map.get(code, []):
            desired_by_barcode[barcode] = max(desired_by_barcode.get(barcode, 0), amount)

    # 5. Uzumdagi joriy holat bilan solishtirish
    client = UzumSellerClient()
    uzum_skus = client.get_fbs_sku_stocks()
    uzum_by_barcode: dict[str, dict[str, Any]] = {}
    for sku in uzum_skus:
        barcode = str(sku.get("barcode") or "").strip()
        if barcode:
            uzum_by_barcode[barcode] = sku

    updates: list[dict[str, Any]] = []
    unmatched_uzum: list[str] = []
    for barcode, sku in uzum_by_barcode.items():
        if barcode in desired_by_barcode:
            desired = desired_by_barcode[barcode]
            current = sku.get("amount")
            if current != desired:
                updates.append({"barcode": barcode, "amount": desired})
        else:
            # Uzumda bor, lekin Smartup balansida umuman ko'rinmadi → 0 ga tushiramiz
            unmatched_uzum.append(barcode)
            if sku.get("amount") != 0:
                updates.append({"barcode": barcode, "amount": 0})

    matched = sum(1 for b in uzum_by_barcode if b in desired_by_barcode)

    summary: dict[str, Any] = {
        "cap": cap,
        "dry_run": dry_run,
        "smartup_products": len(available),
        "uzum_skus": len(uzum_by_barcode),
        "matched": matched,
        "unmatched_uzum_barcodes": unmatched_uzum[:50],
        "unmatched_uzum_count": len(unmatched_uzum),
        "updates_needed": len(updates),
        "updates": updates[:200],
        "sent": 0,
    }

    if dry_run or not updates:
        logger.info(
            "Uzum stock sync (dry_run=%s): matched=%d updates_needed=%d unmatched_uzum=%d",
            dry_run, matched, len(updates), len(unmatched_uzum),
        )
        return summary

    # 6. Yuborish
    client.update_fbs_sku_stocks(updates)
    summary["sent"] = len(updates)
    logger.info(
        "Uzum stock sync: sent=%d matched=%d unmatched_uzum=%d cap=%d",
        len(updates), matched, len(unmatched_uzum), cap,
    )
    return summary
