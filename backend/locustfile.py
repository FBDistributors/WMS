"""
WMS Backend — Locust load test.

Hozircha API chaqiruqlari o‘chirilgan. Qayta yoqish uchun HttpUser va task’lar qo‘shiladi.
Ishga tushirish: cd backend && locust -f locustfile.py --host=https://...
"""
from locust import HttpUser, task, between


class PlaceholderUser(HttpUser):
    """Placeholder — hech qanday API so‘rov yuborilmaydi."""
    wait_time = between(1, 3)

    @task
    def noop(self):
        pass
