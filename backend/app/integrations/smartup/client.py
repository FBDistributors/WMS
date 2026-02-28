from __future__ import annotations

import base64
import json
import logging
import os
import time
import urllib.error
import urllib.request
from urllib.parse import urljoin

from app.integrations.smartup.schemas import SmartupOrder, SmartupOrderExportResponse


logger = logging.getLogger(__name__)

# O'rikzor movement$export: to_warehouse_code bo'yicha filtrlash. "" = barcha, "777" = faqat 777
ORIKZOR_TO_WAREHOUSE_CODE = (os.getenv("SMARTUP_ORIKZOR_TO_WAREHOUSE_CODE") or "").strip()


def _parse_movement_export_to_orders(body: str) -> SmartupOrderExportResponse:
    """movement$export javobini parse qiladi, to_warehouse_code bo'yicha filtrlaydi va SmartupOrder list qaytaradi."""
    data = json.loads(body)
    movements = data.get("movement") or []
    if not isinstance(movements, list):
        movements = [movements] if movements else []
    # to_warehouse_code: filterni bo'sh qoldirsak barcha movement'lar, aks holda faqat shu kod
    if ORIKZOR_TO_WAREHOUSE_CODE:
        filtered = [
            m for m in movements
            if isinstance(m, dict) and (m.get("to_warehouse_code") or "").strip() == ORIKZOR_TO_WAREHOUSE_CODE
        ]
    else:
        filtered = [m for m in movements if isinstance(m, dict)]
    orders: list[SmartupOrder] = []
    for m in filtered:
        movement_id = (m.get("movement_id") or "").strip() or (m.get("movement_number") or "").strip()
        movement_number = (m.get("movement_number") or m.get("movement_id") or "").strip()
        if not movement_id and not movement_number:
            continue
        movement_id = movement_id or movement_number
        items = m.get("movement_items") or []
        if not isinstance(items, list):
            items = [items] if items else []
        lines = []
        for it in items:
            if not isinstance(it, dict):
                continue
            try:
                qty = float(it.get("quantity") or 0)
            except (TypeError, ValueError):
                qty = 0
            lines.append({
                "product_code": it.get("product_code"),
                "sku": it.get("product_code"),
                "quantity": qty,
                "name": it.get("product_article_code") or it.get("product_code") or "",
            })
        order_dict = {
            "external_id": movement_id,
            "deal_id": movement_id,
            "order_no": movement_number,
            "status": "B#S",
            "filial_id": m.get("filial_code"),
            "filial_code": m.get("filial_code"),
            "lines": lines,
        }
        try:
            validate = getattr(SmartupOrder, "model_validate", getattr(SmartupOrder, "parse_obj", None))
            if validate:
                orders.append(validate(order_dict))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Movement to order parse skip movement_id=%s: %s", movement_id, exc)
    return SmartupOrderExportResponse(items=orders)


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
        is_movement_export = export_url and "movement$export" in (export_url or "")

        if is_movement_export:
            # movement$export API formati (Internal movement / Export)
            payload = {
                "filial_codes": [{"filial_code": normalized_filial_code}] if normalized_filial_code else [{"filial_code": ""}],
                "filial_code": normalized_filial_code or "",
                "external_id": "",
                "movement_id": "",
                "begin_from_movement_date": begin_deal_date,
                "end_from_movement_date": end_deal_date,
                "begin_to_movement_date": "",
                "end_to_movement_date": "",
                "begin_created_on": "",
                "end_created_on": "",
                "begin_modified_on": "",
                "end_modified_on": "",
            }
        else:
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
                # O'rikzor movement$export: "movement" array, to_warehouse_code=777 filtri
                if export_url and "movement$export" in (export_url or ""):
                    parsed = _parse_movement_export_to_orders(body)
                    if parsed.items:
                        logger.info(
                            "Smartup movement$export: to_warehouse_code=%s, movements=%s",
                            ORIKZOR_TO_WAREHOUSE_CODE or "(all)",
                            len(parsed.items),
                        )
                    else:
                        logger.warning(
                            "Smartup movement$export: API dan 0 ta movement qaytdi. URL va sana oralig'ini tekshiring."
                        )
                else:
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
                if exc.code == 481 and "невидим" in response_text.lower():
                    last_detail = (
                        f"{response_text} (Loyiha ko'rinmayapti. Render env da SMARTUP_ORIKZOR_PROJECT_CODE ni 'mkw' yoki 'anor' qilib, SmartUP hisobiga loyiha ruxsatini tekshiring.)"
                    )
                elif exc.code == 401:
                    last_detail = (
                        f"{response_text} (SmartUP kirish rad etildi. Render env da SMARTUP_ORIKZOR_BASIC_USER va SMARTUP_ORIKZOR_BASIC_PASS yoki ular bo'sh bo'lsa SMARTUP_BASIC_USER va SMARTUP_BASIC_PASS ni movement$export API ga kirish beradigan login/parol bilan to'ldiring.)"
                    )
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                logger.error("Smartup export failed: %s", exc)
            time.sleep(0.5 * attempt)
        detail = f": {last_detail}" if last_detail else ""
        raise RuntimeError(f"Smartup export failed{detail}") from last_error
