# Locust load test — production xavfsizlik tekshiruvi

**Maqsad:** Hozirgi Locust testi production WMS bazasiga zarar yetkazadimi yoki yo‘qmi aniqlash.

---

## 1. Test qaysi endpointlarni chaqiradi

| # | Method | Endpoint | Chaqirish joyi |
|---|--------|----------|----------------|
| 1 | POST | `/api/v1/auth/login` | `on_start()` — har user bitta marta |
| 2 | GET | `/api/v1/dashboard/summary` | `@task(4)` |
| 3 | GET | `/api/v1/dashboard/orders-by-status` | `@task(3)` |
| 4 | GET | `/api/v1/orders?limit=20&offset=0` | `@task(3)` |
| 5 | GET | `/api/v1/picking/documents` | `@task(2)` |
| 6 | GET | `/api/v1/auth/me` | `@task(1)` |

**Manba:** `backend/locustfile.py` — boshqa endpoint yo‘q.

---

## 2. Read-only vs yozuvchi

| Endpoint | Method | Turi | DB yozuvi |
|----------|--------|------|-----------|
| `/api/v1/auth/login` | POST | **Yozuvchi** | Ha — q. 4–5 |
| `/api/v1/dashboard/summary` | GET | Faqat o‘qish | Yo‘q |
| `/api/v1/dashboard/orders-by-status` | GET | Faqat o‘qish | Yo‘q |
| `/api/v1/orders?limit=20&offset=0` | GET | Faqat o‘qish | Yo‘q |
| `/api/v1/picking/documents` | GET | Faqat o‘qish | Yo‘q |
| `/api/v1/auth/me` | GET | Faqat o‘qish | Yo‘q |

Yagona yozuvchi endpoint: **POST /api/v1/auth/login**.

---

## 3. Login endpoint nima yozadi

**Fayl:** `app/api/v1/endpoints/auth.py`, `login` (66–99).

- **Token qaytaradi:** Ha (`TokenResponse(access_token=token)`).
- **DB ga yozadi:**
  1. **`users` jadvali:**  
     - `user.last_login_at = datetime.utcnow()`  
     - `user.last_device_info = user_agent`  
     Ya’ni faqat kirish qilayotgan user (default: Test) ning `last_login_at` va `last_device_info` yangilanadi.
  2. **`user_sessions` jadvali:**  
     - Eski sessiyalar: `max_sessions` dan ortiq bo‘lsa, eng eskilari `db.delete(existing.pop(0))` bilan o‘chiriladi.  
     - Test user uchun `max_sessions = 999` bo‘lgani uchun **eski sessiyalar o‘chirilmaydi**.  
     - Yangi sessiya: `db.add(UserSession(user_id=user.id, token=token, device_info=user_agent))`.  
     Har bir muvaffaqiyatli login = `user_sessions` ga **1 ta yangi qator** (va Test user uchun eskilari delete qilinmaydi).

- **Audit log:** Auth endpointida `log_action` yoki audit jadvaliga yozuv yo‘q.

**Xulosa:** Login faqat token qaytarmaydi; **users** (1 qator — Test) va **user_sessions** (har login da yangi qator) ga yozadi.

---

## 4. Boshqa chaqiriladigan endpointlar DB ni o‘zgartiradimi

- **GET /api/v1/dashboard/summary** — `get_dashboard_summary`: faqat `db.query(...).scalar()` / `.one()`; hech qanday `db.add`, `db.commit`, `db.delete` yo‘q.
- **GET /api/v1/dashboard/orders-by-status** — `get_orders_by_status`: faqat `db.query(...).all()`; read-only.
- **GET /api/v1/orders** — `list_orders`: faqat `query.offset().limit().all()`, docs va lines count; read-only.
- **GET /api/v1/picking/documents** — `list_picking_documents`: faqat `query.offset().limit().all()`; read-only.
- **GET /api/v1/auth/me** — `me`: faqat `current_user` dan response; DB write yo‘q.

**Xulosa:** Testda ishlatiladigan barcha GET endpointlar **faqat o‘qish**; orders, documents, picking, stock, audit hech biri o‘zgarmaydi.

---

## 5. Test davomida qaysi jadvallarga yozuv tushadi

| Jadval | Qanday | Ta’sir |
|--------|--------|--------|
| **users** | UPDATE 1 qator (Test user) | `last_login_at`, `last_device_info` — faqat metadata |
| **user_sessions** | INSERT har login da | Test user uchun sessiya qatorlari; max_sessions=999 bo‘lgani uchun delete yo‘q, faqat ko‘payadi |

Boshqa jadval (orders, order_lines, order_wms_state, documents, document_lines, stock, stock_movements, audit_logs va boshqalar) test tomonidan **hech qanday** o‘zgartirilmaydi.

---

## 6. Production’da ishlatish xavfi

