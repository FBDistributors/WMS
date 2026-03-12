# WMS Mixed-Load Test rejasi

Oddiy WMS user traffic + SmartUp orders sync bir vaqtda: server, DB va API ishlashini baholash.

---

## 1. Topilgan endpointlar va auth oqimi

### Oddiy user endpointlari (RegularWMSUser)
| Endpoint | Method | Izoh |
|----------|--------|------|
| `/api/v1/auth/login` | POST | `{"username","password"}` → `access_token` |
| `/api/v1/auth/me` | GET | JWT Bearer |
| `/api/v1/dashboard/summary` | GET | JWT Bearer |
| `/api/v1/dashboard/orders-by-status` | GET | JWT Bearer |
| `/api/v1/orders?limit=20&offset=0` | GET | JWT Bearer |
| `/api/v1/picking/documents` | GET | JWT Bearer |

### SmartUp orders sync
| Endpoint | Method | Auth | Payload |
|----------|--------|------|--------|
| `/api/v1/orders/sync-smartup` | POST | JWT + `orders:sync` (warehouse_admin / Admin) | `{}` (default oxirgi 7 kun) yoki `begin_deal_date`, `end_deal_date`, `filial_id`, `filial_code`, `order_source` |

- **Lock:** Advisory lock — bitta vaqtda bitta sync (worker yoki HTTP). Sync davom etayotganda yana so‘rov 409 qaytaradi.
- **Products sync** bu testda ishlatilmaydi.

### Auth
- **Tanlangan variant: A** — har user `on_start` da login qiladi, access token olib saqlanadi.
- **Sabab:** Token muddati yangilanadi, bitta token o‘g‘irlansa barcha virtual userlar buzilmaydi; test muhitida parol odatda test user uchun.

---

## 2. Mixed-load strategiya

- **RegularWMSUser** (weight 19): login → auth/me, dashboard/summary, orders-by-status, orders list, picking/documents. `wait_time = between(0.5, 2)`.
- **SmartupSyncUser** (weight 1): login (Admin yoki orders:sync berilgan user) → asosan shu GET’lar + past chastotada `POST /api/v1/orders/sync-smartup` (body `{}`). Sync task: `LOCUST_SYNC_INTERVAL_MIN` (default 120 s) dan kam bo‘lmasa chaqiriladi. 409 (lock) — success hisoblanadi.
- **ENV:** `LOCUST_ENABLE_SYNC_USER=0` bo‘lsa sync task o‘chiriladi (faqat GET trafik).

---

## 3. Test bosqichlari

### 1-bosqich (yengil)
- **Userlar:** 20 regular + 1 sync (jami 21).
- **Vaqt:** 5 daqiqa.
- **Buyruq (misol):**  
  `locust -f locustfile.py --host=<BASE_URL> --headless -u 21 -r 4 -t 5m`
- **Kuzatish:** response time (p50, p95), failure rate, 409 soni (sync lock). DB connection count, CPU.

### 2-bosqich (o‘rtacha)
- **Userlar:** 30 regular + 1 sync (jami 31).
- **Vaqt:** 5–10 daqiqa.
- **Buyruq:** `... -u 31 -r 4 -t 8m`
- **Kuzatish:** 1-bosqichdagi metrikalar + slow query, lock wait.

### 3-bosqich (yuqori)
- **Userlar:** 50 regular + 2 sync (jami 52).
- **Vaqt:** 10 daqiqa.
- **Buyruq:** `... -u 52 -r 6 -t 10m`
- **Kuzatish:** xuddi shu + deadlock, 503/504, connection pool.

**Har bosqichda:**
- Nimani kuzatish: Locust dashboard (RPS, failures, response times), server CPU/RAM, DB connections va slow query log.
- Qaysi loglar muhim: web (uvicorn/gunicorn), background worker (agar ishlatilsa), PostgreSQL log.
- Qaysi jadvallarni tekshirish: `smartup_sync_runs`, `orders`, `documents`, `user_sessions`, `audit_logs` — rekordlar va yangi qatorlar o‘sishi normal.
- **Qachon to‘xtatish:** failure rate >2–5%, p95 >5–10 s doimiy, 500/503 ko‘p, DB “too many connections” yoki deadlock.

---

## 4. Kuzatiladigan loglar va jadvallar

### Loglar
- **Web:** uvicorn/gunicorn stdout — 500, timeout, exception stack.
- **Worker:** SmartUp sync worker log — lock, xato, sync davomiyligi.
- **PostgreSQL:** slow query log, deadlock, “connection refused” / “too many connections”.

### Jadvallar (PostgreSQL)
- `smartup_sync_runs` — sync har bir chaqiruv (HTTP yoki worker) yozuvi, `status`, `error_message`, `synced_orders_count`.
- `orders` / `order_lines` — yangi/ yangilangan buyurtmalar (sync natijasi).
- `documents` — picking bilan bog‘liq o‘zgarishlar.
- `user_sessions` — test vaqtida ochilgan sessionlar (login ko‘p bo‘lsa sessionlar o‘sadi).
- `audit_logs` — order/document o‘zgarishlari.

### Qidiriladigan xatolar
- **500** — server xato.
- **Timeout** — sync yoki GET so‘rovlari uzoq davom etsa.
- **Lock not acquired / 409** — kutilgan (bitta sync); agar juda ko‘p bo‘lsa sync chastotani kamaytirish.
- **Integrity error** — unique/foreign key buzilishi (import yoki concurrent yozuv).
- **Too many connections** — DB pool yoki connection limit.
- **Slow query** — 1 s dan uzoq query’lar.
- **Deadlock** — DB deadlock log.

---

## 5. ENV o‘zgaruvchilar ro‘yxati

| O‘zgaruvchi | Majburiy | Default | Izoh |
|-------------|----------|---------|------|
| `BASE_URL` / `--host` | Ha | — | Backend host (masalan `https://wms-ngdm.onrender.com`) |
| `REGULAR_USERNAME` | Yo‘q | Test | Oddiy user login |
| `REGULAR_PASSWORD` | Yo‘q | 123456 | Oddiy user parol |
| `SYNC_USERNAME` | Yo‘q | Admin | orders:sync berilgan user (warehouse_admin) |
| `SYNC_PASSWORD` | Yo‘q | LOCUST_PASSWORD yoki 123456 | Sync user parol |
| `LOCUST_ENABLE_SYNC_USER` | Yo‘q | 1 | 1/true = sync task yoq, 0 = faqat GET |
| `LOCUST_SYNC_INTERVAL_MIN` | Yo‘q | 120 | Sync task minimal oraliq (sekund). Kamroq = tezroq sync |

Tayyor token ishlatish talab qilinmagan (Variant A: har user login).

---

## 6. Xavf va ehtiyot choralari

- **Production business data:** Testda faqat orders sync (oxirgi 7 kun default). Products sync, boshqa yozuvchi endpoint’lar scriptda yo‘q. Staging/test muhitida ishlatish ma’qul.
- **Sync chastotasi:** Sync user har loop’da emas, `LOCUST_SYNC_INTERVAL_MIN` (min 60 s) dan keyin chaqiradi; worker bilan collision bo‘lsa 409 — test davom etadi.
- **Worker bilan collision:** HTTP sync va worker sync bir vaqtda bitta sync qilmaydi (advisory lock). 409 = “sync already in progress” — kutilgan.
- **Sync user o‘chirish:** `LOCUST_ENABLE_SYNC_USER=0` — faqat oddiy GET trafik.
- **Parollar:** Production’da test user parolini kuchli qiling yoki testni staging’da o‘tkazing.
