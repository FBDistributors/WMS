# PostgreSQL Index Audit Report — WMS Backend

**Loyiha:** WMS backend  
**Maqsad:** Yangi indexlar qo‘shishdan oldin hozirgi index holati va query patternlar bo‘yicha texnik audit.  
**Talab:** Yangi migration yozilmaydi — faqat audit.

---

## 1. HOZIRGI INDEX HOLATI (JADVALMA-JADVAL)

### 1.1 `orders`
| Manba | Index / Constraint | Ustunlar | Izoh |
|-------|-------------------|----------|------|
| Model | — | — | Order modelida `__table_args__` da index yo‘q |
| Migration 0010 | `ix_orders_status` | `status` | 0052 da drop, keyin qayta create |
| Migration 0010 | `ix_orders_order_number` | `order_number` | |
| Migration 0010 | `ix_orders_source` | `source` | |
| Migration 0010 | `ix_orders_filial_id` | `filial_id` | |
| Migration 0052 | `ix_orders_status` | `status` | (qayta yaratilgan) |
| Migration 0053 (raw SQL) | `idx_orders_created_at` | `created_at DESC` | Load test uchun |
| UniqueConstraint (model) | `uq_orders_source_external_id` | `source_external_id` | PK emas, unique |
| **PK** | `orders_pkey` | `id` | |

**Indekslangan ustunlar:** `id`, `status`, `order_number`, `source`, `filial_id`, `created_at` (DESC), `source_external_id` (unique).

---

### 1.2 `order_wms_state`
| Manba | Index / Constraint | Ustunlar |
|-------|-------------------|----------|
| Model | `ix_order_wms_state_status` | `status` |
| **PK** | `order_wms_state_pkey` | `order_id` (FK → orders.id) |

---

### 1.3 `order_lines`
| Manba | Index / Constraint | Ustunlar |
|-------|-------------------|----------|
| Model | `ix_order_lines_order_id` | `order_id` |
| **PK** | `order_lines_pkey` | `id` |

---

### 1.4 `documents`
| Manba | Index / Constraint | Ustunlar |
|-------|-------------------|----------|
| Model | `ix_documents_doc_no` | `doc_no` |
| Model | `ix_documents_status` | `status` |
| Model | `ix_documents_source` | `source` |
| Model | `ix_documents_source_external_id` | `source_external_id` |
| Model | `ix_documents_assigned_to_user_id` | `assigned_to_user_id` |
| Model | `ix_documents_controlled_by_user_id` | `controlled_by_user_id` |
| Migration 0053 (raw SQL) | `idx_documents_order_id` | `order_id` |
| Migration 0053 (raw SQL) | `idx_documents_doc_type_status` | `doc_type`, `status` |
| UniqueConstraint (model) | `uq_documents_doc_no_doc_type` | `doc_no`, `doc_type` |
| UniqueConstraint (model) | `uq_documents_source_external_id_doc_type` | `source_external_id`, `doc_type` |
| **PK** | `documents_pkey` | `id` |

**Indekslangan ustunlar:** `id`, `doc_no`, `status`, `source`, `source_external_id`, `assigned_to_user_id`, `controlled_by_user_id`, `order_id`, `(doc_type, status)`.

---

### 1.5 `document_lines`
| Manba | Index / Constraint | Ustunlar |
|-------|-------------------|----------|
| Model | `ix_document_lines_document_id` | `document_id` |
| Model | `ix_document_lines_product_id` | `product_id` |
| Model | `ix_document_lines_lot_id` | `lot_id` |
| Model | `ix_document_lines_location_id` | `location_id` |
| **PK** | `document_lines_pkey` | `id` |

---

### 1.6 `products`
| Manba | Index / Constraint | Ustunlar |
|-------|-------------------|----------|
| Model | `ix_products_sku` | `sku` |
| Model | `ix_products_name` | `name` |
| Model | `ix_products_external_id` | `external_id` |
| Model | `ix_products_smartup_code` | `smartup_code` |
| Model | `ix_products_barcode` | `barcode` |
| Model | `ix_products_is_active` | `is_active` |
| Model | `ix_products_brand_id` | `brand_id` |
| Model | `ix_products_brand_code` | `brand_code` |
| Model | `uq_products_external_source_external_id` | `external_source`, `external_id` (unique) |
| **PK** | `products_pkey` | `id` |
| Column | `sku` | `unique=True` → PostgreSQL unique index |

