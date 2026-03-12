# SmartUp import load test — reja va amaliy yechim

Kod bazasi tekshirildi. Quyida 1–7 savollar bo‘yicha aniq javoblar, mixed-load reja va Locust taklifi.

---

## 1. SmartUp import qayerda ishlaydi

| Yo‘nalish | Qanday | Fayl / endpoint |
|-----------|--------|------------------|
| **Background worker** | Periodik to‘liq sync (products + orders) | `worker.py` → `app.workers.smartup_sync.run_full_sync()`; `SYNC_INTERVAL_SECONDS` (default 600). |
| **HTTP API (orders)** | Bir martalik buyurtmalar sync | `POST /api/v1/orders/sync-smartup` — `orders.py` 644–707; `require_permission("orders:sync")`; SmartupClient.export_orders + `import_orders(db, response.items)`. |
| **HTTP API (orders, sana orqali)** | Sana oralig‘i bilan import | `POST /api/v1/integrations/smartup/import` — `integrations.py` 32–95; `require_permission("integrations:write")`; SmartupClient.export_orders + `import_orders(db, response.items)`. |
| **HTTP API (products)** | Mahsulotlar sync | `POST /api/v1/products/sync-smartup` — `products.py` 179–204; `require_permission("products:write")`; `sync_smartup_products(db, ...)`. |

**Xulosa:** Import **worker** (faqat background) va **3 ta HTTP endpoint** orqali ishlaydi. Asosiy import logikasi: orders uchun `app.integrations.smartup.importer.import_orders`, products uchun `app.integrations.smartup.products_sync._sync_products` / `sync_smartup_products`.

---

## 2. Qo‘lda trigger qilish

- **Orders (SmartUp savdo buyurtmalari):**  
  - `POST /api/v1/orders/sync-smartup` — body: `{}` (default oxirgi 7 kun) yoki `begin_deal_date`, `end_deal_date`, `filial_id`, `order_source`.  
  - Yoki `POST /api/v1/integrations/smartup/import` — body: `{"begin_deal_date": "2026-03-01", "end_deal_date": "2026-03-11"}`.  
  - Token: `orders:sync` yoki `integrations:write` bo‘lgan user (masalan Admin).
- **Products:**  
  - `POST /api/v1/products/sync-smartup` — body ixtiyoriy: `code`, `begin_modified_on`, `end_modified_on` va h.k.  
  - Token: `products:write`.
- **To‘liq sync (worker logikasi):**  
  - HTTP orqali to‘g‘ridan-to‘g‘ri “full sync” endpointi yo‘q. Worker `run_full_sync()` ni faqat `python worker.py` (yoki Render worker) ishlatadi.  
  - Amaliyotda: orders sync + products sync ni alohida-alohida HTTP dan chaqirib “qo‘lda full” qilish mumkin.

---

## 3. Locust orqali testga qo‘shish

Mumkin. Sync endpointlari oddiy POST, bearer token kerak.

- **Token:** Admin (yoki `orders:sync` + `integrations:write` / `products:write` berilgan) user bilan login qilib, Locustda `on_start` da `Authorization: Bearer <token>` qo‘yiladi.
- **Variant A — bitta user turi:** Barcha userlar login + oddiy GET tasklar + ba’zi userlar sync POST qiladi (masalan 1 ta “admin” user sync, qolganlari oddiy).
- **Variant B — ikki user turi:** `WMSUser` (oddiy) + `WMSAdminUser` (login + GET + `POST /api/v1/orders/sync-smartup` yoki `POST /api/v1/integrations/smartup/import`). Locustda ikkita class bo‘lsa, “User” nisbatini o‘rnatib aralash traffic yaratish mumkin.

Eslatma: Sync endpointlari uzoq davom qilishi mumkin (SmartUp API + DB yozish). Locustda timeout oshirish yoki sync taskni kamroq vazn bilan qo‘llash kerak.

---

## 4. Mixed-load test ssenariy (oddiy user + SmartUp sync)

Maqsad: oddiy user traffic bilan bir vaqtda sync chaqiruvlari bo‘lsin, DB va API birgalikda yuklansin.

