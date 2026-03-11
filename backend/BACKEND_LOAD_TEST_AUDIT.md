# WMS Backend — Load test bo‘yicha texnik audit hisoboti

**Maqsad:** 50 concurrent user Locust test natijalariga asosan backend kod bazasini tahlil qilish: orders pagination, PostgreSQL indexlar, connection pool va 500 xatolar.

---

## 1) Muammo topilgan joylar

### Og‘ir endpointlar

| Endpoint | Fayl | Muammo (qisqa) |
|---------|------|----------------|
| `GET /api/v1/orders` | `app/api/v1/endpoints/orders.py` — `list_orders` (qator 355–521) | Har so‘rovda 2 ta asosiy query (count + data). Ro‘yxat uchun barcha order lines selectinload — faqat `lines_total` kerak. `brand_ids` branchda count va data uchun bir xil og‘ir query ikki marta ishlatiladi. |
| `GET /api/v1/dashboard/summary` | `app/api/v1/endpoints/dashboard.py` — `get_dashboard_summary` (59–139) | 6 ta alohida COUNT query (total_orders, completed_today, in_picking, active_pickers, new_orders_today). Bitta requestda 6 marta DB round-trip. |
| `GET /api/v1/dashboard/orders-by-status` | `app/api/v1/endpoints/dashboard.py` — `get_orders_by_status` (164–179) | Bitta GROUP BY query — yaxshi, lekin try/except yo‘q; DB timeout/error 500 qaytaradi. |
| `GET /api/v1/dashboard/pick-documents` | `app/api/v1/endpoints/dashboard.py` — `get_pick_documents` (187–232) | selectinload(lines, assigned_to_user, controlled_by_user, order). Har document uchun lines soni Python’da hisoblanadi (`len(doc.lines)`, `sum(1 for line...)`) — ma’lumot allaqachon yuklangan, ortiqcha emas, lekin limit/offset bor (50, 200 max). |
| `GET /api/v1/picking/documents` | `app/api/v1/endpoints/picking.py` — `list_picking_documents` (333–378) | Murakkab query: documents + outerjoin orders + outerjoin order_wms_state, selectinload(lines, assigned_to_user, order.wms_state). **limit/offset Query() bilan cheklanmagan** — default 50/0, lekin `limit=999999` yuborilsa qabul qilinadi. Try/except yo‘q. |

### Pagination yo‘q yoki noto‘g‘ri

- **`GET /api/v1/picking/documents`** (`picking.py` 335–337): `limit: int = 50`, `offset: int = 0` — `Query(50, ge=1, le=200)` yo‘q. Maksimal limit cheklanmagan.
- **`GET /api/v1/orders`**: pagination to‘g‘ri — `limit=Query(50, ge=1, le=200)`, `offset=Query(0, ge=0)` (364–365).
- **`GET /api/v1/dashboard/pick-documents`**: `limit=Query(50, ge=1, le=200)` (188) — to‘g‘ri.

### SELECT / JOIN / N+1 / COUNT

- **list_orders** (`orders.py` 368–371):  
  `query = db.query(OrderModel).options(selectinload(OrderModel.lines), selectinload(OrderModel.wms_state))`  
  Ro‘yxatda faqat `lines_total = len(order.lines)` va `status = order.wms_state.status` kerak. Barcha order lines ustunlari yuklanadi — bu ortiqcha ma’lumot (list uchun lines jadvali kerak emas, faqat count).
- **list_orders** (467–477): Documents uchun alohida query — `order_id.in_(order_ids)` va selectinload(assigned_to_user, controlled_by_user). N+1 yo‘q, bitta query.
- **list_picking_documents**: N+1 yo‘q; barcha kerakli relationlar selectinload orqali yuklanadi.
- **get_dashboard_summary**: Ortiqcha COUNT emas, lekin 6 ta alohida scalar query — round-trip ko‘p.

### Qisqacha

- **orders.py** `list_orders`: count + data 2 ta query; list uchun barcha order lines yuklanadi (faqat count kerak).
- **dashboard.py** `get_dashboard_summary`: 6 ta COUNT query.
- **dashboard.py** `get_orders_by_status`, **picking.py** `list_picking_documents`: try/except yo‘q — DB xatosi 500.
- **picking.py** `list_picking_documents`: limit/offset uchun max limit va `Query()` yo‘q.

---

## 2) Orders pagination bo‘yicha aniq tahlil

### Endpoint