---

### 1.7 `product_barcodes`
| Manba | Index / Constraint | Ustunlar |
|-------|-------------------|----------|
| Model | `ix_product_barcodes_barcode` | `barcode` |
| Column | `barcode` | `unique=True` |
| **PK** | `product_barcodes_pkey` | `id` |

---

### 1.8 `users`
| Manba | Index / Constraint | Ustunlar |
|-------|-------------------|----------|
| Model | `ix_users_code` | `code` |
| Model | `ix_users_username` | `username` |
| Model | `ix_users_full_name` | `full_name` |
| Model | `ix_users_active_session` | `active_session_token` (partial: WHERE active_session_token IS NOT NULL) |
| Column | `code` | `unique=True` |
| Column | `username` | `unique=True` |
| **PK** | `users_pkey` | `id` |

---

### 1.9 `user_sessions`
| Manba | Index / Constraint | Ustunlar |
|-------|-------------------|----------|
| Migration 0029 | `ix_user_sessions_user_id` | `user_id` |
| Migration 0029 | `ix_user_sessions_token` | `token` |
| **PK** | `user_sessions_pkey` | `id` |

*Modelda `__table_args__` yo‘q — indexlar faqat migrationda.*

---

### 1.10 `user_fcm_tokens`
| Manba | Index / Constraint | Ustunlar |
|-------|-------------------|----------|
| Model | `ix_user_fcm_tokens_user_id` | `user_id` |
| Model | `ix_user_fcm_tokens_token` | `token` (unique) |
| **PK** | `user_fcm_tokens_pkey` | `id` |

---

### 1.11 `smartup_sync_runs`
| Manba | Index / Constraint | Ustunlar |
|-------|-------------------|----------|
| Migration 0019 | `ix_smartup_sync_runs_run_type` | `run_type` |
| Migration 0031 | `ix_smartup_sync_runs_started_at` | `started_at` |
| **PK** | `smartup_sync_runs_pkey` | `id` |

*Modelda `__table_args__` yo‘q.*

---

### 1.12 `locations`
| Manba | Index / Constraint | Ustunlar |
|-------|-------------------|----------|
| Model | `ix_locations_parent_id` | `parent_id` |
| Model | `ix_locations_type` | `type` |
| Model | `ix_locations_is_active` | `is_active` |
| Model | `ix_locations_sector` | `sector` |
| Model | `ix_locations_location_type` | `location_type` |
| Model | `ix_locations_zone_type` | `zone_type` |
| Model | `ix_locations_warehouse_id` | `warehouse_id` |
| Migration 0030 | `ix_locations_barcode_value` | `barcode_value` (unique) |
| Migration 0034 | `ix_locations_code` | `code` |
| Column | `code` | `unique=True` |
| Column | `barcode_value` | `unique=True` |
| Migration 0039 | `ix_locations_pick_sequence` | `pick_sequence` |
| **PK** | `locations_pkey` | `id` |

---

### 1.13 `stock_lots`
| Manba | Index / Constraint | Ustunlar |
|-------|-------------------|----------|
| Model | `ix_stock_lots_product_id` | `product_id` |
| Model | `ix_stock_lots_expiry_date` | `expiry_date` |
| Model | `uq_stock_lots_product_batch_expiry` | `product_id`, `batch`, `expiry_date` (unique) |
| Migration 0026 | `ix_stock_lots_fefo` | `product_id`, `expiry_date`, `id` |
| **PK** | `stock_lots_pkey` | `id` |

---