- **Faza 1 — isitish:** 10–20 user, faqat oddiy tasklar (login, dashboard, orders list, picking, auth/me), 1–2 min.
- **Faza 2 — aralash:**  
  - Oddiy userlar davom etadi (masalan 30–50 user).  
  - 1–2 ta “admin” user (yoki 1 user, kam vaznli task) har 60–120 sekundda `POST /api/v1/orders/sync-smartup` (body `{}` yoki qisqa sana oralig‘i).  
  - Ixtiyoriy: yanada kam tezlikda `POST /api/v1/integrations/smartup/import` yoki `POST /api/v1/products/sync-smartup` (products sync uzoqroq bo‘lishi mumkin).
- **Faza 3 — davom:** 5–10 min yoki kerak bo‘lsa uzoqroq; sync oraliqlarini o‘zgartirib, failure rate va response time kuzatiladi.

**Locust script taklifi (asosiy qismlar):**

- `WMSUser`: mavjud (login + dashboard, orders, picking, auth/me).
- `WMSAdminUser` (yangi):  
  - `on_start`: Admin (yoki sync permission’li) user bilan login, token saqlanadi.  
  - `@task(5)` oddiy GET’lar (dashboard/summary, orders-by-status, orders list, picking/documents, auth/me).  
  - `@task(1)` yoki `@task(0.5)` — `POST /api/v1/orders/sync-smartup` body `{}`, `name="/api/v1/orders/sync-smartup"`.  
  - Ixtiyoriy: `POST /api/v1/integrations/smartup/import` (masalan oxirgi 1 kun) kamroq vazn bilan.
- Spawn nisbati: masalan 80% WMSUser, 20% WMSAdminUser; yoki 50/50 va sync task vazni past.

Sync uzun bo‘lsa, Locustda `client.post(..., timeout=120)` kabi timeout berish ma’qul.

---

## 5. Background worker ni test paytida kuzatish

- Worker **alohida process** (Render’da alohida service). Load test faqat HTTP API’ga ta’sir qiladi; worker o‘z intervalida `run_full_sync()` ni ishlatadi.
- **Kuzatish:**  
  - **Render Dashboard:** Worker service → Logs. Qidiruv: `SmartUp full sync started`, `SmartUp full sync finished`, `Orders sync: ... -> N buyurtma`, `Products sync: inserted=...`.  
  - **DB:** `smartup_sync_runs` jadvali — `run_type` (full/products/orders), `status`, `started_at`, `finished_at`, `synced_products_count`, `synced_orders_count`, `error_message`.  
  - Agar API’da `POST /api/v1/orders/sync-smartup` yoki `integrations/smartup/import` chaqirilsa, `smartup_sync_runs` da `run_type=orders` yozuvlari ham paydo bo‘ladi (integrations endpoint ham run yozadi).
- **Mixed testda:** Bir vaqtda HTTP sync + worker sync bo‘lishi mumkin. DB connection pool va disk I/O birga yuklanadi; worker loglarida timeout yoki “Sync cycle failed” bo‘lsa, load test va worker birga DB’ni bosayotgani bo‘ladi.

---

## 6. SmartUp import DB’ga qayerda ko‘p write load beradi

- **Orders import** (`app/integrations/smartup/importer.import_orders`):  
  - Har bir order uchun: `db.query(Order).options(selectinload(Order.lines)).filter(source_external_id=...).one_or_none()` — 1 SELECT.  
  - Keyin yangi order bo‘lsa: `db.add(record)` (Order + OrderWmsState + OrderLine’lar), **keyin darhol `db.commit()`** (74–155 qatorlar).  
  - Mavjud order bo‘lsa: update + `_upsert_lines` + **`db.commit()`** (122).  
  - **Xulosa:** Har bir order uchun kamida 1 commit; N ta order = N ta commit. Bu eng katta write “spike” manbai.

- **Products sync** (`app/integrations/smartup/products_sync._sync_products`):  
  - Har bir product uchun: SELECT (Brand, Product + barcodes), keyin yoki update + `db.commit()`, yoki insert + `db.commit()` (158–159, 177–178).  
  - **Xulosa:** Har bir product uchun 1 commit; ko‘p product = ko‘p commit.

- **Worker** (`app/workers.smartup_sync`):  
  - `run_full_sync`: avvalo `smartup_sync_runs` ga 1 ta INSERT + commit; oxirida UPDATE + commit.  
  - `sync_products()` va `sync_orders()` ichida yuqoridagi import/sync logikasi ishlaydi — shu sababli products va orders tarafida commit’lar soni yuqori.

- **Integrations endpoint** (`integrations.py`):  
  - Bir so‘rovda: `SmartupSyncRun` INSERT + commit, keyin `import_orders(db, response.items)` (N ta order uchun N ta commit), oxirida run UPDATE + commit.

