# WMS — Corrected Production Hardening Roadmap

**Rol:** Senior Database Engineer + Concurrency Specialist  
**Asos:** LOYIHA_HISOBOTI.md, AUDIT_REPORT.md, PRODUCTION_HARDENING_ROADMAP.md (oldingi versiya)  
**Maqsad:** FEFO va lock tartibini to‘g‘rilash, stock_reservations lifecycle aniqlash, partial index ogohlantirishi, negative stock monitoring, yangi sprint va SQL pack.

---

# A) Corrected Production Hardening Roadmap

## Sprint 1 — Data Integrity

| # | Vazifa |
|---|--------|
| 1.1 | **Ledger formula aniqlash** — on_hand / reserved / available hisob formulasi hujjatlashtiriladi (qaysi movement_type qaysi sum’ga kiradi). Bu tasdiqlanmaguncha partial index qo‘shilmaydi. |
| 1.2 | **stock_reservations** jadvali: migration (schema + CHECK reserved_qty >= 0, UNIQUE(lot_id, location_id)). |
| 1.3 | **Constraintlar:** document_lines (required_qty >= 0, picked_qty >= 0, picked_qty <= required_qty), receipt_lines (qty > 0). |
| 1.4 | **Idempotency ustunlari:** receipts.request_id, stock_movements.request_id, documents.request_id + har biri uchun UNIQUE partial index (WHERE request_id IS NOT NULL). |
| 1.5 | **Inventory validator:** get_available_qty(), validate_sufficient_stock(), InsufficientStockError. |
| 1.6 | **Audit:** Barcha movement yozish va status o‘zgarishlarida log_action. |

## Sprint 2 — Concurrency + Monitoring

| # | Vazifa |
|---|--------|
| 2.1 | **Allocation:** _allocate_order_safe — FEFO lock tartibi (expiry_date → lot_id → location_id), **SKIP LOCKED ishlatilmaydi**; deadlock oldini olish uchun doim bir xil tartibda lock. |
| 2.2 | **Picking:** Pick dan oldin reservation FOR UPDATE, reserved_qty tekshiruvi va kamaytirish; pick + unallocate movement. |
| 2.3 | **Cancel / rollback:** Order cancel va document status o‘zgarishida unallocate flow (reservation kamaytirish + unallocate movement). |
| 2.4 | **Reservation cleanup:** Osilib qolgan rezervlar uchun monitoring query va (ixtiyoriy) cron/admin endpoint. |
| 2.5 | **Indexlar:** Faqat ledger formula tasdiqlangach — ix_stock_movements_balance_calc; partial index formula aniqlanmaguncha qo‘shilmaydi. |
| 2.6 | **Negative stock monitoring:** Kundalik query (on_hand < 0, reserved < 0, available < 0), admin endpoint yoki cron, alert (log + notification). |
| 2.7 | **Monitoring:** deadlock log yoqish, slow query log, EXPLAIN ANALYZE qachon ishlatish. |
| 2.8 | **Concurrency testlar:** 2 picker bir SKU, 3 parallel allocation, cancel paytida pick, offline replay collision. |

---

# B) Correct Transaction Design

## Lock ordering rule (deadlock oldini olish)

Barcha transactionlarda locklar **har doim bir xil tartibda** olinadi:

1. **expiry_date** (FEFO bo‘yicha tartib — ya’ni avval eng erta muddatli lot)
2. **lot_id**
3. **location_id**

Ya’ni: FEFO ro‘yxatini `ORDER BY expiry_date ASC NULLS LAST, lot_id ASC, location_id ASC` qilib olamiz va shu tartibda har bir (lot_id, location_id) uchun **stock_reservations** satrini `FOR UPDATE` bilan lock qilamiz. **SKIP LOCKED ishlatilmaydi** — FEFO ketma-ketligi saqlanadi, ikkinchi transaction birinchi tugaguncha keyingi lot’ni oladi.

---

## Allocation — step-by-step transaction flow

