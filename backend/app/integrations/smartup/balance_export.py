"""SmartUP balance$export — faqat bugungi kun qoldiq ma'lumotini yuklash."""

from __future__ import annotations

import base64
import json
import logging
import os
import urllib.error
import urllib.request
from datetime import date

logger = logging.getLogger(__name__)

DEFAULT_BALANCE_EXPORT_URL = "https://smartup.online/b/anor/mxsx/mkw/balance$export"


def fetch_balance_from_smartup(
    filial_id: str | None = None,
    warehouse_code: str | None = None,
) -> dict:
    """
    SmartUP balance$export ga POST so'rov yuborib, bugungi kun ma'lumotini oladi (to'liq yuklash).
    warehouse_code: "001" (qoldiq) yoki "002" (bron) — body da yuboriladi.
    Auth: SMARTUP_BASIC_USER, SMARTUP_BASIC_PASS, SMARTUP_PROJECT_CODE, SMARTUP_FILIAL_ID (boshqa API lar bilan bir xil).
    Qaytaradi: to'liq JSON javob (odatda {"balance": [...]}).
    """
    url = (os.getenv("SMARTUP_BALANCE_EXPORT_URL") or DEFAULT_BALANCE_EXPORT_URL).strip()
    project_code = (os.getenv("SMARTUP_PROJECT_CODE") or "trade").strip()
    header_filial = (filial_id or os.getenv("SMARTUP_FILIAL_ID") or "3788131").strip()
    username = (os.getenv("SMARTUP_BASIC_USER") or "").strip() or None
    password = (os.getenv("SMARTUP_BASIC_PASS") or "").strip() or None
    if not username or not password:
        raise RuntimeError(
            "SmartUP balance$export uchun SMARTUP_BASIC_USER va SMARTUP_BASIC_PASS ni to'ldiring."
        )

    today = date.today()
    date_str = today.strftime("%d.%m.%Y")
    wh_code = (warehouse_code or os.getenv("SMARTUP_BALANCE_WAREHOUSE_CODE") or "001").strip()

    payload = {
        "warehouse_codes": [{"warehouse_code": wh_code}],
        "filial_code": "",
        "begin_date": date_str,
        "end_date": date_str,
    }
    data = json.dumps(payload).encode("utf-8")
    credentials = f"{username}:{password}"
    basic_token = base64.b64encode(credentials.encode("utf-8")).decode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Basic {basic_token}",
        "project_code": project_code,
        "filial_id": header_filial,
    }

    logger.info("Smartup balance$export: url=%s sana=%s warehouse_code=%s", url.split("?")[0], date_str, wh_code)
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        response_text = exc.read().decode("utf-8")
        logger.error("Smartup balance$export HTTP %s: %s", exc.code, response_text)
        hint = ""
        if exc.code in (401, 481):
            hint = " SMARTUP_BASIC_USER, SMARTUP_BASIC_PASS, SMARTUP_PROJECT_CODE tekshiring."
        raise RuntimeError(f"Smartup balance$export failed: {response_text}{hint}") from exc
    except Exception as exc:
        logger.error("Smartup balance$export: %s", exc)
        raise RuntimeError(f"Smartup balance$export failed: {exc}") from exc

    return json.loads(body)
