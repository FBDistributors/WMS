"""SmartUp mijoz qaytarishlari (mdeal/return$export) — tortish, parse, DB'ga upsert.

Har sinxronda oxirgi N kun (standart 30) tortiladi va `deal_id` bo'yicha
upsert qilinadi. Eski (>30 kun) yozuvlar saqlanadi (tarix uchun).
"""
from __future__ import annotations

import base64
import json
import logging
import os
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.integrations.smartup.client import SmartupClient
from app.models.smartup_return import SmartupReturn, SmartupReturnLine

logger = logging.getLogger(__name__)

# To'liq URL — env override (`SMARTUP_RETURN_EXPORT_URL`) yoki standart.
# WMS per-endpoint URL naqshini ishlatadi (SMARTUP_BASE_URL emas).
DEFAULT_RETURN_EXPORT_URL = "https://smartup.online/b/anor/mxsx/mdeal/return$export"


def _none(v: Any) -> Optional[str]:
    """SmartUp 'None' matnini va bo'shni haqiqiy None ga aylantiradi."""
    if v is None:
        return None
    s = str(v).strip()
    if not s or s.lower() == "none":
        return None
    return s


def _dec(v: Any) -> Optional[Decimal]:
    s = _none(v)
    if s is None:
        return None
    try:
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return None


def _parse_date(v: Any) -> Optional[date]:
    s = _none(v)
    if s is None:
        return None
    for fmt in ("%d.%m.%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.split(" ")[0], fmt).date()
        except ValueError:
            continue
    return None


def _parse_dt(v: Any) -> Optional[datetime]:
    s = _none(v)
    if s is None:
        return None
    for fmt in ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def fetch_returns_raw(days: int = 30, client: Optional[SmartupClient] = None) -> list[dict]:
    """return$export ni oxirgi `days` kun uchun chaqirib, xom qatorlar ro'yxatini qaytaradi."""
    client = client or SmartupClient()
    if not client.username or not client.password:
        raise RuntimeError("SMARTUP_BASIC_USER yoki SMARTUP_BASIC_PASS sozlanmagan")

    end = date.today()
    begin = end - timedelta(days=days)
    url = (os.getenv("SMARTUP_RETURN_EXPORT_URL") or DEFAULT_RETURN_EXPORT_URL).strip()

    payload = {
        "filial_codes": [{"filial_code": ""}],
        "filial_code": "",
        "external_id": "",
        "deal_id": "",
        "begin_return_date": begin.strftime("%d.%m.%Y"),
        "end_return_date": end.strftime("%d.%m.%Y"),
        "begin_created_on": "",
        "end_created_on": "",
        "begin_modified_on": "",
        "end_modified_on": "",
    }
    data = json.dumps(payload).encode("utf-8")
    token = base64.b64encode(f"{client.username}:{client.password}".encode("utf-8")).decode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Basic {token}",
        "project_code": client.project_code,
        "filial_id": client.filial_id,
    }
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8")
        logger.error("return$export HTTP %s: %s", exc.code, text[:300])
        raise RuntimeError(f"SmartUp return$export xatosi (HTTP {exc.code})") from exc

    parsed = json.loads(body)
    rows = parsed.get("return") if isinstance(parsed, dict) else None
    if not isinstance(rows, list):
        logger.warning("return$export: 'return' ro'yxati topilmadi (keys=%s)",
                       list(parsed.keys()) if isinstance(parsed, dict) else type(parsed))
        return []
    return rows


def sync_returns(db: Session, days: int = 30, client: Optional[SmartupClient] = None) -> dict:
    """Oxirgi `days` kun qaytarishlarini tortib, deal_id bo'yicha upsert qiladi.

    Qaytadi: {"fetched": N, "created": X, "updated": Y}.
    """
    rows = fetch_returns_raw(days=days, client=client)
    created = 0
    updated = 0
    for r in rows:
        deal_id = _none(r.get("deal_id"))
        if deal_id is None:
            continue
        existing = (
            db.query(SmartupReturn).filter(SmartupReturn.deal_id == deal_id).one_or_none()
        )
        if existing is None:
            doc = SmartupReturn(deal_id=deal_id)
            db.add(doc)
            created += 1
        else:
            doc = existing
            updated += 1
            # Qatorlarni qayta yuklaymiz (SmartUp'da o'zgargan bo'lishi mumkin);
            # wms_status saqlanadi.
            doc.lines.clear()
            db.flush()

        doc.order_deal_id = _none(r.get("order_deal_id"))
        doc.external_id = _none(r.get("external_id"))
        doc.return_date = _parse_date(r.get("booked_date"))
        doc.deal_time = _parse_dt(r.get("deal_time"))
        doc.person_code = _none(r.get("person_code"))
        doc.person_name = _none(r.get("person_name"))
        doc.person_tin = _none(r.get("person_tin"))
        doc.filial_code = _none(r.get("filial_code"))
        doc.return_reason_id = _none(r.get("return_reason_id"))
        doc.return_reason_code = _none(r.get("return_reason_code"))
        doc.sales_manager_code = _none(r.get("sales_manager_code"))
        doc.sales_manager_name = _none(r.get("sales_manager_name"))
        doc.total_amount = _dec(r.get("total_amount"))
        doc.currency_code = _none(r.get("currency_code"))
        doc.status = _none(r.get("status"))
        doc.note = _none(r.get("note"))
        doc.synced_at = datetime.now(timezone.utc)

        products = r.get("return_products") or []
        for i, p in enumerate(products if isinstance(products, list) else []):
            doc.lines.append(
                SmartupReturnLine(
                    product_code=_none(p.get("product_code")),
                    product_article_code=_none(p.get("product_article_code")),
                    product_name=_none(p.get("product_name")),
                    return_quant=_dec(p.get("return_quant")),
                    product_price=_dec(p.get("product_price")),
                    sold_amount=_dec(p.get("sold_amount")),
                    expiry_date=_none(p.get("expiry_date")),
                    serial_number=_none(p.get("serial_number")),
                    warehouse_code=_none(p.get("warehouse_code")),
                    action_name=_none(p.get("action_name")),
                    line_no=i + 1,
                )
            )

    db.commit()
    result = {"fetched": len(rows), "created": created, "updated": updated}
    logger.info("SmartUp returns sync: %s", result)
    return result