### 1.14 `stock_movements`
| Manba | Index / Constraint | Ustunlar |
|-------|-------------------|----------|
| Model | `ix_stock_movements_product_id` | `product_id` |
| Model | `ix_stock_movements_lot_id` | `lot_id` |
| Model | `ix_stock_movements_location_id` | `location_id` |
| Model | `ix_stock_movements_type` | `movement_type` |
| Model | `ix_stock_movements_created_at` | `created_at` |
| Model | `ix_stock_movements_source_doc` | `source_document_type`, `source_document_id` |
| Model | `ix_stock_movements_product_lot_location` | `product_id`, `lot_id`, `location_id` |
| Model | `ix_stock_movements_reason_code` | `reason_code` |
| **PK** | `stock_movements_pkey` | `id` |

---

### 1.15 `audit_logs`
| Manba | Index / Constraint | Ustunlar |
|-------|-------------------|----------|
| Migration 0033 | `ix_audit_logs_entity_type` | `entity_type` |
| Migration 0033 | `ix_audit_logs_entity_id` | `entity_id` |
| Migration 0033 | `ix_audit_logs_user_id` | `user_id` |
| Migration 0033 | `ix_audit_logs_created_at` | `created_at` |
| **PK** | `audit_logs_pkey` | `id` |

*Modelda `__table_args__` yo‘q.*

---

### 1.16 `pick_requests`
| Manba | Index / Constraint | Ustunlar |
|-------|-------------------|----------|
| Model | `ix_pick_requests_request_id` | `request_id` (unique) |
| **PK** | `pick_requests_pkey` | `id` |

---

### 1.17 `waves`, `wave_orders`, `wave_lines`, `wave_allocations`, `sorting_bins`, `wave_pick_scans`, `sorting_scans`
*Model va migrationlarda ko‘rsatilgan indexlar mavjud (status, wave_number, wave_id, order_id, product_id, barcode, stock_lot_id, wave_line_id va b. — 0035).*

---

### 1.18 `brands`
| Model | `ix_brands_code` | `code` |
| Model | `ix_brands_is_active` | `is_active` |
| Column | `code` | `unique=True` |
| **PK** | `brands_pkey` | `id` |

---

### 1.19 `receipts`, `receipt_lines`
*Model va 0013: status, created_at, receipt_id, product_id, location_id.*

---

### 1.20 `vip_customers`
| Model | `ix_vip_customers_customer_id` | `customer_id` |
| Column | `customer_id` | `unique=True` |

---

## 2. ENG MUHIM QUERY PATTERNLAR

### 2.1 `/api/v1/orders` (list_orders — `app/api/v1/endpoints/orders.py`)

| Turi | Ustunlar / Jadval | Kod joyi |
|------|-------------------|----------|
| WHERE | `OrderModel.source` | 367 |
| WHERE | `OrderWmsStateModel.status` (join orders ↔ order_wms_state) | 375–387 |
| WHERE | `DocumentModel.order_id`, `DocumentModel.doc_type == "SO"` (EXISTS subquery) | 284–288 |
| WHERE | `OrderModel.order_number`, `source_external_id`, `customer_name`, `customer_id`, `agent_name` (ILIKE) | 307–312 |
| WHERE | `OrderModel.filial_id` | 317–321 |
| WHERE | `func.date(OrderModel.delivery_date)` (date_from, date_to) | 324–326 |
| WHERE | `OrderLineModel.order_id`, `ProductModel.sku`, `ProductModel.brand_id` (brand_ids) | 334–341 |
| ORDER BY | `OrderModel.created_at.desc()` | 448, 456, 464 |
| Pagination | `offset`, `limit` | 448, 456, 464 |
| Keyin alohida | `OrderLineModel.order_id.in_(order_ids)` GROUP BY order_id (count) | 363–368 |
| Keyin alohida | `DocumentModel.order_id.in_(order_ids)`, `doc_type == "SO"` | 370–378 |

**Xulosa:** Asosiy filterlar: `orders.filial_id`, `order_wms_state.status`, `orders.source`, `orders.delivery_date` (sana), `orders.created_at` (sort). Join: orders ↔ order_wms_state; ba’zan order_lines ↔ products (brand filter). Document by order_id — idx_documents_order_id mavjud.