1. **Transaction ochish** (READ COMMITTED).
2. **Order** va **order_lines** o‘qish (lock shart emas, faqat o‘qish).
3. Har bir **order_line** uchun (product_id aniqlangach):
   - **FEFO ro‘yxat** olish: `stock_movements` + `stock_lots` + `locations` JOIN, `WHERE product_id = ? AND movement_type NOT IN ('allocate','unallocate')`, `GROUP BY lot_id, location_id, ...`, `HAVING SUM(qty_change) > 0`, **ORDER BY expiry_date ASC NULLS LAST, lot_id ASC, location_id ASC**.
   - Ro‘yxatdagi **har bir (lot_id, location_id)** uchun **shu tartibda**:
     - **stock_reservations** dan `WHERE lot_id = ? AND location_id = ?` **FOR UPDATE** (bir satr). Agar yo‘q bo‘lsa INSERT (yoki get-or-create + FOR UPDATE).
     - on_hand = movements dan hisoblangan; available = on_hand - reservation.reserved_qty.
     - available <= 0 bo‘lsa CONTINUE.
     - take = min(available, remaining).
     - reservation.reserved_qty += take; db.flush().
     - **stock_movements** ga `movement_type='allocate'`, qty_change=+take, source_document_type='order', source_document_id=order.id.
     - document_lines ga yangi DocumentLine (lot_id, location_id, required_qty=take, picked_qty=0).
     - remaining -= take; remaining == 0 bo‘lsa BREAK.
4. **documents** va **document_lines** yozish (document yaratiladi yoki mavjud order ga bog‘lanadi).
5. **Commit**.

**Qaysi jadval lock qilinadi:** `stock_reservations` (lot_id, location_id bo‘yicha satrlar, FEFO tartibida).  
**Qaysi movement yoziladi:** `allocate` (qty_change > 0).  
**Qaysi constraint himoya qiladi:** `stock_reservations.reserved_qty >= 0` (CHECK); app da available = on_hand - reserved_qty hisobdan available < 0 bo‘lmasligi ta’minlanadi.

---

## Picking — step-by-step transaction flow

1. **Transaction ochish**.
2. **Idempotency:** `pick_requests` da `request_id` bor-yo‘qligi tekshirish; bor bo‘lsa mavjud javobni qaytarish, commit qilmasdan.
3. **document_lines** dan line_id bo‘yicha **FOR UPDATE**.
4. **documents** dan document_id bo‘yicha **FOR UPDATE**.
5. Tekshiruvlar: line.product_id, line.lot_id, line.location_id mavjud; next_qty = picked_qty + delta; 0 <= next_qty <= required_qty; document status pick qilishga ruxsat beradi.
6. **stock_reservations** dan `lot_id = line.lot_id AND location_id = line.location_id` **FOR UPDATE**. Agar yo‘q yoki reserved_qty < qty_delta → 409 "Insufficient reserved stock".
7. reservation.reserved_qty -= qty_delta.
8. **stock_movements** ga: `movement_type='pick'`, qty_change=-qty_delta; `movement_type='unallocate'`, qty_change=-qty_delta (ikkala yozuv).
9. line.picked_qty = next_qty.
10. **pick_requests** ga (request_id, line_id) yozish (idempotency).
11. **Commit**.

**Qaysi jadval lock qilinadi:** document_lines, documents, stock_reservations.  
**Qaysi movement yoziladi:** `pick` (manfiy), `unallocate` (manfiy).  
**Qaysi constraint himoya qiladi:** document_lines CHECK (picked_qty <= required_qty); stock_reservations CHECK (reserved_qty >= 0).

---

## Cancel / rollback — step-by-step (order yoki document bekor)

1. **Transaction ochish**.
2. **Order** yoki **Document** **FOR UPDATE** (status o‘zgartiriladi).
3. Document **lines** bo‘yicha (lot_id, location_id, required_qty - picked_qty = qolgan reserved):
   - Har bir (lot_id, location_id) uchun **stock_reservations** **FOR UPDATE** (lock tartibi: lot_id, location_id).
   - release_qty = line.required_qty - line.picked_qty (allocate qilingan lekin hali terilmagan).
   - reservation.reserved_qty -= release_qty.
   - **stock_movements** ga `movement_type='unallocate'`, qty_change=-release_qty, source_document_type='order' yoki 'document', source_document_id.
4. Document/Order status = 'cancelled' (yoki tegishli holat).
5. **Commit**.

**Qaysi jadval lock qilinadi:** documents, document_lines, stock_reservations.  
**Qaysi movement yoziladi:** `unallocate` (manfiy).  
**Qaysi constraint himoya qiladi:** reserved_qty >= 0 (release_qty haddan oshmasligi document line dan keladi).

---

## Pseudo-code (xulosa)