- **Fayl:** `app/api/v1/endpoints/orders.py`
- **Funksiya:** `list_orders` (taxminan 355–521)

### Limit/offset

- **Default limit:** 50 (`Query(50, ge=1, le=200)`).
- **Maksimal limit:** 200 (`le=200`).
- **Offset:** `Query(0, ge=0)` — to‘g‘ri.

### Total hisoblash

- **brand_ids bo‘lmaganda** (458–465):  
  `total = query.with_entities(func.count(OrderModel.id)).order_by(None).scalar()`  
  Keyin: `orders = query.order_by(OrderModel.created_at.desc()).offset(offset).limit(limit).all()`  
  Ya’ni 2 ta query: biri count, biri data.
- **brand_ids bo‘lganda** (441–449):  
  `total = query.with_entities(OrderModel.id).count()`  
  `orders = query.order_by(...).offset(offset).limit(limit).all()`  
  Yana 2 ta query. `query` da `.distinct()` bor — count to‘g‘ri (distinct order soni).

### Frontend/API ortiqcha ma’lumot

- Ro‘yxat uchun har order uchun **barcha order lines** selectinload qilinadi (369–371), keyin faqat `lines_total=len(order.lines)` ishlatiladi. Lines ustunlari (sku, name, qty, ...) list response uchun kerak emas — ortiqcha yuklash.
- Response: `OrdersListResponse(items=..., total=total, limit=limit, offset=offset)` — to‘g‘ri format.

### Tezlashtirish uchun aniq taklif

1. **List uchun lines ni yuklamaslik:**  
   Ro‘yxatda faqat `lines_total` kerak bo‘lsa, `selectinload(OrderModel.lines)` ni olib tashlang va `lines_total` ni subquery yoki keyin alohida count query orqali oling.  
   **Variant:** `OrderModel` ga hybrid property yoki subquery:  
   `lines_total = db.query(func.count(OrderLineModel.id)).filter(OrderLineModel.order_id == OrderModel.id).correlate(OrderModel).scalar_subquery()`  
   yoki bitta query da order list olgach, `order_ids` uchun bitta  
   `SELECT order_id, count(*) FROM order_lines WHERE order_id IN (...) GROUP BY order_id`  
   qilish va `items` yig‘ishda shu map dan foydalanish.

2. **Count ni cache qilish (ixtiyoriy):**  
   Agar bir xil filterlar tez-tez so‘raladigan bo‘lsa, total ni qisqa muddat cache qilish (masalan 10–30 soniya) — frontend “total” ni ko‘rsatish uchun yetarli.

3. **Mavjud holatda:**  
   `order_by(OrderModel.created_at.desc())` — sort ustuni aniq. `orders.created_at` uchun index qo‘shilsa (pastda 3-bo‘lim) bu query tezlashadi.

---

## 3) PostgreSQL index bo‘yicha tahlil

### Orders va order_wms_state

**Ishlatiladigan ustunlar:**

- **list_orders:**  
  Filter: `OrderModel.source`, `OrderWmsStateModel.status`, `OrderModel.filial_id`, `OrderModel.delivery_date` (func.date), `OrderModel.order_number` / `customer_name` / `source_external_id` (ilike), `ProductModel.brand_id` (brand_ids orqali).  
  Sort: `OrderModel.created_at.desc()`.
- **get_orders_by_status:**  
  Join: `OrderModel.id == OrderWmsStateModel.order_id`.  
  Filter: `OrderWmsStateModel.status.in_(...)`.  
  Group: `OrderWmsStateModel.status`.
- **get_dashboard_summary:**  
  Join: `OrderModel.id == OrderWmsStateModel.order_id`.  
  Filter: `OrderWmsStateModel.status`, `OrderModel.filial_id`, `func.date(OrderWmsStateModel.updated_at)`, `func.date(OrderModel.created_at)`.

**Mavjud indexlar (model / alembic):**

- `orders`: `ix_orders_order_number`, `ix_orders_source`, `ix_orders_filial_id`.  
  **Yo‘q:** `orders.created_at`, `orders.delivery_date`.
- `order_wms_state`: `ix_order_wms_state_status` (status).  
  **Yo‘q:** `order_wms_state.updated_at` (sana bo‘yicha filter uchun).
- `order_lines`: `ix_order_lines_order_id`.

**Tavsiya:**

