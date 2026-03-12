"""
WMS Backend — Mixed-load test: oddiy user traffic + ixtiyoriy SmartUp orders sync.

Tashkiliy harakat vs Buyurtmalar (Order) sync farqi:
- Tashkiliy harakat: UI da "Smartupni sinxronlash" = faqat GET /api/v1/movements (refresh).
  Lock ishlatilmaydi, Smartup proxy + cache — yuklanadi.
- Buyurtmalar: "Smartupni sinxronlash" = POST /api/v1/orders/sync-smartup.
  Global advisory lock (bitta sync bir vaqtda). Worker yoki boshqa so‘rov lock olganida 409.

Sync task Locust da default OCHIQ (LOCUST_ENABLE_SYNC_USER=0). Yoqish: LOCUST_ENABLE_SYNC_USER=1.

Ishga tushirish:
  cd backend
  locust -f locustfile.py --host=https://wms-ngdm.onrender.com

Web UI: http://localhost:8089
Headless: locust -f locustfile.py --host=... --headless -u 21 -r 4 -t 5m

ENV (ixtiyoriy):
  REGULAR_USERNAME           — oddiy user (default: Test)
  REGULAR_PASSWORD           — oddiy user parol (default: 123456)
  SYNC_USERNAME              — sync user (default: Admin)
  SYNC_PASSWORD              — sync user parol
  LOCUST_ENABLE_SYNC_USER    — 1/true = POST sync-smartup yoq, 0 = faqat GET (default: 0)
  LOCUST_SYNC_INTERVAL_MIN   — sync oralig‘i sekund (default: 120)
"""
import os
import logging
from locust import HttpUser, task, between

logger = logging.getLogger(__name__)

# Sync task default OCHIQ — order sync global lock ishlatadi, testda 409 sabab bo‘lmasin
def _sync_enabled() -> bool:
    v = (os.getenv("LOCUST_ENABLE_SYNC_USER") or "0").strip().lower()
    return v in ("1", "true", "yes")

# Sync task qancha sekundda bir chaqirilsin (minimal interval)
def _sync_interval() -> int:
    return max(60, int(os.getenv("LOCUST_SYNC_INTERVAL_MIN", "120")))


class RegularWMSUser(HttpUser):
    """Oddiy WMS operator/picker/admin trafik: login, dashboard, orders, picking."""
    weight = 19  # 95% regular, 5% sync (weight 1)
    wait_time = between(0.5, 2)

    def on_start(self):
        username = os.getenv("REGULAR_USERNAME") or os.getenv("LOCUST_USER", "Test")
        password = os.getenv("REGULAR_PASSWORD") or os.getenv("LOCUST_PASSWORD", "123456")
        self._login(username, password)

    def _login(self, username: str, password: str):
        r = self.client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": password},
            name="/api/v1/auth/login",
        )
        if r.status_code != 200:
            msg = (
                "Connection failed (backend ishlayaptimi?)"
                if getattr(r, "status_code", None) == 0
                else f"Login failed: {r.status_code} {r.text}"
            )
            raise Exception(msg)
        self.client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"

    @task(4)
    def dashboard_summary(self):
        self.client.get("/api/v1/dashboard/summary", name="/api/v1/dashboard/summary")

    @task(3)
    def orders_by_status(self):
        self.client.get(
            "/api/v1/dashboard/orders-by-status",
            name="/api/v1/dashboard/orders-by-status",
        )

    @task(3)
    def list_orders(self):
        self.client.get(
            "/api/v1/orders?limit=20&offset=0",
            name="/api/v1/orders [list]",
        )

    @task(2)
    def picking_documents(self):
        self.client.get(
            "/api/v1/picking/documents",
            name="/api/v1/picking/documents",
        )

    @task(1)
    def auth_me(self):
        self.client.get("/api/v1/auth/me")

    @task(1)
    def list_movements(self):
        """GET /api/v1/movements — tashkiliy harakatlar (lock yo‘q, cache)."""
        self.client.get(
            "/api/v1/movements?limit=50&offset=0",
            name="/api/v1/movements [list]",
        )


class SmartupSyncUser(HttpUser):
    """
    Admin-style user: GET'lar + ixtiyoriy POST /orders/sync-smartup.
    LOCUST_ENABLE_SYNC_USER=0 (default) bo'lsa sync chaqirilmaydi — faqat GET.
    """
    weight = 1  # 5% sync user
    wait_time = between(1, 3)  # sync user biroz sekinroq tasklar orasida

    def on_start(self):
        username = os.getenv("SYNC_USERNAME", "Admin")
        password = os.getenv("SYNC_PASSWORD") or os.getenv("LOCUST_PASSWORD", "123456")
        r = self.client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": password},
            name="/api/v1/auth/login [sync]",
        )
        if r.status_code != 200:
            raise Exception(f"Sync user login failed: {r.status_code} {r.text}")
        self.client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        self._last_sync_time = 0.0

    @task(5)
    def dashboard_summary(self):
        self.client.get("/api/v1/dashboard/summary", name="/api/v1/dashboard/summary [sync]")

    @task(3)
    def list_orders(self):
        self.client.get(
            "/api/v1/orders?limit=20&offset=0",
            name="/api/v1/orders [list] [sync]",
        )

    @task(2)
    def picking_documents(self):
        self.client.get(
            "/api/v1/picking/documents",
            name="/api/v1/picking/documents [sync]",
        )

    @task(1)
    def auth_me(self):
        self.client.get("/api/v1/auth/me", name="/api/v1/auth/me [sync]")

    @task(1)
    def list_movements(self):
        self.client.get("/api/v1/movements?limit=50&offset=0", name="/api/v1/movements [sync]")

    @task(1)
    def sync_smartup_orders(self):
        """POST /api/v1/orders/sync-smartup — faqat LOCUST_ENABLE_SYNC_USER=1 va interval o‘tganida."""
        if not _sync_enabled():
            return
        import time
        now = time.time()
        if now - getattr(self, "_last_sync_time", 0) < _sync_interval():
            return
        self._last_sync_time = now
        # Payload: bo'sh body — oxirgi 7 kun SmartUP buyurtmalar (default).
        with self.client.post(
            "/api/v1/orders/sync-smartup",
            json={},
            name="/api/v1/orders/sync-smartup",
            timeout=120,
            catch_response=True,
        ) as r:
            if r.status_code == 409:
                # Lock: boshqa sync ishlayapti — failure emas
                r.success()
            elif r.status_code != 200:
                r.failure(f"Sync {r.status_code}: {r.text[:200] if r.text else ''}")
