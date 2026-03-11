# Backend Optimization Patch

Audit natijalariga asosan amalga oshirilgan o‘zgarishlar.

---

## 1. O‘zgargan fayllar

| Fayl | O‘zgarish |
|------|-----------|
| `alembic/versions/20260311_0053_load_test_indexes.py` | **Yangi** — 3 ta index migratsiyasi |
| `app/db.py` | Pool sozlamalari env orqali (pool_size=20, max_overflow=30, pool_timeout=30, pool_recycle=1800) |
| `app/main.py` | Request time logging middleware qo‘shildi |
| `app/api/v1/endpoints/orders.py` | list_orders: selectinload(lines) olib tashlandi, lines_total bitta GROUP BY dan, limit 20/100 |
| `app/api/v1/endpoints/picking.py` | list_picking_documents: limit/offset Query(50, ge=1, le=200), try/except 500 |
| `app/api/v1/endpoints/dashboard.py` | summary: 6 ta COUNT 2 ta queryga birlashtirildi; orders-by-status try/except |
| `app/api/v1/endpoints/auth.py` | login: try/except, logger |

---

## 2. Diff xulosasi

### db.py
- `create_engine_from_env()`: `pool_size`, `max_overflow`, `pool_timeout`, `pool_recycle` endi `os.getenv("POOL_SIZE", "20")` va shu kabi env dan olinadi (default 20, 30, 30, 1800).

### main.py
- `RequestTimeLoggingMiddleware`: har requestdan keyin `logger.info("%s %s %s - %.0fms", method, path, status_code, elapsed_ms)`.
- Middleware `app.add_middleware(RequestTimeLoggingMiddleware)` orqali qo‘shilgan.

### orders.py (list_orders)
- `limit=Query(20, ge=1, le=100)`, offset o‘zgarishsiz.
- `query.options(selectinload(OrderModel.lines), selectinload(wms_state))` → faqat `selectinload(OrderModel.wms_state)`.
- `order_ids` dan keyin bitta `db.query(OrderLineModel.order_id, func.count(...)).filter(order_id.in_(order_ids)).group_by(OrderLineModel.order_id).all()` va `lines_by_order` map.
- `lines_total=len(order.lines)` → `lines_total=lines_by_order.get(order.id, 0)`.

### picking.py (list_picking_documents)
- `limit: int = 50` → `limit: int = Query(50, ge=1, le=200)`, `offset: int = Query(0, ge=0)`.
- Query + return atrofida `try: ... except Exception: logger.exception(...); raise HTTPException(500, "Internal error")`.

### dashboard.py
- **summary:** 6 ta alohida COUNT o‘rniga:
  - 1 ta order query: `func.count(case(...))` bilan total_orders, completed_today, new_orders_today.
  - 1 ta document query: in_picking (count(*)), active_pickers (count(distinct assigned_to_user_id)).
- **orders-by-status:** barcha DB ishi `try/except` ichida, xato bo‘lsa `logger.exception` + `HTTPException(500, "Internal error")`.

### auth.py (login)
- Barcha login logikasi `try:` ichida; `except HTTPException: raise`; `except Exception: logger.exception("login endpoint error"); raise HTTPException(500, "Internal error")`.

---

## 3. Yangi migration va SQL

**Fayl:** `alembic/versions/20260311_0053_load_test_indexes.py`  
**Revises:** `20260311_0052`

**upgrade:**
```sql
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_order_id ON documents (order_id);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type_status ON documents (doc_type, status);
```

**downgrade:** shu indexlarni `DROP INDEX IF EXISTS` qiladi.

Ishga tushirish: `alembic upgrade head`

---

## 4. Qaysi endpoint tezlashadi

| Endpoint | Sabab |
|----------|--------|
| `GET /api/v1/orders` | Ro‘yxatda order lines yuklanmaydi, faqat bitta GROUP BY bilan lines_total; `ORDER BY created_at DESC` uchun `idx_orders_created_at`; default limit 20, max 100. |
| `GET /api/v1/dashboard/summary` | 6 o‘rniga 2 ta DB query (order metrikalari bitta, document metrikalari bitta). |
| `GET /api/v1/dashboard/orders-by-status` | `idx_order_wms_state_status` (mavjud) + `idx_documents_doc_type_status` document querylariga yordam; 500 ataylab handle qilinadi. |
| `GET /api/v1/picking/documents` | `idx_documents_order_id`, `idx_documents_doc_type_status` join/filter uchun; limit 200 gacha cheklangan. |
| `POST /api/v1/auth/login` | 500 barqaror (try/except); pool kengaytirilgani bilan connection timeout kamayishi mumkin. |

---

## 5. Qisqacha

- **Indexlar:** orders(created_at DESC), documents(order_id), documents(doc_type, status).
- **Pagination:** orders list limit 20/100; picking documents limit 50/200, offset 0+.
- **list_orders:** lines ro‘yxatda yuklanmaydi, faqat bitta count query; detail endpointda lines qoladi.
- **Dashboard summary:** 2 ta query (order counts + document counts).
- **500:** login, orders-by-status, list_picking_documents da try/except + log + HTTP 500.
- **Pool:** POOL_SIZE, MAX_OVERFLOW, POOL_TIMEOUT, POOL_RECYCLE env (default 20, 30, 30, 1800).
- **Logging:** har request uchun `METHOD path STATUS - Xms`.