- `orders(created_at DESC)` — list_orders sort uchun.
- `orders(delivery_date)` — date_from/date_to filter uchun (ixtiyoriy, kerak bo‘lsa).
- `order_wms_state(status, updated_at)` — dashboard “completed_today” va “new_orders_today” ga yordam (status + date filter).

### Documents va picking

**Ishlatiladigan ustunlar:**

- **list_orders** (docs): `DocumentModel.order_id.in_(...)`, `DocumentModel.doc_type == "SO"`.
- **get_pick_documents:** `DocumentModel.doc_type == "SO"`, `DocumentModel.status`, `DocumentModel.updated_at` (ORDER BY).
- **list_picking_documents:**  
  Join: `DocumentModel.order_id == OrderModel.id`, `OrderModel.id == OrderWmsStateModel.order_id`.  
  Filter: `DocumentModel.assigned_to_user_id`, `DocumentModel.controlled_by_user_id`, `DocumentModel.status`, `OrderWmsStateModel.status`.  
  Sort: `DocumentModel.created_at.desc()`.

**Mavjud indexlar:**

- `documents`: `ix_documents_doc_no`, `ix_documents_status`, `ix_documents_source`, `ix_documents_source_external_id`, `ix_documents_assigned_to_user_id`, `ix_documents_controlled_by_user_id`.  
  **Yo‘q:** `documents.order_id`, `documents.doc_type` (alohida yoki composite).

**Tavsiya:**

- `documents(order_id)` — list_orders va picking join/filter uchun.
- `documents(doc_type, status)` — dashboard va picking “doc_type = SO” va status filter uchun.
- `documents(updated_at DESC)` yoki `documents(status, updated_at)` — pick-documents ro‘yxat sort uchun (kerak bo‘lsa).

### Tayyor CREATE INDEX (tavsiya etilgan)

```sql
-- orders: list_orders ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_orders_created_at ON orders (created_at DESC);

-- orders: delivery_date filter (date_from/date_to)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_orders_delivery_date ON orders (delivery_date) WHERE delivery_date IS NOT NULL;

-- order_wms_state: dashboard status + date filters
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_order_wms_state_status_updated_at ON order_wms_state (status, updated_at);

-- documents: list_orders va picking join/filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_documents_order_id ON documents (order_id) WHERE order_id IS NOT NULL;

-- documents: doc_type + status (dashboard, picking)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_documents_doc_type_status ON documents (doc_type, status);
```

Agar bitta jadvalga indexlar ko‘p bo‘lsa, faqat eng og‘ir querylar uchun (masalan `ix_orders_created_at`, `ix_documents_order_id`, `ix_documents_doc_type_status`) birinchi qadamda qo‘shish kifoya.

### Ortiqcha / yetishmayotgan xulosa

- **Yetishmayotgan:** `orders.created_at`, `documents.order_id`, `documents.doc_type` (yoki composite doc_type+status).  
- **Ortiqcha:** Asosan yo‘q; mavjud indexlar filter va join ustunlari uchun mos.

---

## 4) Connection pool / session management bo‘yicha tahlil

### Engine yaratilishi

- **Fayl:** `app/db.py`
- **Funksiya:** `create_engine_from_env()` (24–36)

```python
return create_engine(
    url,
    pool_pre_ping=True,
    pool_size=6,
    max_overflow=4,
    pool_recycle=300,
    pool_timeout=15,
    connect_args={"connect_timeout": 10},
)
```

Sozlamalar bor: `pool_size=6`, `max_overflow=4` (jami 10 connection), `pool_recycle=300`, `pool_timeout=15`, `pool_pre_ping=True`.

### Session

- **SessionLocal:** `sessionmaker(autocommit=False, autoflush=False, bind=get_engine())` — bitta engine.
- **get_db:** `def get_db() -> Generator[Session, None, None]: db = SessionLocal(); try: yield db; finally: db.close()` — har request uchun yangi session, response tugagach yopiladi. Dependency orqali ishlatilishi to‘g‘ri.

### Connection leak ehtimoli

- Barcha endpointlar `Depends(get_db)` ishlatadi; session faqat request davrida ochiladi va `finally` da yopiladi. Ochiq session qoldirish (masalan background task ichida db ishlatib, yopmaslik) kuzatilmadi.  
- **Xavf:** Agar biror joyda `db` ni yield dan oldin exception bo‘lsa, `finally` baribir ishlaydi — leak yo‘q.

### Optimal konfiguratsiya tavsiyasi