---

### 2.2 `/api/v1/dashboard/summary` (dashboard.py)

| Turi | Ustunlar / Jadval | Kod joyi |
|------|-------------------|----------|
| WHERE | `OrderModel.filial_id == DEFAULT_FILIAL_ID` | 72, 76 |
| FROM/JOIN | `OrderModel` JOIN `OrderWmsStateModel` (order_id) | 76–104 |
| Aggregation | `OrderWmsStateModel.status == "B#S"` (total_orders) | 77 |
| Aggregation | `OrderWmsStateModel.status.in_(("packed","shipped"))`, `func.date(OrderWmsStateModel.updated_at) == today` | 80–86 |
| Aggregation | `OrderWmsStateModel.status == "B#S"`, `func.date(OrderModel.created_at) == today` | 92–99 |
| Keyin | `DocumentModel`: WHERE `doc_type == "SO"`, `status.in_(...)` | 111–119 |

**Xulosa:** orders + order_wms_state join, filial_id, status, updated_at (sana), orders.created_at (sana). Documents: doc_type, status.

---

### 2.3 `/api/v1/dashboard/orders-by-status` (dashboard.py)

| Turi | Ustunlar / Jadval | Kod joyi |
|------|-------------------|----------|
| JOIN | OrderModel ↔ OrderWmsStateModel | 166–168 |
| WHERE | `OrderWmsStateModel.status.in_(ORDER_STATUSES_FOR_COUNTS)` | 167 |
| GROUP BY | `OrderWmsStateModel.status` | 168 |

**Xulosa:** order_wms_state.status — ix_order_wms_state_status yetarli.

---

### 2.4 `/api/v1/dashboard/pick-documents` (dashboard.py)

| Turi | Ustunlar / Jadval | Kod joyi |
|------|-------------------|----------|
| WHERE | `DocumentModel.doc_type == "SO"`, `status != "cancelled"` | 204 |
| WHERE | `DocumentModel.status == status` (param) | 206 |
| ORDER BY | `DocumentModel.updated_at.desc()` | 207 |
| Pagination | offset, limit | 207 |

**Xulosa:** doc_type, status, updated_at (sort). idx_documents_doc_type_status bor; updated_at uchun index yo‘q.

---

### 2.5 `/api/v1/picking/documents` (list_picking_documents — picking.py)

| Turi | Ustunlar / Jadval | Kod joyi |
|------|-------------------|----------|
| FROM | DocumentModel | 334 |
| JOIN | OrderModel (order_id), OrderWmsStateModel (order_id) | 341–342 |
| WHERE | Order hidden statuses YOKI order_id IS NULL | 343–348 |
| WHERE | `DocumentModel.assigned_to_user_id == user.id` (picker) | 351 |
| WHERE | `DocumentModel.controlled_by_user_id`, `DocumentModel.status` (controller) | 363–366 |
| WHERE | `DocumentModel.status != "cancelled"` | 368 |
| ORDER BY | `DocumentModel.created_at.desc()` | 379 |
| Pagination | offset, limit | 379 |

**Xulosa:** documents: assigned_to_user_id, controlled_by_user_id, status, doc_type (so‘rovda aniq yozilmagan, lekin SO tanlanadi), created_at (sort). Join: documents.order_id → orders, order_wms_state.

---

### 2.6 `/api/v1/auth/login` (auth.py, deps.py)

| Turi | Ustunlar / Jadval | Kod joyi |
|------|-------------------|----------|
| WHERE | `User.username == payload.username` | auth.py 63 |
| Keyin | `UserSession`: WHERE `user_id == user.id` ORDER BY created_at | auth.py 79–82 |
| JWT tekshiruv | `User.id == user_id` (deps) | deps.py 36 |
| Session tekshiruv | `UserSession.user_id`, `UserSession.token` | deps.py 42–44 |

**Xulosa:** users.username (ix_users_username bor), user_sessions (user_id, token) — migration 0029 da ix_user_sessions_user_id, ix_user_sessions_token bor.

---