**Allocation:**
```text
BEGIN
  fefo_rows = SELECT ... FROM stock_movements + stock_lots + locations
              WHERE product_id=? AND movement_type NOT IN ('allocate','unallocate')
              GROUP BY ... HAVING SUM(qty_change)>0
              ORDER BY expiry_date ASC NULLS LAST, lot_id ASC, location_id ASC
  FOR each (lot_id, location_id) IN fefo_rows IN ORDER:
    res = SELECT * FROM stock_reservations WHERE lot_id=? AND location_id=? FOR UPDATE
    IF res is NULL: INSERT res; FLUSH
    available = on_hand_from_movements - res.reserved_qty
    IF available <= 0: CONTINUE
    take = min(available, remaining)
    res.reserved_qty += take
    INSERT stock_movements (allocate, +take)
    INSERT document_line (...)
    remaining -= take; IF remaining==0: BREAK
  COMMIT
```

**Picking:**
```text
BEGIN
  IF EXISTS (SELECT 1 FROM pick_requests WHERE request_id=?) THEN RETURN idempotent response
  line = SELECT * FROM document_lines WHERE id=? FOR UPDATE
  doc  = SELECT * FROM documents WHERE id=line.document_id FOR UPDATE
  validate line, next_qty, document status
  res = SELECT * FROM stock_reservations WHERE lot_id=line.lot_id AND location_id=line.location_id FOR UPDATE
  IF res is NULL OR res.reserved_qty < qty_delta: 409
  res.reserved_qty -= qty_delta
  INSERT stock_movements (pick, -qty_delta), (unallocate, -qty_delta)
  UPDATE line.picked_qty; INSERT pick_requests (request_id, line_id)
  COMMIT
```

**Cancel (unallocate):**
```text
BEGIN
  doc = SELECT * FROM documents WHERE id=? FOR UPDATE
  FOR each line IN document.lines (ORDER BY lot_id, location_id):
    release_qty = line.required_qty - line.picked_qty
    IF release_qty <= 0: CONTINUE
    res = SELECT * FROM stock_reservations WHERE lot_id=line.lot_id AND location_id=line.location_id FOR UPDATE
    res.reserved_qty -= release_qty
    INSERT stock_movements (unallocate, -release_qty)
  UPDATE document.status = 'cancelled'
  COMMIT
```

---

## stock_reservations lifecycle — qisqa jadval

| Flow | Lock qilinadigan jadval | Yoziladigan movement | Himoya qiluvchi constraint |
|------|-------------------------|----------------------|----------------------------|
| **Allocate** | stock_reservations (FEFO tartibida) | allocate (+qty) | reserved_qty >= 0; app available hisobi |
| **Pick** | document_lines, documents, stock_reservations | pick (-qty), unallocate (-qty) | picked_qty <= required_qty; reserved_qty >= 0 |
| **Unallocate (rollback)** | documents, stock_reservations | unallocate (-qty) | reserved_qty >= 0 |
| **Order cancel** | orders/documents, document_lines, stock_reservations | unallocate (-qty) | reserved_qty >= 0 |
| **Document status change** (masalan cancelled) | documents, document_lines, stock_reservations | unallocate (-qty) | reserved_qty >= 0 |
| **Reservation cleanup** | — | — | Monitoring: reserved_qty > 0 lekin document/order yo‘q yoki status cancelled bo‘lgan “osilib qolgan” rezervlar; cleanup qilish yoki alert. |

---

## Reservation cleanup (osilib qolgan rezervlar)

- **Muammo:** Xato yoki eski mantiq tufayli reservation qoldiq bo‘lib, document/order yo‘q yoki cancelled bo‘lishi mumkin.
- **Monitoring query:** Har bir (lot_id, location_id) da reserved_qty > 0, lekin tegishli document (yoki order) “active” emas — bunday qatorlarni ro‘yxatga olish.
- **Tavsiya:** Admin endpoint yoki cron kunlik ishlatadi; report chiqaradi; kerak bo‘lsa qo‘lda yoki skript orqali unallocate movement + reservation.reserved_qty = 0 qilish (ehtiyotkorlik bilan).

---

# C) Final SQL Pack

## C.1 Constraintlar

