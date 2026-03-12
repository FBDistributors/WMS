# SmartUp import optimizatsiyasi va mixed-load test — hisobot

---

## 1. Topilgan muammolar

| Fayl | Funksiya / joy | Muammo turi |
|------|----------------|-------------|
| **app/integrations/smartup/importer.py** | `import_orders` (eski: 74–155) | Har bir order uchun alohida `db.commit()` — N order = N transaction. |
| **app/integrations/smartup/importer.py** | `import_orders` (84–89) | Har order uchun 1 ta `db.query(Order).options(selectinload(Order.lines)).filter(source_external_id=...).one_or_none()` — ortiqcha emas, lekin batch qilinsa batch SELECT mumkin. |
| **app/integrations/smartup/importer.py** | `_enrich_order_line_names_from_products` (26–27) | Har line uchun `db.query(ProductModel).filter(ProductModel.sku == sku_str).first()` — N+1 (order lines soni bo‘yicha). |
| **app/integrations/smartup/products_sync.py** | `_sync_products` (eski: 158, 178) | Har bir product uchun `db.commit()` — N product = N transaction. |
| **app/workers/smartup_sync.py** | `run_full_sync`, `sync_orders`, `sync_products` | Worker va HTTP bir vaqtda sync qilsa race: ikkalasi ham `import_orders` chaqiradi, bir xil `source_external_id` ga parallel yozish. |
| **app/api/v1/endpoints/orders.py** | `sync_orders_from_smartup` (644) | Lock yo‘q — worker bilan bir vaqtda ishlashi mumkin. |
| **app/api/v1/endpoints/integrations.py** | `import_smartup_orders` (32) | Xuddi shunday lock yo‘q. |

**Qisqacha:** Order va product importda **per-item commit**; worker va HTTP **bir vaqtda** sync qilishi mumkin (race). N+1 faqat `_enrich_order_line_names_from_products` da (product lookup per line).

---

## 2. Batch commit refactor rejasi (bajarildi)

- **Orders:** `import_orders(db, orders, ..., batch_size=50)`.  
  - `_process_one_order(db, order, ..., do_commit=False)` — bitta orderni qayta ishlaydi, `do_commit=False` da commit qilmaydi.  
  - Chunk’lar: `orders_list` 50 tadan (default) bo‘linadi; har chunk uchun barcha order’lar `_process_one_order(..., do_commit=False)` bilan qayta ishlanadi, keyin bitta `db.commit()`.  
  - Chunk ichida exception bo‘lsa: `db.rollback()`, shu chunk per-order rejimda `_process_one_order(..., do_commit=True)` bilan qayta ishlanadi.  
  - `batch_size` 1–200 oralig‘ida (default 50).

- **Products:** `_sync_products(db, items, max_errors=50, batch_size=100)`.  
  - `_process_one_product(db, item, ..., do_commit=False)` — bitta product, commit ixtiyoriy.  
  - Chunk’lar 100 tadan (default); chunk bo‘yicha commit, xato bo‘lsa rollback va chunk per-item qayta ishlanadi.  
  - `batch_size` 1–200.

- **Commit strategiyasi:**  
  - Har order/product emas, **batch bo‘yicha** (50 order, 100 product).  
  - 1000 orderni 1 ta commit qilish xavfli emas (uzun lock, rollback qimmat) — shuning uchun 50/100 kabi o‘rtacha batch.  
  - 50 order: ~50 INSERT/UPDATE + order_lines; 100 product: ~100 row. Postgres va connection pool uchun ma’qul.

---

## 3. Mixed-load testga tayyorlash rejasi

- **Qaysi endpoint xavfsizroq:**  
  - **POST /api/v1/orders/sync-smartup** — faqat orders import, muddati qisqa; mixed-load da avval shuni qo‘shish ma’qul.  
  - **POST /api/v1/integrations/smartup/import** — bir xil `import_orders`, sana orqali; xuddi shunday xavfsiz.  
  - **POST /api/v1/products/sync-smartup** — products sync uzoqroq va og‘irroq; keyin qo‘shish kerak.

- **Avval qaysi sync:** Avval **orders sync** (POST /api/v1/orders/sync-smartup) — tezroq, DB yukini ko‘rish oson. Keyin products.

- **Products sync ni darhol qo‘shish:** Yo‘q. Avval oddiy user traffic + orders sync, keyin products sync ni aralashga qo‘shish.

- **Background worker:** Mixed-load testda worker’ni **vaqtincha o‘chirish** ma’qul (yoki intervalni kattalashtirish). Lock bor bo‘lsa ham, bir vaqtda 1 ta sync ishlaydi — testni tahlil qilish osonroq bo‘ladi.

- **Kuzatish:**  
  - **Log:** `import_orders done: created=...`, worker `SmartUp full sync finished`, `Orders sync: ... buyurtma`.  
  - **Jadval:** `smartup_sync_runs` (run_type, status, started_at, finished_at, synced_orders_count, error_message).

**Bosqichlar:**

1. **1-bosqich:** Oddiy user traffic (login, dashboard, orders, picking) + **faqat** POST /api/v1/orders/sync-smartup (kam vazn, masalan 1–2 “admin” user, 60–120 s da bir marta). Worker o‘chiq. Kuzatish: RPS, 409 (sync in progress), 500, `smartup_sync_runs`.
2. **2-bosqich:** Xuddi shunday, lekin worker yoq (interval 600). Lock tufayli HTTP yoki worker bittasi ishlaydi; log’da “SmartUp sync lock not acquired” yoki 409 ko‘rinishi kerak.
3. **3-bosqich:** Products sync ni Locust’ga qo‘shish (past vazn), yoki alohida test (POST /api/v1/products/sync-smartup).