### 2.7 Smartup orders sync (importer.py)

| Turi | Ustunlar / Jadval | Kod joyi |
|------|-------------------|----------|
| WHERE | `Order.source_external_id == external_id` | 72–76 |
| Product | `ProductModel.sku == sku_str` (_enrich_order_line_names_from_products) | 29 |

**Xulosa:** orders.source_external_id (unique constraint index), products.sku (ix_products_sku).

---

### 2.8 Smartup products sync (products_sync.py)

| Turi | Ustunlar / Jadval | Kod joyi |
|------|-------------------|----------|
| WHERE | `Brand.code == brand_code`, `Brand.is_active` | 92–95 |
| WHERE | `Product.external_source == "smartup"`, `Product.external_id == external_id` | 104–108 |

**Xulosa:** products (external_source, external_id) — uq_products_external_source_external_id bor. brands (code, is_active) — ix_brands_code, ix_brands_is_active.

---

### 2.9 Picking: document lines (document_id + sort) — picking.py

| Turi | Ustunlar / Jadval | Kod joyi |
|------|-------------------|----------|
| WHERE | `DocumentLineModel.document_id` | 313, 341, 411, 432, 442, 538, 606, 658 |
| JOIN | LocationModel (location_id) | 312, 341, 411 |
| ORDER BY | `DocumentLineModel.expiry_date.asc().nulls_last()`, `LocationModel.pick_sequence`, `LocationModel.code`, `DocumentLineModel.id` | 322–318, 452–457, 606–611 |

**Xulosa:** document_lines.document_id indekslangan. Sort: document_lines (expiry_date, id), locations (pick_sequence, code). document_id + expiry_date composite sort uchun foydali bo‘lishi mumkin.

---

### 2.10 My picker stats (picking.py)

| Turi | Ustunlar / Jadval | Kod joyi |
|------|-------------------|----------|
| WHERE | `DocumentModel.doc_type == "SO"`, `status == "completed"`, assigned_to_user_id \| controlled_by_user_id | 461–468, 470–478, 483–491 |
| WHERE | `func.date(DocumentModel.updated_at)` (sana oralig‘i) | 472, 487–489 |
| GROUP BY | `func.date(DocumentModel.updated_at)` | 494 |
| ORDER BY | `func.date(DocumentModel.updated_at)` | 495 |

**Xulosa:** documents (doc_type, status, assigned_to_user_id, controlled_by_user_id, updated_at). (doc_type, status) index bor; updated_at va (assigned_to_user_id, controlled_by_user_id) bilan filter murakkab.

---

### 2.11 Smartup sync runs list (products.py / integrations)

| Turi | Ustunlar / Jadval | Kod joyi |
|------|-------------------|----------|
| WHERE | `SmartupSyncRun.run_type == run_type` (ixtiyoriy) | 219 |
| ORDER BY | `SmartupSyncRun.started_at.desc()` | 217 |
| LIMIT | 20 | 217 |

**Xulosa:** run_type, started_at — ikkala index migrationda mavjud.

---

## 3. YETISHMAYOTGAN INDEXLAR

- **orders.delivery_date**  
  - **Query:** `list_orders` da `func.date(OrderModel.delivery_date) >= date_from` va `<= date_to`.  
  - **Hozir:** delivery_date ustunida index yo‘q.  
  - **Tavsiya:** Sana bo‘yicha range filter uchun `(delivery_date)` yoki expression index `(date(delivery_date))` — expression index aniq sana solishtirish uchun samaraliroq bo‘lishi mumkin.  
  - **Ta’sir:** medium (sana filter ishlatilsa).

- **documents.updated_at**  
  - **Query:** Dashboard pick-documents: `order_by(DocumentModel.updated_at.desc())`, offset/limit.  
  - **Hozir:** updated_at da index yo‘q.  
  - **Tavsiya:** `(doc_type, status, updated_at DESC)` yoki kamida `(updated_at DESC)` — ro‘yxat va dashboard tezlashtiradi.  
  - **Ta’sir:** high (dashboard va pick-documents ro‘yxati).