- **Render free Postgres:** ~20 connection limit; Web + Worker birga ishlasa, 10+ worker process bo‘lsa pool tez to‘lishi mumkin.
- **Hozirgi:** 6+4=10 — bitta process uchun o‘rtacha. Production’da bitta Gunicorn/Uvicorn worker uchun 10 yetarli; worker soni ko‘p bo‘lsa (masalan 4 worker × 10 = 40) DB limitdan oshadi.
- **Tavsiya:**  
  - `pool_size=4`, `max_overflow=2` (process uchun 6) — worker soni 2–3 bo‘lsa 12–18 connection.  
  - Yoki env orqali `POOL_SIZE` / `MAX_OVERFLOW` qilish va Render’dagi connection limitiga moslashtirish.  
  - `pool_timeout=10` — load paytida tezroq xato berib, client retry qilsin.  
  - `pool_recycle=300` — saqlab qolish mumkin.

---

## 5) 500 error ehtimoliy sabablari

Load testda 500 bergan endpointlar:  
`POST /api/v1/auth/login`, `GET /api/v1/dashboard/orders-by-status`, `GET /api/v1/picking/documents`.

### POST /api/v1/auth/login

- **Fayl:** `app/api/v1/endpoints/auth.py`, `login` (63–91).
- **Kod:** `_get_user_by_username` → `verify_password` → `create_access_token` → `db.query(UserSession).filter(...).order_by(...).all()` → `while` da `db.delete(...)` → `db.add(UserSession(...))` → `db.commit()`.
- **Try/except:** Yo‘q. Har qanday unhandled exception 500.
- **Ehtimoliy sabab:**  
  - Pool to‘lganida yoki DB timeout: `db.commit()` yoki `db.query` paytida SQLAlchemy timeout/connection error.  
  - Juda ko‘p concurrent login (masalan 50 user bir vaqtda Test bilan): bir xil user uchun sessiya delete/add — race bo‘lishi mumkin (IntegrityError kam, chunki unique constraint token ga emas).  
  - Asosiy: **DB connection pool exhaustion** yoki **Render Postgres transient error**.

### GET /api/v1/dashboard/orders-by-status

- **Fayl:** `app/api/v1/endpoints/dashboard.py`, `get_orders_by_status` (164–179).
- **Kod:** `db.query(OrderWmsStateModel.status, func.count(OrderModel.id)).join(...).filter(status.in_(...)).group_by(...).all()`.
- **Try/except:** Yo‘q.
- **Ehtimoliy sabab:** DB timeout yoki connection error — 500.

### GET /api/v1/picking/documents

- **Fayl:** `app/api/v1/endpoints/picking.py`, `list_picking_documents` (335–378).
- **Kod:** Murakkab query (documents + outerjoin orders + order_wms_state, selectinload), keyin `order_by(...).offset(offset).limit(limit).all()`.
- **Try/except:** Yo‘q.
- **Ehtimoliy sabab:** Query murakkab; pool timeout yoki DB overload — 500.

### Umumiy xulosa

Uchala endpointda **try/except yo‘q** — DB va connection xatolari to‘g‘ridan-to‘g‘ri 500 qaytaradi. Load paytida pool yoki DB vaqtincha yetishmasa, xato 500 bo‘ladi.  
**Tavsiya:** Bu endpointlarda DB/session xatolarini ushlab, log qilib, 503 yoki aniq 500 detail bilan javob qaytarish (va monitoring’da 500/503 ajratish).

---

## 6) Amaliy yechim

### Quick wins (tez tuzatishlar)

1. **picking/documents limit cheklash**  
   `app/api/v1/endpoints/picking.py` — `list_picking_documents`:  
   `limit: int = 50` → `limit: int = Query(50, ge=1, le=200)`, `offset: int = Query(0, ge=0)`.
2. **documents.order_id index**  
   `documents(order_id)` — list_orders va picking querylari tezlashadi.
3. **orders.created_at index**  
   `orders(created_at DESC)` — list_orders sort tezlashadi.
4. **500 uchun try/except**  
   `auth.py` login, `dashboard.py` get_orders_by_status, `picking.py` list_picking_documents — DB exception ni ushlab, log + 503 yoki 500 (detail bilan) qaytarish.

### High impact (katta ta’sir)

1. **list_orders da lines ni ro‘yxat uchun yuklamaslik**  
   Faqat `lines_total` kerak bo‘lsa, selectinload(OrderModel.lines) ni olib tashlash va count ni subquery yoki alohida GROUP BY orqali olish — response va DB yuki kamayadi.
