"""Uzum Market seller openapi klienti (FBS/DBS qoldiqlarni o'qish va yangilash).

Auth: `Authorization` header'ida token (Bearer prefiksisiz) — UZUM_API_TOKEN.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api-seller.uzum.uz/api/seller-openapi"

MAX_ATTEMPTS = 4
BACKOFF_BASE_SEC = 2
MAX_DETAIL_LEN = 300

# POST /v2/fbs/sku/stocks bitta so'rovda yuboriladigan maksimal SKU soni
STOCK_UPDATE_BATCH_SIZE = 100


class UzumApiError(RuntimeError):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class UzumSellerClient:
    def __init__(self, base_url: str | None = None, token: str | None = None) -> None:
        self.base_url = (base_url or os.getenv("UZUM_API_BASE_URL") or DEFAULT_BASE_URL).strip().rstrip("/")
        self.token = (token or os.getenv("UZUM_API_TOKEN") or "").strip() or None

    def _request(self, method: str, path: str, *, query: dict | None = None, body: dict | None = None) -> dict:
        if not self.token:
            raise RuntimeError("UZUM_API_TOKEN is not configured")

        url = f"{self.base_url}{path}"
        if query:
            url += "?" + urllib.parse.urlencode(query)
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {
            "Accept": "application/json",
            "Authorization": self.token,
        }
        if data is not None:
            headers["Content-Type"] = "application/json"

        last_error: Exception | None = None
        last_detail: str | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            request = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=90) as response:
                    raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as exc:
                last_error = exc
                try:
                    last_detail = exc.read().decode("utf-8")
                except Exception:
                    last_detail = str(exc)
                logger.warning(
                    "Uzum API %s %s attempt %d/%d failed (HTTP %s): %s",
                    method, path, attempt, MAX_ATTEMPTS, exc.code,
                    (last_detail or "")[:MAX_DETAIL_LEN],
                )
                # 4xx — takrorlash foydasiz (auth/validatsiya), darhol xato
                if 400 <= exc.code < 500:
                    hint = " UZUM_API_TOKEN ni tekshiring." if exc.code in (401, 403) else ""
                    raise UzumApiError(
                        f"Uzum API {method} {path} failed (HTTP {exc.code}): "
                        f"{(last_detail or '')[:MAX_DETAIL_LEN]}{hint}",
                        status=exc.code,
                    ) from exc
            except (urllib.error.URLError, OSError, ConnectionError) as exc:
                last_error = exc
                logger.warning(
                    "Uzum API %s %s attempt %d/%d connection error: %s",
                    method, path, attempt, MAX_ATTEMPTS, exc,
                )
            if attempt < MAX_ATTEMPTS:
                time.sleep(BACKOFF_BASE_SEC ** attempt)

        detail = f": {(last_detail or str(last_error))[:MAX_DETAIL_LEN]}" if (last_detail or last_error) else ""
        raise UzumApiError(
            f"Uzum API {method} {path} failed after {MAX_ATTEMPTS} attempts{detail}"
        ) from last_error

    def get_shops(self) -> list[dict[str, Any]]:
        """GET /v1/shops — do'konlar ro'yxati. Token to'g'riligini tekshirish uchun ham qulay."""
        resp = self._request("GET", "/v1/shops")
        payload = resp.get("payload")
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            return payload.get("shops") or []
        return []

    def get_fbs_sku_stocks(self) -> list[dict[str, Any]]:
        """GET /v3/fbs/sku/stocks — barcha SKU larni sahifalab yig'ib qaytaradi."""
        items: list[dict[str, Any]] = []
        page = 0
        size = 100
        while True:
            resp = self._request("GET", "/v3/fbs/sku/stocks", query={"page": page, "size": size})
            payload = resp.get("payload") or {}
            batch = payload.get("skuAmountList") or []
            items.extend(batch)
            if len(batch) < size:
                break
            page += 1
            if page > 1000:  # himoya: cheksiz sahifalashdan
                raise RuntimeError("Uzum SKU stocks pagination exceeded 1000 pages")
        return items

    def update_fbs_sku_stocks(
        self, sku_amount_list: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """POST /v2/fbs/sku/stocks — {barcode, amount} ro'yxatini batch'lab yuboradi.

        Uzum validatsiyasi (HTTP 400) butun paketni rad etadi; bunda paket ikkiga
        bo'linib qayta yuboriladi — yaroqsiz SKU lar ajratilib, qolganlari o'tadi.
        Qaytaradi: (muvaffaqiyatli javoblar, yiqilgan elementlar [{barcode, error}]).
        """
        results: list[dict[str, Any]] = []
        failed: list[dict[str, Any]] = []

        def send_or_split(items: list[dict[str, Any]]) -> None:
            try:
                resp = self._request("POST", "/v2/fbs/sku/stocks", body={"skuAmountList": items})
            except UzumApiError as exc:
                if exc.status == 400 and len(items) > 1:
                    mid = len(items) // 2
                    send_or_split(items[:mid])
                    send_or_split(items[mid:])
                    return
                if exc.status == 400:
                    failed.append({"barcode": items[0].get("barcode"), "error": str(exc)[:MAX_DETAIL_LEN]})
                    return
                raise
            payload = resp.get("payload") or {}
            results.extend(payload.get("skuAmountList") or [])

        for i in range(0, len(sku_amount_list), STOCK_UPDATE_BATCH_SIZE):
            send_or_split(sku_amount_list[i : i + STOCK_UPDATE_BATCH_SIZE])
        return results, failed