- **documents.created_at**  
  - **Query:** Picking documents: `order_by(DocumentModel.created_at.desc())`, offset/limit.  
  - **Hozir:** created_at da index yo‘q.  
  - **Tavsiya:** `(created_at DESC)` yoki role filter bilan birga composite (masalan assigned_to_user_id + created_at).  
  - **Ta’sir:** high (picker/controller ro‘yxati).

- **document_lines (document_id, expiry_date)**  
  - **Query:** Picking document lines: `WHERE document_id.in_(...)` va `ORDER BY expiry_date.asc().nulls_last(), location (pick_sequence, code), id`.  
  - **Hozir:** document_id bor; sort uchun expiry_date alohida indexda (lot_id, location_id bor, expiry_date yo‘q document_lines da).  
  - **Tavsiya:** `(document_id, expiry_date)` composite — FEFO tartib va consolidated view uchun.  
  - **Ta’sir:** medium–high (har bir hujjat ochilganda va consolidated view).

- **user_sessions (user_id, token)**  
  - **Query:** deps: `UserSession.user_id == user.id AND UserSession.token == token`.  
  - **Hozir:** ix_user_sessions_user_id va ix_user_sessions_token alohida.  
  - **Tavsiya:** Lookup har doim ikkala ustun bilan — `(user_id, token)` composite index aniqroq.  
  - **Ta’sir:** medium (har request da auth).

- **documents (doc_type, status, updated_at)**  
  - **Query:** Dashboard summary: doc_type SO, status in (new, partial, in_progress, picked); pick-documents: doc_type SO, status filter, order by updated_at desc.  
  - **Hozir:** idx_documents_doc_type_status bor; updated_at yo‘q.  
  - **Tavsiya:** `(doc_type, status, updated_at DESC)` — bitta composite filter + sort uchun.  
  - **Ta’sir:** high.

- **orders (filial_id, created_at DESC)**  
  - **Query:** list_orders: filial_id (yoki default) + order by created_at desc.  
  - **Hozir:** ix_orders_filial_id va idx_orders_created_at alohida.  
  - **Tavsiya:** Agar ko‘p so‘rov filial_id + created_at bo‘lsa, `(filial_id, created_at DESC)` composite foydali.  
  - **Ta’sir:** medium.

- **DocumentModel: (assigned_to_user_id, status, created_at)**  
  - **Query:** list_picking_documents (picker): assigned_to_user_id, status filters, order by created_at desc.  
  - **Hozir:** assigned_to_user_id va status alohida indexlar; created_at yo‘q.  
  - **Tavsiya:** `(assigned_to_user_id, created_at DESC)` yoki (assigned_to_user_id, status, created_at DESC).  
  - **Ta’sir:** high (picker ro‘yxati).

- **order_wms_state (status)**  
  - **Hozir:** ix_order_wms_state_status mavjud — yetarli.

- **StockMovement (source_document_type, source_document_id)**  
  - **Hozir:** ix_stock_movements_source_doc mavjud — yetarli.

---

## 4. ORTIQCHA / TAKROR INDEXLAR

- **locations.code**  
  - Model: `code` — `unique=True` → PostgreSQL avtomatik unique index yaratadi.  
  - Migration 0034: `ix_locations_code` — **takror**. Unique constraint allaqachon bitta index beradi; `ix_locations_code` qo‘shimcha foyda bermaydi, drop qilish mumkin (agar boshqa migrationlar bog‘liq bo‘lmasa).

- **locations.barcode_value**  
  - Model: `barcode_value` — `unique=True`.  
  - Migration 0030: `ix_locations_barcode_value` unique — odatda unique constraint bilan bir xil index; bitta yetarli. Takror bo‘lishi mumkin (PG unique constraint o‘zi index yaratadi).

- **products.sku**  
  - Model: `ix_products_sku` va ustun `unique=True` — unique ustun o‘zining indexini yaratadi. `ix_products_sku` qo‘shimcha; drop qilinsa faqat unique index qoladi — yetarli.

