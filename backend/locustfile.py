"""
WMS backend — haqiqiy yuk sinovi (Locust).

Maqsad: RPS, javob vaqti, xatoliklar ulushi, /health/db va picking/inventory
so‘rovlari ostida server barqarorligini ko‘rish.

Ishga tushirish (lokal):
  cd backend
  pip install -r requirements.txt
  set WMS_LOCUST_USERNAME=...
  set WMS_LOCUST_PASSWORD=...
  locust -f locustfile.py --host=http://127.0.0.1:8000

Production (VPS):
  locust -f locustfile.py --host=https://api.fbwarehouse.uz

Web UI: http://localhost:8089 — Users, spawn rate, Start.
  Windows: 8089 band bo'lsa — python -m locust ... --web-port=8090 yoki .\run_locust_vps.ps1 (avto bo'sh port).

Muhim:
  - Bir xil oddiy foydalanuvchi bilan juda ko‘p parallel virtual user ishga tushirsangiz,
    sessiya limiti (max 2 ta token) eski sessiyalarni chiqaradi. Yuk testi uchun
    admin yoki username `test` (kodda 999 sessiya) qo‘llanadi.
  - Ixtiyoriy: WMS_LOCUST_TEST_BARCODE — real shtrix (inventory/by-barcode uchun).
  - Autentifikatsiyasiz faqat /health va / ishlaydi; login bo‘lmasa qolgan task’lar 401 beradi.
"""

from __future__ import annotations

import os
import random
from typing import Any

from locust import HttpUser, between, task


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


class WmsApiUser(HttpUser):
    """Mobil yig‘uvchi / operator yukini yaqinlashtiruvchi: picking + inventory o‘qish."""

    wait_time = between(0.5, 2.5)
    host = _env("LOCUST_HOST", "")  # asosan --host CLI

    token: str | None = None
    barcode_for_heavy_read: str | None = None

    def on_start(self) -> None:
        self.token = None
        user = _env("WMS_LOCUST_USERNAME")
        password = _env("WMS_LOCUST_PASSWORD")
        self.barcode_for_heavy_read = _env("WMS_LOCUST_TEST_BARCODE") or None

        if not user or not password:
            return

        with self.client.post(
            "/api/v1/auth/login",
            json={"username": user, "password": password},
            name="/api/v1/auth/login",
            catch_response=True,
        ) as resp:
            if resp.status_code == 200:
                try:
                    data: dict[str, Any] = resp.json()
                    self.token = data.get("access_token")
                    if self.token:
                        resp.success()
                    else:
                        resp.failure("login JSON without access_token")
                except Exception as exc:
                    resp.failure(f"login JSON error: {exc}")
            else:
                resp.failure(f"login HTTP {resp.status_code}")

    def _auth_headers(self) -> dict[str, str]:
        if self.token:
            return {"Authorization": f"Bearer {self.token}"}
        return {}

    # --- Public (auth shart emas) ---

    @task(12)
    def health(self) -> None:
        self.client.get("/health", name="/health")

    @task(4)
    def health_db(self) -> None:
        """DB ulanishi + oddiy SELECT — bazani bosish."""
        self.client.get("/health/db", name="/health/db")

    @task(2)
    def root_ok(self) -> None:
        self.client.get("/", name="/")

    # --- Auth + asosiy API ---

    @task(6)
    def auth_me(self) -> None:
        headers = self._auth_headers()
        if not headers:
            return
        self.client.get("/api/v1/auth/me", headers=headers, name="/api/v1/auth/me")

    @task(15)
    def picking_documents_list(self) -> None:
        headers = self._auth_headers()
        if not headers:
            return
        self.client.get(
            "/api/v1/picking/documents",
            params={"limit": 50, "offset": 0},
            headers=headers,
            name="/api/v1/picking/documents",
        )

    @task(8)
    def picking_consolidated(self) -> None:
        """Faqat picker roli — admin 403 qaytaradi (barqarorlik o‘lchovi uchun OK)."""
        headers = self._auth_headers()
        if not headers:
            return
        self.client.get(
            "/api/v1/picking/consolidated",
            headers=headers,
            name="/api/v1/picking/consolidated",
        )

    @task(5)
    def picking_my_stats(self) -> None:
        headers = self._auth_headers()
        if not headers:
            return
        self.client.get(
            "/api/v1/picking/my-stats",
            params={"days": 7},
            headers=headers,
            name="/api/v1/picking/my-stats",
        )

    @task(7)
    def inventory_picker_list(self) -> None:
        """Mahsulot ro‘yxati + lot balanslari — og‘irroq o‘qish."""
        headers = self._auth_headers()
        if not headers:
            return
        self.client.get(
            "/api/v1/inventory/picker",
            params={"limit": 20, "warehouse": "main"},
            headers=headers,
            name="/api/v1/inventory/picker",
        )

    @task(1)
    def inventory_by_barcode(self) -> None:
        if not self.barcode_for_heavy_read:
            return
        headers = self._auth_headers()
        if not headers:
            return
        code = self.barcode_for_heavy_read
        self.client.get(
            f"/api/v1/inventory/by-barcode/{code}",
            headers=headers,
            name="/api/v1/inventory/by-barcode/[code]",
        )

    @task(3)
    def inventory_picker_locations(self) -> None:
        headers = self._auth_headers()
        if not headers:
            return
        wh = random.choice(["main", "showroom", ""])
        params: dict[str, str] = {}
        if wh:
            params["warehouse"] = wh
        self.client.get(
            "/api/v1/inventory/picker/locations",
            params=params,
            headers=headers,
            name="/api/v1/inventory/picker/locations",
        )

    @task(2)
    def dashboard_summary_if_allowed(self) -> None:
        """
        Admin / reports huquqi bo‘lsa ma’lumot beradi; picker 403.
        Server barqarorligini ko‘rish uchun so‘rov yuboriladi.
        """
        headers = self._auth_headers()
        if not headers:
            return
        self.client.get(
            "/api/v1/dashboard/summary",
            headers=headers,
            name="/api/v1/dashboard/summary",
        )
