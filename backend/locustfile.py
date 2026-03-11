"""
Locust load test for WMS Backend API.

Ishga tushirish:
  cd backend
  locust -f locustfile.py --host=http://localhost:8000

Web UI: http://localhost:8089 (Number of users, Spawn rate, Start)

Headless:
  locust -f locustfile.py --host=http://localhost:8000 --headless -u 20 -r 4 -t 2m

Login uchun: LOCUST_USER va LOCUST_PASSWORD env o'rnating yoki default (Test / 123456).
Backend ishlashi kerak: uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
import os
from locust import HttpUser, task, between


class WMSUser(HttpUser):
    wait_time = between(0.5, 2)

    def on_start(self):
        # Render admin panelida ko'rsatiladigan login bilan bir xil bo'lishi kerak
        username = os.getenv("LOCUST_USER", "Test")
        password = os.getenv("LOCUST_PASSWORD", "123456")
        r = self.client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": password},
            name="/api/v1/auth/login",
        )
        if r.status_code != 200:
            raise Exception(f"Login failed: {r.status_code} {r.text}")
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
        self.client.get("/api/v1/auth/me", name="/api/v1/auth/me")