- **brands.code**  
  - `ix_brands_code` va ustun `unique=True` — xuddi shunday, bitta unique index yetarli.

- **vip_customers.customer_id**  
  - `ix_vip_customers_customer_id` va `customer_id` unique=True — takror.

- **product_barcodes.barcode**  
  - `ix_product_barcodes_barcode` va barcode unique=True — takror.

**Eslatma:** PostgreSQL da UNIQUE constraint odatda bitta unique index yaratadi. Modelda ham Index(unique=True) ham column unique=True bo‘lsa, ikkita index bo‘lishi mumkin — bittasi ortiqcha.

---

## 5. HIGH IMPACT INDEX TAVSIYALARI

| # | Jadval | Index (tavsiya) | Sabab | Ta’sir |
|---|--------|-----------------|-------|--------|
| 1 | documents | `(doc_type, status, updated_at DESC)` | Dashboard pick-documents va document list filter + sort | High |
| 2 | documents | `(assigned_to_user_id, created_at DESC)` yoki `(assigned_to_user_id, status, created_at DESC)` | Picking documents ro‘yxati (picker) | High |
| 3 | documents | `(created_at DESC)` (yoki yuqoridagi composite ichida) | Picking list order by created_at | High |
| 4 | document_lines | `(document_id, expiry_date)` | Picking lines FEFO tartibi va consolidated view | Medium–High |
| 5 | user_sessions | `(user_id, token)` | Auth har request da session tekshiruvi | Medium |
| 6 | orders | `(delivery_date)` yoki expression `(date(delivery_date))` | Sana bo‘yicha filter (list_orders) | Medium |
| 7 | orders | `(filial_id, created_at DESC)` | List orders: default filial + yangilik bo‘yicha sort | Medium |

---

## 6. WRITE LOAD VA INDEX BALANSI

- **Write-heavy jadvallar:**  
  - **orders / order_lines:** Smartup sync paytida ko‘p insert/update. Hozirgi indexlar: status, order_number, source, filial_id, created_at, source_external_id — o‘rtacha; juda ko‘p emas.  
  - **documents / document_lines:** Picking va allocation paytida kiritiladi va yangilanadi. Yana 1–2 index (masalan updated_at yoki composite) qo‘shish write’ni biroz oshiradi, lekin read (dashboard, picking list) uchun katta yutuq.  
  - **products / product_barcodes:** Smartup products sync — ko‘p upsert. Hozir external_source+external_id, sku, barcode va b. indexlar bor; yangi index kerak emas, ortiqcha indexlarni kamaytirish muhim.  
  - **stock_movements:** Har pick/allocate/ship da yozuv — indexlar ko‘p (8+). Bu jadval write-heavy; yangi index qo‘shishdan ehtiyot bo‘lish kerak, mavjud indexlar yetarli ko‘rinadi.  
  - **stock_lots:** Kam o‘zgaradi; FEFO va product_id indexlari mantiqiy.

- **Optimal balans:**  
  - **orders:** Read (list, dashboard) uchun created_at, filial_id, delivery_date indexlari mavjud yoki tavsiya qilingan; write sync uchun ortiqcha index qo‘shmaslik.  
  - **documents:** Read (dashboard, picking list) uchun doc_type+status+updated_at va assigned_to_user_id+created_at kabi 1–2 composite qo‘shish kuchli; document_lines da faqat (document_id, expiry_date) kabi minimal qo‘shimcha.  
  - **products:** Sync write’ni yengillashtirish uchun takror indexlarni (masalan ix_products_sku agar unique bilan takror bo‘lsa) tekshirish; yangi index kerak emas.

---

## 7. BIRINCHI NAVBATDA QO‘SHILADIGAN 5 TA INDEX

1. **documents (doc_type, status, updated_at DESC)**  
   - Dashboard pick-documents va boshqa document listlar (filter + sort).  
   - Ta’sir: high.

2. **documents (assigned_to_user_id, created_at DESC)**  
   - Picker uchun picking documents ro‘yxati (filter + sort).  
   - Ta’sir: high.