2. **dashboard/summary bitta query yoki 2–3 query ga yig‘ish**  
   6 ta alohida COUNT o‘rniga 1–2 ta query (yoki CTE) bilan barcha metrikalarni hisoblash — round-trip kamayadi.
3. **documents(doc_type, status) index**  
   Dashboard va picking filterlari tezlashadi.

### Tavsiya etilgan kod o‘zgarishlari

- **orders.py**  
  - list_orders: ro‘yxatda order lines kerak bo‘lmasa, selectinload(lines) olib tashlash va lines_total ni subquery/separate count orqali berish.
- **dashboard.py**  
  - get_dashboard_summary: 6 ta query ni 1–2 ta query (yoki raw SQL/CTE) ga birlashtirish.  
  - get_orders_by_status: try/except (DB) + log + 503/500.
- **picking.py**  
  - list_picking_documents: limit/offset uchun Query(50, ge=1, le=200), Query(0, ge=0); try/except (DB) + log + 503/500.
- **auth.py**  
  - login: try/except (DB/session) + log + 503 yoki 500.

### Tavsiya etilgan SQL o‘zgarishlari

- `CREATE INDEX CONCURRENTLY ix_orders_created_at ON orders (created_at DESC);`
- `CREATE INDEX CONCURRENTLY ix_documents_order_id ON documents (order_id) WHERE order_id IS NOT NULL;`
- `CREATE INDEX CONCURRENTLY ix_documents_doc_type_status ON documents (doc_type, status);`
- (Ixtiyoriy) `ix_order_wms_state_status_updated_at`, `ix_orders_delivery_date`.

---

## 7) Final baho

### Yaxshi joylar

- Orders list pagination to‘g‘ri: limit 1–200, offset, total qaytariladi.
- Session bitta dependency orqali, har requestda yopiladi — connection leak yo‘q.
- Pool sozlamalari aniq: pool_pre_ping, pool_recycle, pool_timeout.
- Ko‘p joyda selectinload ishlatilgan — N+1 kam.
- order_wms_state.status, documents (status, assigned_to_user_id, controlled_by_user_id) da indexlar mavjud.

### Production uchun xavfli joylar

- Og‘ir endpointlarda try/except yo‘q — DB/connection xatolari 500.
- list_orders har safar barcha order lines ni yuklaydi — keraksiz yuk.
- documents.order_id va orders.created_at indexsiz — katta jadvalda sekinlashadi.
- Dashboard summary 6 ta alohida query — RPS oshganda DB load oshadi.
- Picking documents da limit maksimali cheklanmagan — bir so‘rovda juda ko‘p yuklanishi mumkin.

### Taxminiy bottleneck

1. **DB connection pool** — 50 concurrent user, har biri 2–3 ta query (count + data + docs) → pool tez to‘lishi mumkin; timeout 500 ga olib keladi.
2. **list_orders** — sort `created_at DESC` indexsiz; katta `orders` jadvalida sekin.
3. **documents query** — `order_id.in_(...)` va `doc_type = 'SO'` indexsiz; katta `documents` da sekin.

---

## "Men birinchi navbatda aynan mana shu 5 ta o‘zgarishni qilgan bo‘lardim"

1. **`documents(order_id)` index** — Alembic migratsiya: `CREATE INDEX ix_documents_order_id ON documents (order_id) WHERE order_id IS NOT NULL`. list_orders va picking querylari darhol yengillashadi.
2. **`orders(created_at DESC)` index** — list_orders sort tezlashadi.
3. **`list_picking_documents` da limit/offset** — `Query(50, ge=1, le=200)` va `Query(0, ge=0)` qo‘shish; maksimal limit 200.
4. **Login, get_orders_by_status, list_picking_documents** da DB exception ni ushlash — try/except ichida log + 503 (yoki 500 detail) qaytarish; production’da sababni ko‘rish va pool/DB sozlamalarini moslashtirish osonlashadi.
5. **list_orders da ro‘yxat uchun order lines ni yuklamaslik** — faqat `lines_total` kerak bo‘lsa, selectinload(lines) olib tashlash va count ni subquery yoki bitta GROUP BY query orqali olish — response hajmi va DB yuki kamayadi.

---

*Hisobot backend kod bazasining real fayl va qatorlari asosida tuzilgan.*
