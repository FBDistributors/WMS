from __future__ import annotations

import base64
import json
import logging
import os
import time
import urllib.error
import urllib.request


logger = logging.getLogger(__name__)

# Retry config for transient connection/HTTP errors (e.g. 608, 5xx)
MAX_ATTEMPTS = 4
BACKOFF_BASE_SEC = 2
MAX_DETAIL_LEN = 300


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
        last_code: int | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            request = urllib.request.Request(self.url, data=data, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(request, timeout=90) as response:
                    body = response.read().decode("utf-8")
                return json.loads(body)
            except urllib.error.HTTPError as exc:
                last_error = exc
                last_code = exc.code
                try:
                    response_text = exc.read().decode("utf-8")
                except Exception:
                    response_text = str(exc)
                last_detail = response_text
                logger.warning(
                    "Smartup inventory export attempt %d/%d failed (HTTP %s): %s",
                    attempt, MAX_ATTEMPTS, exc.code,
                    response_text[:MAX_DETAIL_LEN] + ("..." if len(response_text) > MAX_DETAIL_LEN else ""),
                )
            except (urllib.error.URLError, OSError, ConnectionError) as exc:
                last_error = exc
                logger.warning(
                    "Smartup inventory export attempt %d/%d connection error: %s",
                    attempt, MAX_ATTEMPTS, exc,
                )
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                logger.warning("Smartup inventory export attempt %d/%d failed: %s", attempt, MAX_ATTEMPTS, exc)
            if attempt < MAX_ATTEMPTS:
                delay = BACKOFF_BASE_SEC ** attempt
                logger.info("Retrying in %s sec...", delay)
                time.sleep(delay)
        # Short message for run.error_message and logs (avoid huge payloads)
        if last_detail:
            if "Failed to get a connection" in last_detail or last_code == 608:
                detail = " Connection failed (HTTP 608 or Smartup unavailable)."
            else:
                detail = " " + (last_detail[:MAX_DETAIL_LEN] + "..." if len(last_detail) > MAX_DETAIL_LEN else last_detail)
        else:
            detail = f" (last error: {last_error})" if last_error else ""
        logger.error("Smartup export failed after %d attempts.%s", MAX_ATTEMPTS, detail)
        raise RuntimeError(f"Smartup inventory export failed after {MAX_ATTEMPTS} attempts.{detail}") from last_error