```sql
-- stock_reservations (yangi jadval)
CREATE TABLE stock_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    lot_id UUID NOT NULL REFERENCES stock_lots(id) ON DELETE RESTRICT,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    reserved_qty NUMERIC(18,3) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_stock_reservations_reserved_nonneg CHECK (reserved_qty >= 0),
    UNIQUE(lot_id, location_id)
);

-- document_lines
ALTER TABLE document_lines ADD CONSTRAINT ck_document_lines_required_qty_nonneg
  CHECK (required_qty >= 0);
ALTER TABLE document_lines ADD CONSTRAINT ck_document_lines_picked_qty_nonneg
  CHECK (picked_qty >= 0);
ALTER TABLE document_lines ADD CONSTRAINT ck_document_lines_picked_lte_required
  CHECK (picked_qty <= required_qty);

-- receipt_lines
ALTER TABLE receipt_lines ADD CONSTRAINT ck_receipt_lines_qty_positive
  CHECK (qty > 0);
```

## C.2 Idempotency — request_id qayerga qo‘shiladi

| Jadval | Ustun | Unique constraint | Qachon ishlatiladi |
|--------|--------|-------------------|--------------------|
| receipts | request_id VARCHAR(64) NULL | UNIQUE WHERE request_id IS NOT NULL | create_receipt — client retry da bir xil receipt qaytariladi |
| stock_movements | request_id VARCHAR(64) NULL | UNIQUE WHERE request_id IS NOT NULL | create_stock_movement (adjust va boshqa) — retry da dublikat movement yozilmaydi |
| documents | request_id VARCHAR(64) NULL | UNIQUE WHERE request_id IS NOT NULL | send-to-picking — bir xil request_id 2 marta yuborilsa mavjud document qaytariladi |
| pick_requests | request_id (mavjud) | UNIQUE (allaqachon) | pick_line — bir xil request_id 2 marta pick → birinchi javob qaytariladi |

**Retry scenario misoli (pick):** Client POST /picking/lines/{id}/pick { "request_id": "uuid-abc", "delta": 1 }. Tarmoq uziladi, javob kelmadi. Client qayta yuboradi: bir xil request_id. Server pick_requests da "uuid-abc" topadi, yangi movement yozmaydi, mavjud line va document_status bilan 200 qaytaradi. Picked_qty bir marta oshgan bo‘ladi.

```sql
-- Idempotency ustunlari
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS request_id VARCHAR(64) NULL;
CREATE UNIQUE INDEX ix_receipts_request_id ON receipts(request_id) WHERE request_id IS NOT NULL;

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS request_id VARCHAR(64) NULL;
CREATE UNIQUE INDEX ix_stock_movements_request_id ON stock_movements(request_id) WHERE request_id IS NOT NULL;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS request_id VARCHAR(64) NULL;
CREATE UNIQUE INDEX ix_documents_request_id ON documents(request_id) WHERE request_id IS NOT NULL;
```

## C.3 Indexlar

**Ogohlantirish:** `on_hand` / `reserved` / `available` hisob formulasi (qaysi movement_type qaysi sum’ga kiradi) **aniqlanmaguncha** partial index qo‘shilmasin. Noto‘g‘ri formula bo‘lsa, allocate/unallocate ni indexdan chiqarish available yoki on_hand ni buzishi mumkin.

- **Balance hisoblash uchun (formula tasdiqlangach):**

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_stock_movements_balance_calc
ON stock_movements (product_id, lot_id, location_id, movement_type);
```

- **Partial index:** Faqat ledger formulasi hujjatda qat’iy aniqlangandan keyin qo‘shiladi. Masalan: “on_hand = SUM(qty_change) WHERE movement_type NOT IN ('allocate','unallocate')” bo‘lsa, on_hand tez hisoblash uchun partial index qo‘yish mumkin; aks holda qo‘shilmaydi.

- **FEFO / lot:** Mavjud `ix_stock_lots_fefo` (product_id, expiry_date, id) yetarli.

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_stock_reservations_product ON stock_reservations(product_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_stock_reservations_lot_location ON stock_reservations(lot_id, location_id);
```

## C.4 Negative stock monitoring

**Kundalik tekshiruv querylari** (lot_id, location_id yoki product_id, lot_id, location_id bo‘yicha aggregate):

```sql
-- available < 0 (inventory_by_lot_location view asosida yoki to‘g‘ridan-to‘g‘ri SUM orqali)
WITH agg AS (
  SELECT
    product_id,
    lot_id,
    location_id,
    SUM(CASE WHEN movement_type IN ('allocate','unallocate') THEN 0 ELSE qty_change END) AS on_hand,
    SUM(CASE WHEN movement_type IN ('allocate','unallocate') THEN qty_change ELSE 0 END) AS reserved
  FROM stock_movements
  GROUP BY product_id, lot_id, location_id
)
SELECT * FROM agg
WHERE on_hand < 0 OR reserved < 0 OR (on_hand - reserved) < 0;
```

