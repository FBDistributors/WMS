from __future__ import annotations

import json
import os
import urllib.request
from urllib.parse import urljoin

from app.integrations.smartup.schemas import SmartupOrderExportResponse


class SmartupClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None) -> None:
        self.base_url = (base_url or os.getenv("SMARTUP_BASE_URL") or "").rstrip("/") + "/"
        self.api_key = api_key or os.getenv("SMARTUP_API_KEY")

    def export_orders(self, date_from: str, date_to: str, filial_code: str | None) -> SmartupOrderExportResponse:
        if not self.base_url:
            raise RuntimeError("SMARTUP_BASE_URL is not configured")
        if not self.api_key:
            raise RuntimeError("SMARTUP_API_KEY is not configured")

        url = urljoin(self.base_url, "b/trade/txs/tdeal/order$export")
        payload = {
            "date_from": date_from,
            "date_to": date_to,
            "filial_code": filial_code,
        }
        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

        # TODO: Confirm Smartup auth headers and request fields.
        request = urllib.request.Request(url, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
        return SmartupOrderExportResponse.parse_raw(body)