3. **document_lines (document_id, expiry_date)**  
   - Picking lines va consolidated view (FEFO tartibi).  
   - Ta’sir: medium–high.

4. **user_sessions (user_id, token)**  
   - Har request da session tekshiruvi (deps.get_current_user).  
   - Ta’sir: medium.

5. **orders (delivery_date)** yoki **orders (filial_id, created_at DESC)**  
   - Birinchisi: sana filter (list_orders). Ikkinchisi: default filial + yangilik bo‘yicha list.  
   - Ta’sir: medium.

---

## 8. QO‘SHMASLIKNI TAVSIYA QILADIGAN INDEXLAR

- **users.role**  
  - Picker/controller listlarida role bo‘yicha filter bor, lekin userlar soni odatda kam; full table scan qabul qilinarli. Index katta foyda bermaydi. Ta’sir: low.

- **documents.created_at** yoki **documents.updated_at** faqat bitta ustun (DESC)  
  - Agar composite (doc_type, status, updated_at) yoki (assigned_to_user_id, created_at) qo‘shilsa, alohida yagona ustunli index kerak emas — composite yetadi.

- **order_lines.sku / order_lines.barcode**  
  - Order lines ko‘pincha order_id orqali olinadi; sku/barcode bo‘yicha alohida global qidiruv yo‘q. Ta’sir: low.

- **stock_movements** ustiga qo‘shimcha indexlar  
  - Write-heavy; mavjud indexlar yetarli. Yangi index write’ni oshirib, read’da katta yutuq bermasa qo‘shilmasin.

- **audit_logs** ustiga ortiqcha composite’lar  
  - Hozir entity_type, entity_id, user_id, created_at bor; ko‘p so‘rovlar created_at desc + limit. Yana index faqat aniq slow query bo‘lsa qo‘shiladi.

- **locations** ustiga yana indexlar  
  - Hozir ham ko‘p index (parent_id, type, is_active, sector, location_type, zone_type, warehouse_id, pick_sequence, code, barcode_value). Write kam; lekin ortiqcha index (masalan code takrori) olib tashlash kerak, yangi keraksiz.

---

**Xulosa:** Audit asosida birinchi navbatda documents va document_lines uchun 3 ta, user_sessions uchun 1 ta, orders uchun 1 ta index qo‘shish kuchli ta’sir beradi. Ortiqcha/takror indexlarni (locations code, products/brands/vip_customers unique ustunlar bilan takror indexlar) tekshirib, keraksizlarini olib tashlash mumkin. Yangi migration yozishdan oldin bu hisobotni asos qilib, faqat yuqoridagi 5 ta va kerak bo‘lsa boshqa bir-ikkitasini qo‘shishni rejalash ma’qul.

---

## 9. BAJARILGAN ISHLAR (2026-03-12)

Hisobot bo‘yicha quyidagi indexlar **Alembic migration** orqali qo‘shildi:

| Migration | Index | Jadval | Maqsad |
|-----------|--------|--------|--------|
| `20260312_0054_audit_recommended_indexes` | `idx_documents_doc_type_status_updated_at` | documents | (doc_type, status, updated_at DESC) — dashboard pick-documents |
| | `idx_documents_assigned_created_at` | documents | (assigned_to_user_id, created_at DESC) — picking list (picker) |
| | `idx_document_lines_document_expiry` | document_lines | (document_id, expiry_date NULLS LAST) — FEFO / consolidated |
| | `idx_user_sessions_user_token` | user_sessions | (user_id, token) — auth session lookup |
| | `idx_orders_delivery_date` | orders | (delivery_date) — list_orders sana filter |

**Qo‘llash:** `alembic upgrade head` (DATABASE_URL muhitda belgilangan bo‘lishi kerak).

**Keyingi qadamlar (ixtiyoriy):**
- Ortiqcha indexlarni olib tashlash: `ix_locations_code` (locations — unique constraint bilan takror), boshqa takror indexlar.
- Kerak bo‘lsa: `orders (filial_id, created_at DESC)` composite index alohida migrationda qo‘shish.
