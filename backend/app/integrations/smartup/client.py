from __future__ import annotations

import base64
import json
import logging
import os
import time
import urllib.error
import urllib.request
from urllib.parse import urljoin

from app.integrations.smartup.schemas import SmartupOrderExportResponse


logger = logging.getLogger(__name__)


class SmartupClient:
    def __init__(
        self,
        base_url: str | None = None,
        username: str | None = None,
        password: str | None = None,
        project_code: str | None = None,
        filial_id: str | None = None,
    ) -> None:
        self.base_url = (base_url or os.getenv("SMARTUP_BASE_URL") or "").strip()
        self.username = (username or os.getenv("SMARTUP_BASIC_USER") or "").strip() or None
        self.password = (password or os.getenv("SMARTUP_BASIC_PASS") or "").strip() or None
        self.project_code = (project_code or os.getenv("SMARTUP_PROJECT_CODE", "trade")).strip()
        self.filial_id = (filial_id or os.getenv("SMARTUP_FILIAL_ID", "3788131")).strip()

    def export_orders(
        self,
        begin_deal_date: str,
        end_deal_date: str,
        filial_code: str | None,
        export_url: str | None = None,
    ) -> SmartupOrderExportResponse:
        if export_url and export_url.strip():
            url = export_url.strip()
        elif not self.base_url:
            raise RuntimeError("SMARTUP_BASE_URL is not configured")
        else:
            if not self.username or not self.password:
                raise RuntimeError("SMARTUP_BASIC_USER or SMARTUP_BASIC_PASS is not configured")
            raw_base = self.base_url.rstrip("/")
            if "order$export" in raw_base or "movement$export" in raw_base:
                url = raw_base
            else:
                url = urljoin(f"{raw_base}/", "b/trade/txs/tdeal/order$export")
        if not self.username or not self.password:
            raise RuntimeError("SMARTUP_BASIC_USER or SMARTUP_BASIC_PASS is not configured")
        # Pass filial_code only when explicitly provided. SmartUp may return 400 "org not found"
        # if we pass 3788131 in payload - so we import all, then filter by filial in our API.
        normalized_filial_code = (filial_code or "").strip()
        payload = {
            "filial_codes": [{"filial_code": normalized_filial_code}] if normalized_filial_code else [{"filial_code": ""}],
            "filial_code": normalized_filial_code or "",
            "external_id": "",
            "deal_id": "",
            "status": "B#S",
            "begin_deal_date": begin_deal_date,
            "end_deal_date": end_deal_date,
            "delivery_date": "",
            "begin_created_on": "",
            "end_created_on": "",
            "begin_modified_on": "",
            "end_modified_on": "",
        }
        data = json.dumps(payload).encode("utf-8")
        credentials = f"{self.username}:{self.password}"
        basic_token = base64.b64encode(credentials.encode("utf-8")).decode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Basic {basic_token}",
            "project_code": self.project_code,
            "filial_id": self.filial_id,
        }

        # TODO: Confirm Smartup timeout and retry policies with ERP vendor.
        last_error: Exception | None = None
        last_detail: str | None = None
        for attempt in range(1, 4):
            request = urllib.request.Request(url, data=data, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    body = response.read().decode("utf-8")
                parsed = SmartupOrderExportResponse.parse_raw(body)
                if parsed.items:
                    sample = parsed.items[0]
                    logger.info(
                        "Smartup order sample: deal_id=%s external_id=%s filial_id=%s lines=%s",
                        sample.deal_id,
                        sample.external_id,
                        sample.filial_id,
                        len(sample.lines),
                    )
                return parsed
            except urllib.error.HTTPError as exc:
                last_error = exc
                response_text = exc.read().decode("utf-8")
                last_detail = response_text
                logger.error("Smartup export failed (HTTP %s): %s", exc.code, response_text)
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                logger.error("Smartup export failed: %s", exc)
            time.sleep(0.5 * attempt)
        detail = f": {last_detail}" if last_detail else ""
        raise RuntimeError(f"Smartup export failed{detail}") from last_error