**Admin endpoint yoki cron:** Yuqoridagi query ni kunlik (yoki soatlik) ishga tushiradi; natija bo‘lsa log + notification (email/telegram/slack).  
**Alert strategiyasi:** Birinchi marta topilsa — log WARNING; ketma-ket 2+ marta — alert (notification); admin panelda “Negative stock” hisoboti.

## C.5 Monitoring querylar (umumiy)

- **Negative stock:** C.4 dagi WITH agg ... WHERE on_hand < 0 OR reserved < 0 OR (on_hand - reserved) < 0.
- **Osilib qolgan rezervlar:** stock_reservations da reserved_qty > 0 bo‘lgan qatorlar uchun tegishli document/order active emas — document_lines orqali join qilib ro‘yxat.
- **Deadlock / slow:** Postgres log (log_lock_waits, log_min_duration_statement). EXPLAIN ANALYZE — sekin so‘rov aniqlandanda ishlatiladi.

---

# D) Concurrency test plan (kengaytirilgan)

| Test | Setup | Harakat | Kutish |
|------|--------|--------|--------|
| **2 picker bir SKU** | 1 product, 1 lot, 1 location, 100 birlik; 1 document, 2 line (50+50) yoki 2 document bir xil SKU | 2 picker bir vaqtda har biri o‘z line ini pick qiladi | Jami pick 100 dan oshmasin; 409 bo‘lmasa; reserved_qty va movements mos |
| **3 parallel allocation** | 100 birlik mavjud | 3 ta order (har biri 100) bir vaqtda send-to-picking | Jami allocated = 100; 2 ta order shortage; deadlock bo‘lmasin |
| **Cancel paytida pick** | 1 document allocated, pick boshlandi | Bir thread document cancel, boshqa thread pick | Cancel bo‘lsa pick 409 (document cancelled / insufficient reserved); yoki pick avval bo‘lsa cancel unallocate faqat qolgan qismini qaytaradi |
| **Offline replay collision** | 1 document, 1 line; offline rejimda 2 marta bir xil request_id bilan pick navbatga | Sync: birinchi marta success, ikkinchi marta bir xil request_id | Server 2-so‘rovda idempotent javob; picked_qty 1 marta oshgan |

---

# E) Monitoring — deadlock, slow query, EXPLAIN ANALYZE

- **Deadlock log:** PostgreSQL `log_lock_waits = on`, `deadlock_timeout` (default 1s). Deadlock yuzaga kelsa Postgres avtomatik log yozadi; app da 400/500 qaytarilishi mumkin. Loglarni kundalik tekshirish.
- **Slow query log:** `log_min_duration_statement = 2000` (ms) — 2 sekunddan uzoq davom etgan so‘rovlar logga yoziladi. Haftalik loglarni ko‘rib chiqish.
- **EXPLAIN ANALYZE qachon kerak:** (1) Yangi index qo‘shishdan oldin va keyin — balance / FEFO so‘rovlari uchun; (2) Production da sekin deb shikoyat qilingan endpoint uchun; (3) 10k+ movement bilan load test da. Oddiy monitoring uchun faqat slow query log yetarli; tahlil qilish kerak bo‘lsa EXPLAIN ANALYZE ishlatiladi.

---

# F) Test checklist (qisqa)

- [ ] Allocation concurrency (2 va 3 parallel): jami allocated mavjud qoldiqdan oshmasin; deadlock yo‘q.
- [ ] Pick idempotency: bir xil request_id 2 marta — picked_qty bir marta oshadi.
- [ ] Negative stock: pick/adjust dan keyin available < 0 bo‘lmasligi; yetarli bo‘lmasa 409.
- [ ] Receipt / movement idempotency: request_id bilan retry — 1 ta yozuv.
- [ ] Cancel paytida pick: 409 yoki to‘g‘ri unallocate.
- [ ] Offline replay collision: idempotent javob.
- [ ] Negative stock monitoring query ishlaydi; alert strategiyasi hujjatlashtirilgan.

---

**Xulosa:** FEFO da **SKIP LOCKED ishlatilmaydi**; lock tartibi **expiry_date → lot_id → location_id**. stock_reservations lifecycle (allocate, pick, unallocate, cancel, cleanup) va monitoring (negative stock, deadlock, slow query) roadmap ga kiritildi. Partial index ledger formula aniqlanmaguncha qo‘shilmaydi.