---

## 7. Qayerlarda batching / bulk insert / upsert kerak

- **Orders import (`importer.import_orders`):**  
  - **Hozir:** order-by-order commit.  
  - **Taklif:** 50–200 order’ni bir session’da qayta ishlab, **batch commit** (masalan har 50 ta order’dan keyin bitta `db.commit()`). Yoki “flush” qilib, oxirida bitta commit (xato bo‘lsa rollback).  
  - **Upsert:** Mavjud order’ni topish uchun bitta queryda `source_external_id in (...)` bilan batch select, keyin dict orqali match qilish; yangi order’lar uchun `db.add_all([...])` va batch commit.  
  - **Order lines:** Bir order ichida allaqachon list bilan qo‘shilmoqda; muammo order’lar o‘rtasidagi commit ko‘pligi.

- **Products sync (`_sync_products`):**  
  - **Hozir:** product-by-product commit.  
  - **Taklif:** Batch select (external_id in (...)), keyin update/insert ro‘yxatini ajratib, masalan har 100 ta product’dan keyin bitta commit; yoki SQLAlchemy `bulk_insert_mappings` / `bulk_update_mappings` (agar model imkoniyati bo‘lsa).

- **Umumiy:**  
  - `smartup_sync_runs`: 1 ta INSERT va 1 ta UPDATE — yetarli.  
  - Connection pool: sync paytida uzoq session ochiq qolmasligi kerak (worker allaqachon sync_products/sync_orders ichida qisqa session ochyapti); API endpoint’da esa bitta request davomida bitta session. Batch commit qilsak, session vaqtini qisqartiramiz va lock’larni kamaytiramiz.

---

## Natija: qisqa ro‘yxatlar

### Mixed load test rejasi

1. **Isitish:** 1–2 min, 10–20 user, faqat GET (dashboard, orders, picking, auth/me).  
2. **Aralash:** 30–50 user (80% oddiy, 20% admin); admin’lar GET + har 1–2 min da `POST /api/v1/orders/sync-smartup`.  
3. **Davomiylik:** 5–10 min.  
4. **Kuzatish:** RPS, failure %, response time (ayniqsa sync endpoint); Render worker loglari va `smartup_sync_runs`.

### Locust script uchun taklif

- `WMSUser` — o‘zgarishsiz (login + 4 GET task).  
- `WMSAdminUser`:  
  - Login (Admin yoki sync’li user).  
  - Tasklar: dashboard/summary, orders-by-status, orders list, picking/documents, auth/me (yuqori vazn); `POST /api/v1/orders/sync-smartup` (past vazn, masalan 0.5 yoki 1), body `{}`, timeout 90–120 s.  
- Spawn: masalan 40 WMSUser, 10 WMSAdminUser.

### SmartUp sync test tartibi

1. **Qo‘lda (bitta chaqiruv):** Postman/curl bilan Admin token orqali `POST /api/v1/orders/sync-smartup` (body `{}`) — 200 va `created/updated/skipped` tekshiriladi.  
2. **Locust:** Mixed scenario ishga tushiriladi; Statistics’da `POST /api/v1/orders/sync-smartup` va boshqa endpoint’lar ajratib kuzatiladi.  
3. **Worker:** Render’da worker yoqilgan bo‘lsa, Logs’da “full sync started/finished” va xatoliklar; `smartup_sync_runs` dan oxirgi run’lar va status.

### Kuzatiladigan endpointlar va loglar

- **Endpointlar:**  
  - `POST /api/v1/orders/sync-smartup` — response time, 200/500.  
  - `POST /api/v1/integrations/smartup/import` — agar Locustda ishlatilsa.  
  - `GET /api/v1/dashboard/summary`, `GET /api/v1/orders`, `GET /api/v1/picking/documents` — sync davomida barqarorligi.
- **Loglar:**  
  - Backend (Render): `INFO` request time; `ERROR` / 500; “Smartup export failed”, “O'rikzor import xato”.  
  - Worker: “SmartUp full sync started/finished”, “Orders sync: … -> N buyurtma”, “Products sync: inserted=…”, “Sync cycle failed”.  
  - DB: `smartup_sync_runs.status`, `error_message`, `synced_orders_count`, `synced_products_count`.

---

*Hujjat kod bazasidagi aniq fayl va endpoint’lar asosida tuzilgan.*
