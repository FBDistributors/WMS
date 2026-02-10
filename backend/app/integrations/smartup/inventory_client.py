from __future__ import annotations

import base64
import json
import logging
import os
import time
import urllib.error
import urllib.request


logger = logging.getLogger(__name__)


class SmartupInventoryExportClient:
    def __init__(
        self,
        url: str | None = None,
        username: str | None = None,
        password: str | None = None,
        project_code: str | None = None,
        filial_id: str | None = None,
    ) -> None:
        self.url = (
            url
            or os.getenv("SMARTUP_INVENTORY_EXPORT_URL")
            or "https://smartup.online/b/anor/mxsx/mr/inventory$export"
        ).strip()
        self.username = (username or os.getenv("SMARTUP_BASIC_USER") or "").strip() or None
        self.password = (password or os.getenv("SMARTUP_BASIC_PASS") or "").strip() or None
        self.project_code = (project_code or os.getenv("SMARTUP_PROJECT_CODE", "anor")).strip()
        self.filial_id = (filial_id or os.getenv("SMARTUP_FILIAL_ID", "")).strip()

    def export_inventory(self, payload: dict) -> dict:
        if not self.url:
            raise RuntimeError("SMARTUP_INVENTORY_EXPORT_URL is not configured")
        if not self.username or not self.password:
            raise RuntimeError("SMARTUP_BASIC_USER or SMARTUP_BASIC_PASS is not configured")

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

        last_error: Exception | None = None
        last_detail: str | None = None
        for attempt in range(1, 4):
            request = urllib.request.Request(self.url, data=data, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    body = response.read().decode("utf-8")
                return json.loads(body)
            except urllib.error.HTTPError as exc:
                last_error = exc
                response_text = exc.read().decode("utf-8")
                last_detail = response_text
                logger.error("Smartup inventory export failed (HTTP %s): %s", exc.code, response_text)
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                logger.error("Smartup inventory export failed: %s", exc)
            time.sleep(0.5 * attempt)
        detail = f": {last_detail}" if last_detail else ""
        raise RuntimeError(f"Smartup inventory export failed{detail}") from last_error