---

## 4. Kod darajasidagi qilingan o‘zgarishlar

### 4.1. Batch commit — import_orders (importer.py)

- **Yangi:** `_process_one_order(db, order, override, order_source, skipped_by_reason, errors, do_commit)` — bitta orderni qayta ishlaydi; `do_commit=True` bo‘lganda commit, aks holda yo‘q.
- **Yangi:** `import_orders(..., batch_size=50)`. Chunk’larga bo‘lib, chunk uchun barcha order’larni `do_commit=False` bilan chaqiradi, keyin `db.commit()`. Exception bo‘lsa chunk per-order `do_commit=True` bilan qayta ishlanadi.
- **Log:** `import_orders done: created=... updated=... skipped=... errors=... batch_size=...`

### 4.2. Batch commit — _sync_products (products_sync.py)

- **Yangi:** `_process_one_product(db, item, unknown_codes, errors, max_errors, do_commit)` — bitta product; `do_commit` commitni boshqaradi.
- **Yangi:** `_sync_products(..., batch_size=100)`. Chunk’lar 100 tadan; chunk bo‘yicha commit, xato bo‘lsa rollback va chunk per-item.

### 4.3. Advisory lock (sync_lock.py + worker + HTTP)

- **Yangi fayl:** `app/integrations/smartup/sync_lock.py` — `try_acquire_sync_lock(db)`, `release_sync_lock(db)`, `smartup_sync_lock(db)` (context manager). Lock key: 70000.
- **Worker:** `run_full_sync` boshida `lock_db = SessionLocal()`, `with smartup_sync_lock(lock_db) as acquired:` — agar lock olinmasa sync o‘tkazilmaydi.
- **HTTP:** `POST /api/v1/orders/sync-smartup` va `POST /api/v1/integrations/smartup/import` boshida `try_acquire_sync_lock(db)` — olinmasa **409** (SmartUp sync already in progress). Session yopilganda lock avtomatik bo‘shatiladi.

---

## 5. SQL / migration tavsiyalari

- **Indexlar:** Orders va documents uchun auditda kiritilgan indexlar (idx_orders_created_at, idx_documents_order_id, idx_documents_doc_type_status) import tezligiga ham yordam beradi. Qo‘shimcha migration kerak emas.
- **Unique:** `orders.source_external_id` allaqachon unique — dublikat order insert IntegrityError beradi, import_orders xatoni ushlaydi va keyingi order’ga o‘tadi.
- **Advisory lock:** Faqat PostgreSQL session’da `pg_try_advisory_lock(70000)` — alohida jadval yoki migration kerak emas.

---

## 6. Xavf va ehtiyot choralari

- **Sync endpoint’lar real business data’ni o‘zgartiradi:** orders, order_lines, order_wms_state, products, product_barcodes. Testda real SmartUp’dan keladigan ma’lumot import qilinadi — staging’da test qilish ma’qul.
- **Dublikat order:** `source_external_id` unique; qayta import’da update bo‘ladi, dublikat qator yaratilmaydi.
- **Test user filter:** Importda “faqat Test user” filter yo‘q — sync barcha order/product’lar uchun. Testni staging yoki test ma’lumot bazasida qilish xavfsizroq.
- **Production’da ehtiyotkor:** Production’da mixed-load test qilinsa — sync endpoint’ni kam vazn bilan chaqirish, worker intervalni oshirish; lock tufayli bir vaqtda bitta sync ishlaydi.

**Xavf darajasi:** **O‘rta.** Sync business data’ni o‘zgartiradi; lock va idempotent upsert (source_external_id) race va dublikatni kamaytiradi. Staging’da test — past xavf; production’da sync’ni load testda kam chaqirish — o‘rta.

---

## 7. Birinchi navbatda qiladigan 5 ta o‘zgarish (bajarilgan)

1. **Orders import’da batch commit** — `import_orders` da `batch_size=50`, chunk bo‘yicha commit; xato bo‘lsa chunk per-order fallback.  
2. **Products sync’da batch commit** — `_sync_products` da `batch_size=100`, chunk bo‘yicha commit.  
3. **Advisory lock** — `sync_lock.py`, worker’da `smartup_sync_lock`, HTTP’da `try_acquire_sync_lock` va 409.  
4. **Import’dan keyin log** — `import_orders` oxirida `logger.info("import_orders done: created=...")`.  
5. **Mixed-load rejasi** — avval orders sync + oddiy user, worker o‘chiq; keyin worker yoq; keyin (ixtiyoriy) products sync.

---

## 8. Diff xulosasi (asosiy o‘zgarishlar)

- **app/integrations/smartup/importer.py:** `_process_one_order` qo‘shildi, `import_orders` chunk’lar va `batch_size` bilan qayta yozildi, oxirida info log.
- **app/integrations/smartup/products_sync.py:** `_process_one_product` qo‘shildi, `_sync_products` chunk va `batch_size` bilan qayta yozildi.
- **app/integrations/smartup/sync_lock.py:** Yangi — `try_acquire_sync_lock`, `release_sync_lock`, `smartup_sync_lock`.
- **app/workers/smartup_sync.py:** `smartup_sync_lock(lock_db)` ichida `run_full_sync` ishlashi.
- **app/api/v1/endpoints/orders.py:** `sync_orders_from_smartup` boshida `try_acquire_sync_lock(db)` va 409.
- **app/api/v1/endpoints/integrations.py:** `import_smartup_orders` boshida `try_acquire_sync_lock(db)` va 409.

---

*Kod o‘zgartirilgan; batch commit va lock ishlatiladi.*