**Xulosa: qisman xavfli (past xavf).**

- **Xavfsiz:**  
  - Buyurtma, picking, document, stock, audit kabi business ma’lumotlar o‘zgarmaydi.  
  - Faqat bitta user (odatda Test) va faqat `users`/`user_sessions` ta’sirlanadi.
- **Xavf:**  
  - **user_sessions** test davomida tez to‘lib ketadi: har Locust user bitta login = bitta sessiya, Test uchun eski sessiyalar o‘chirilmaydi (999 limit). 50 user × 1 test = 50 qator; testni qayta-qayta ishga tushirsangiz yuzlab/minglab sessiya yig‘ilishi mumkin.  
  - Production’da Test user bo‘lmasa yoki parol boshqacha bo‘lsa, login fails, DB ga yozuv tushmaydi (faqat 401).

**Daraja:** Production’da **ishlatish mumkin**, lekin **user_sessions** ni kuzatib borish va kerak bo‘lsa testdan keyin Test user sessiyalarini tozalash tavsiya etiladi.

---

## 7. Testni to‘liq read-only qilish

Agar production’da **hech qanday** yozuv bo‘lmasin istasangiz:

### Variant A: Tashqi token, login’ni chaqirmaslik

- Bir marta (masalan staging’da) Test user bilan login qilib `access_token` oling.
- Token’ni xavfsiz joyda saqlang (env yoki maxfiy fayl).
- Locust’da `on_start` da **POST /login** o‘rniga shu token’ni `Authorization: Bearer <token>` qilib o‘rnating; POST /login umuman chaqirilmasin.
- Natija: barcha so‘rovlar GET, DB’ga yozuv yo‘q (token muddati tugaguncha).

**Kamchiligi:** Token muddati tugasa test ishlamaydi; token’ni periodic yangilash kerak.

### Variant B: Read-only flag (backend o‘zgarishi)

- Backend’da env: `LOCUST_READ_ONLY=1` (yoki `WMS_LOAD_TEST_READ_ONLY=1`).
- Login endpointida: agar bu env o‘rnatilgan bo‘lsa, token yaratib qaytaring, lekin **`users` va `user_sessions` ga yozmaslik** (commit’siz).
- Locust’da o‘zgarish shart emas; production’da faqat shu env’ni o‘rnatib ishlatish.

### Variant C: Hozirgi holat (minimal yozuv)

- Login qoldirish, faqat Test user va faqat `users`/`user_sessions` ta’sirlanadi.
- Testdan keyin: `DELETE FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE username = 'Test');` — Test sessiyalarini tozalash.

---

## 8. Xulosa jadvali

| Savol | Javob |
|-------|--------|
| Test qaysi endpointlarni urmoqda? | 6 ta: 1× POST login, 5× GET (dashboard/summary, orders-by-status, orders list, picking/documents, auth/me). |
| Qaysilari faqat read-only? | 5 ta GET — barchasi read-only. |
| Qaysi biri DB ni o‘zgartiradi? | Faqat **POST /api/v1/auth/login** — `users` (1 qator), `user_sessions` (INSERT). |
| Production’da ishlatish xavfi? | **Qisman xavfli (past xavf):** business data o‘zgarmaydi; faqat Test user va user_sessions ta’sirlanadi; user_sessions to‘lib ketishi mumkin. |
| To‘liq read-only qilish? | Token’ni tashqaridan berib login’ni olib tashlash (Variant A); yoki backend’da read-only rejim (Variant B); yoki hozirgi holat + testdan keyin Test sessiyalarini delete (Variant C). |

---

---

## 9. Read-only Locust variant (taklif)

Agar production’da **hech qanday DB yozuvi** bo‘lmasin istasangiz — token’ni tashqaridan bering va login’ni chaqirmang. Misol (alohida fayl yoki `locustfile.py` da class):

```python
# Read-only: LOGIN chaqirilmaydi, token env dan.
# LOCUST_TOKEN=eyJ...  (bir marta Test user bilan login qilib oling)
class WMSUserReadOnly(HttpUser):
    wait_time = between(0.5, 2)

    def on_start(self):
        token = os.getenv("LOCUST_TOKEN")
        if not token:
            raise Exception("LOCUST_TOKEN env kerak (read-only rejim)")
        self.client.headers["Authorization"] = f"Bearer {token}"

    @task(4)
    def dashboard_summary(self):
        self.client.get("/api/v1/dashboard/summary", name="/api/v1/dashboard/summary")
    # ... qolgan GET tasklar bir xil
```

Ishga tushirish: `LOCUST_TOKEN=<token> locust -f locustfile.py --host=...` va faqat `WMSUserReadOnly` classini ishlating. Bu holda DB’ga hech qanday yozuv tushmaydi.

---

*Tekshiruv backend kodiga asosan amalga oshirilgan.*
