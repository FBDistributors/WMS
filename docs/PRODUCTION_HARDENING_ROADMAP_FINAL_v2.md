# WMS — Production Hardening Roadmap FINAL v2

**Rol:** Senior Database + WMS Domain Architect  
**Maqsad:** 4 ta kritik masalani bitta aniq standardda hal qilish: picking flow (unallocate xatosi), allocation formulasi ziddiyati, stock_reservations get-or-create race, cleanup xavfsizligi.

---

# 1) Design Decision — Variant A (qat’iy tanlangan)

**Tanlov: Variant A — StockMovement faqat ON_HAND; reserved faqat stock_reservations.**

| # | Asos |
|---|------|
| 1 | **Ledger soddaligi:** stock_movements faqat jismoniy/on_hand harakatlarni yuritadi (receipt, pick, adjust, transfer). Reserved miqdori bitta joyda: stock_reservations.reserved_qty. Ikki manba (movement + jadval) orqali reserved hisoblash va double-decrement xatosi yo‘qoladi. |
| 2 | **Picking da bitta yozuv:** Pick paytida faqat reserved_qty -= delta va pick movement qty_change = -delta. "unallocate" movement umuman yozilmaydi — double-decrement imkoni yo‘q. |
| 3 | **Formulalar ziddiyatsiz:** on_hand = SUM(qty_change) FROM stock_movements (barcha movement_type); reserved = SUM(reserved_qty) FROM stock_reservations (lot_id, location_id bo‘yicha); available = on_hand - reserved. allocate/unallocate movement yo‘q, shuning uchun "NOT IN ('allocate','unallocate')" va "allocate yozish" o‘rtasidagi ziddiyat yo‘q. |
| 4 | **Constraint va index:** movement_type ga faqat on_hand turlari kiradi; CHECK va indexlar shu turlar bo‘yicha. Monitoring: on_hand movements dan, reserved stock_reservations dan. |
| 5 | **Cancel/rollback:** Faqat stock_reservations.reserved_qty kamaytiriladi; stock_movements ga hech narsa yozilmaydi (chunki "unallocate" movement yo‘q). |
| 6 | **Audit:** Qaysi order/document qancha rezerv qilgani document_lines (required_qty, picked_qty) va stock_reservations (updated_at, trigger yoki app log) orqali kuzatiladi; ledger o‘ziga faqat fizik harakatlar qoladi. |
| 7 | **Migratsiya:** Mavjud tizimda allocate/unallocate movement lar bo‘lsa, ularni reserved hisobidan chiqarib, stock_reservations ga migratsiya qilish yoki eski movement larni "arxiv" qilib, yangi mantiqdan boshlash kerak (alohida migratsiya rejasi). |

**Movement turlari (stock_movements) — faqat ON_HAND:**  
`opening_balance`, `receipt`, `putaway`, `pick`, `ship`, `adjust`, `transfer_in`, `transfer_out`.  
**allocate va unallocate movement yo‘q.**

---

# 2) Corrected Flows (Variant A bo‘yicha)

## 2.1 Ledger formulalari (aniq)

- **on_hand** (product_id, lot_id, location_id):
  - `SUM(qty_change) FROM stock_movements WHERE (product_id, lot_id, location_id) GROUP BY product_id, lot_id, location_id`
  - Barcha movement_type lar (receipt, pick, adjust, ...) shu jadvalda; allocate/unallocate yo‘q.
- **reserved** (lot_id, location_id):
  - `SUM(reserved_qty) FROM stock_reservations GROUP BY lot_id, location_id`  
  - Yoki (product_id, lot_id, location_id) uchun: stock_reservations da product_id ham bor, shuning uchun `stock_reservations.reserved_qty` per (product_id, lot_id, location_id).
- **available** = on_hand - reserved  
  (per product_id, lot_id, location_id: on_hand from movements, reserved from stock_reservations join).

---

## 2.2 Allocation — step-by-step

1. Transaction ochish (READ COMMITTED).
2. Order va order_lines o‘qish.
3. Har bir order_line uchun (product_id aniqlangach):
   - **FEFO ro‘yxat:** stock_movements + stock_lots + locations JOIN,  
     `WHERE product_id = ?` (movement_type barcha on_hand turlari — ya’ni hozircha allocate/unallocate yo‘q),  
     `GROUP BY lot_id, location_id, ...`, `HAVING SUM(qty_change) > 0`,  
     **ORDER BY expiry_date ASC NULLS LAST, lot_id ASC, location_id ASC**.
   - Har bir (lot_id, location_id) uchun **shu tartibda**:
     - **Get-or-create (race siz):**  
       `INSERT INTO stock_reservations (id, product_id, lot_id, location_id, reserved_qty, updated_at)  
        VALUES (gen_random_uuid(), $product_id, $lot_id, $location_id, 0, now())  
        ON CONFLICT (lot_id, location_id) DO UPDATE SET updated_at = now()  
        RETURNING id, reserved_qty, product_id, lot_id, location_id;`  
       Bu qatorni lock qiladi (Postgres ON CONFLICT DO UPDATE row lock beradi).
     - **on_hand** = yuqoridagi FEFO so‘rovdan yoki alohida: `SUM(qty_change)` shu (lot_id, location_id) uchun stock_movements dan.
     - **available** = on_hand - RETURNING.reserved_qty.  
       available <= 0 bo‘lsa CONTINUE.
     - take = min(available, remaining).
     - **UPDATE stock_reservations SET reserved_qty = reserved_qty + take, updated_at = now() WHERE id = $returned_id;**  
       (Lock allaqachon ushlab turilgan; yangi transaction bu qatorni UPDATE qilguncha kutadi.)
     - document_lines ga yangi DocumentLine (lot_id, location_id, required_qty=take, picked_qty=0).
     - **stock_movements ga HECH NARSA YOZILMAYDI** (allocate movement yo‘q).
     - remaining -= take; remaining == 0 bo‘lsa BREAK.
4. documents va document_lines yozish.
5. Commit.

**Lock:** INSERT ... ON CONFLICT DO UPDATE orqali stock_reservations satri lock; keyin UPDATE reserved_qty shu transaction ichida. FOR UPDATE faqat agar SELECT orqali o‘qib keyin UPDATE qilsak kerak; bu yerda RETURNING dan keyin darhol UPDATE, shuning uchun qo‘shimcha FOR UPDATE shart emas (row allaqachon lock).

---

## 2.3 Picking — step-by-step

1. Transaction ochish.
2. **Idempotency:** pick_requests da request_id bor-yo‘qligi; bor bo‘lsa mavjud javobni qaytarish.
3. document_lines: line_id bo‘yicha **FOR UPDATE**.
4. documents: document_id bo‘yicha **FOR UPDATE**.
5. Tekshiruvlar: line.product_id, lot_id, location_id mavjud; next_qty = picked_qty + delta; 0 <= next_qty <= required_qty; document status.
6. **stock_reservations:** `WHERE lot_id = line.lot_id AND location_id = line.location_id` **FOR UPDATE**.  
   Yo‘q yoki reserved_qty < qty_delta → 409 "Insufficient reserved stock".
7. reservation.reserved_qty -= qty_delta.
8. **stock_movements ga faqat bitta yozuv:** `movement_type = 'pick'`, `qty_change = -qty_delta`.  
   **unallocate movement YO‘Q.**
9. line.picked_qty = next_qty.
10. pick_requests ga (request_id, line_id) yozish.
11. Commit.

**Yoziladigan movement:** faqat `pick` (-qty_delta). Unallocate movement yo‘q.

---

## 2.4 Cancel / rollback (order yoki document bekor)

1. Transaction ochish.
2. Order yoki Document **FOR UPDATE**; status o‘zgartiriladi.
3. Document lines bo‘yicha (lot_id, location_id tartibida):
   - release_qty = line.required_qty - line.picked_qty (terilmagan rezerv).
   - release_qty <= 0 bo‘lsa CONTINUE.
   - **stock_reservations** dan `lot_id, location_id` **FOR UPDATE**; reserved_qty -= release_qty.
   - **stock_movements ga HECH NARSA YOZILMAYDI** (unallocate movement yo‘q).
4. Document/Order status = 'cancelled'.
5. Commit.

**Yoziladigan movement:** yo‘q. Faqat stock_reservations.reserved_qty kamayadi.

---

## 2.5 stock_reservations get-or-create (KRITIK 3 — aniq pattern)

**Maqsad:** "Yo‘q bo‘lsa INSERT" race bermasligi.

**Postgres pattern:**

1. **Bitta statementda get-or-create va lock:**
```sql
INSERT INTO stock_reservations (id, product_id, lot_id, location_id, reserved_qty, updated_at)
VALUES (gen_random_uuid(), $product_id, $lot_id, $location_id, 0, now())
ON CONFLICT (lot_id, location_id) DO UPDATE SET updated_at = now()
RETURNING id, reserved_qty, product_id, lot_id, location_id;
```
   - Row mavjud bo‘lsa: DO UPDATE updated_at ni yangilaydi va **qatorni lock qiladi**, RETURNING mavjud qatorni qaytaradi.
   - Row yo‘q bo‘lsa: INSERT qatorni yozadi va **qatorni lock qiladi**, RETURNING yangi qatorni qaytaradi.

2. **Transaction ichida tekshirish:** RETURNING dan keyin:
   - on_hand = shu (lot_id, location_id) uchun stock_movements dan SUM(qty_change).
   - available = on_hand - returned.reserved_qty.
   - available <= 0 bo‘lsa keyingi (lot_id, location_id) ga o‘tish.
   - take = min(available, remaining).

3. **Reserved yangilash (lock allaqachon ushlab turilgan):**
```sql
UPDATE stock_reservations
SET reserved_qty = reserved_qty + $take, updated_at = now()
WHERE id = $returned_id;
```

**FOR UPDATE qachon qo‘llanadi:**  
Allocation da: INSERT ... ON CONFLICT DO UPDATE RETURNING orqali row lock olamiz, alohida SELECT FOR UPDATE kerak emas.  
Picking da: reservation ni **SELECT ... FOR UPDATE** bilan olamiz (chunki bu yerda INSERT emas, mavjud row ni kamaytirish).  
Cancel da: reservation ni **SELECT ... FOR UPDATE** bilan olamiz.

---

## 2.6 Lifecycle jadvali (Variant A)

| Flow | stock_movements ga yozuv | stock_reservations |
|------|--------------------------|--------------------|
| **Allocate** | Yo‘q | reserved_qty += take (INSERT ON CONFLICT + UPDATE) |
| **Pick** | pick, qty_change = -delta (bitta qator) | reserved_qty -= delta |
| **Cancel** | Yo‘q | reserved_qty -= release_qty |
| **Receipt** | receipt, qty_change = +qty | Yo‘q |
| **Adjust** | adjust, qty_change = ± | Yo‘q |

---

# 3) SQL Pack v2

## 3.1 Movement turlari (constraint)

Variant A da stock_movements da faqat on_hand turlari. Mavjud DB da allocate/unallocate bo‘lsa, ularni yangi mantiqda ishlatilmaydi va CHECK ni yangilash kerak (yoki yangi migration da faqat quyidagi turlar ruxsat etiladi):

```sql
-- movement_type: faqat ON_HAND (allocate, unallocate yo'q)
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS ck_stock_movements_type;
ALTER TABLE stock_movements ADD CONSTRAINT ck_stock_movements_type CHECK (
  movement_type IN (
    'opening_balance', 'receipt', 'putaway', 'pick', 'ship',
    'adjust', 'transfer_in', 'transfer_out'
  )
);
```

## 3.2 Constraintlar

```sql
-- stock_reservations
CREATE TABLE IF NOT EXISTS stock_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    lot_id UUID NOT NULL REFERENCES stock_lots(id) ON DELETE RESTRICT,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    reserved_qty NUMERIC(18,3) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_stock_reservations_reserved_nonneg CHECK (reserved_qty >= 0),
    UNIQUE(lot_id, location_id)
);
CREATE INDEX ix_stock_reservations_product ON stock_reservations(product_id);
CREATE INDEX ix_stock_reservations_lot_location ON stock_reservations(lot_id, location_id);

-- document_lines
ALTER TABLE document_lines ADD CONSTRAINT ck_document_lines_required_qty_nonneg
  CHECK (required_qty >= 0);
ALTER TABLE document_lines ADD CONSTRAINT ck_document_lines_picked_qty_nonneg
  CHECK (picked_qty >= 0);
ALTER TABLE document_lines ADD CONSTRAINT ck_document_lines_picked_lte_required
  CHECK (picked_qty <= required_qty);

-- receipt_lines
ALTER TABLE receipt_lines ADD CONSTRAINT ck_receipt_lines_qty_positive CHECK (qty > 0);
```

## 3.3 Indexlar

- **on_hand hisoblash:** barcha movement_type lar stock_movements da, shuning uchun partial index "NOT IN ('allocate','unallocate')" kerak emas — barcha turlar on_hand ga ta’sir qiladi.

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_stock_movements_balance_calc
ON stock_movements (product_id, lot_id, location_id, movement_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_stock_movements_on_hand
ON stock_movements (product_id, lot_id, location_id);
```

- **FEFO:** mavjud ix_stock_lots_fefo (product_id, expiry_date, id).

## 3.4 Monitoring querylari (on_hand < 0, reserved < 0, available < 0)

**Variant A:** reserved faqat stock_reservations dan; on_hand faqat stock_movements dan.

```sql
WITH on_hand AS (
  SELECT
    product_id,
    lot_id,
    location_id,
    SUM(qty_change) AS on_hand
  FROM stock_movements
  GROUP BY product_id, lot_id, location_id
),
reserved AS (
  SELECT
    product_id,
    lot_id,
    location_id,
    reserved_qty AS reserved
  FROM stock_reservations
)
SELECT
  COALESCE(o.product_id, r.product_id) AS product_id,
  COALESCE(o.lot_id, r.lot_id) AS lot_id,
  COALESCE(o.location_id, r.location_id) AS location_id,
  COALESCE(o.on_hand, 0) AS on_hand,
  COALESCE(r.reserved, 0) AS reserved,
  COALESCE(o.on_hand, 0) - COALESCE(r.reserved, 0) AS available
FROM on_hand o
FULL OUTER JOIN reserved r
  ON o.product_id = r.product_id AND o.lot_id = r.lot_id AND o.location_id = r.location_id
WHERE COALESCE(o.on_hand, 0) < 0
   OR COALESCE(r.reserved, 0) < 0
   OR (COALESCE(o.on_hand, 0) - COALESCE(r.reserved, 0)) < 0;
```

Admin/cron kunlik ishlatadi; natija bo‘lsa log + notification. Alert: birinchi marta WARNING, ketma-ket 2+ marta notification.

---

# 4) Cleanup — avtomat nol qilish taqiqlangan (KRITIK 4)

**Default:** Avtomatik `reserved_qty = 0` qilish **taqiqlangan**. Faqat **REPORT (dry-run)** + **admin tasdiqi**.

**Avtomatik cleanup** faqat quyidagi shartlar **hammasi** bajarilganda:
- (a) Order/document **yo‘qligi isbotlangan** (document_lines orqali bu (lot_id, location_id) uchun active document/order yo‘q; yoki document status cancelled).
- (b) Rezerv **24 soatdan eski** (stock_reservations.updated_at < now() - interval '24 hours').
- (c) **Audit log** yoziladi: kim, qachon, qaysi (lot_id, location_id), qancha reserved_qty nol qilindi, sabab.
- (d) **Rollback yo‘li** bor: backup yoki “cleanup” jadvalida eski reserved_qty va vaqt saqlanadi; kerak bo‘lsa qayta tiklash.

**Reservation cleanup — safety checklist:**

- [ ] Dry-run report ishlab chiqildi: osilib qolgan rezervlar ro‘yxati (lot_id, location_id, reserved_qty, updated_at, tegishli document/order bor-yo‘qligi).
- [ ] Cleanup faqat admin approval dan keyin yoki avtomat bo‘lsa yuqoridagi 4 shart tekshiriladi.
- [ ] Avtomatik cleanup: 24 soatdan eski + document/order yo‘qligi tekshiruvi (query bilan).
- [ ] Har bir cleanup dan oldin audit_log yozuv (entity_type=stock_reservation_cleanup, old_data=new_data).
- [ ] Cleanup dan oldin eski reserved_qty backup jadvaliga yoki audit old_data ga yoziladi (rollback uchun).
- [ ] Production da birinchi marta faqat dry-run; keyin bitta test reservation uchun qo‘lda sinov; keyin avtomatik (agar kerak bo‘lsa).

---

# 5) Risks Remaining va keyingi sprint

| Risk | Tavsif | Keyingi sprint vazifasi |
|------|--------|--------------------------|
| **Mavjud allocate/unallocate movement lar** | Eski tizimda allocate/unallocate yozilgan bo‘lsa, Variant A ga o‘tishda reserved endi faqat stock_reservations dan; eski movement larni hisobdan chiqarish yoki migratsiya kerak. | Migratsiya: eski movement lardan reserved ni hisoblab, stock_reservations ga bir martalik to‘ldirish; yoki movement_type CHECK ni yangilab, allocate/unallocate ni qabul qilishni to‘xtatish va faqat yangi mantiqdan boshlash. |
| **FEFO ro‘yxat va on_hand** | Allocation da on_hand hisoblash stock_movements dan; katta hajmda bu so‘rov sekin bo‘lishi mumkin. | Index ix_stock_movements_on_hand va load test; kerak bo‘lsa materialized view yoki cache. |
| **Idempotency** | request_id receipts, stock_movements, documents da; barcha write endpoint larda tekshirish. | Sprint: request_id qo‘shish va idempotency tekshiruvi (receiving, inventory, send-to-picking). |
| **Deadlock** | Lock tartibi expiry_date → lot_id → location_id saqlansa ham, nested document/order lock va reservation lock tartibi bir xil bo‘lishi kerak. | Concurrency test (3 parallel allocation, cancel vs pick); deadlock log yoqish. |
| **Cleanup noto‘g‘ri ishlatilishi** | Admin xato bilan "barcha rezervlarni tozalash" ni bosishi mumkin. | UI da faqat dry-run va bitta-bitta tasdiqlash; avtomatik faqat 24h+ va document yo‘qligi tekshiruvi bilan. |

---

**Xulosa FINAL v2:** Variant A qat’iy: StockMovement faqat ON_HAND; unallocate movement yo‘q; reserved faqat stock_reservations; formulalar va monitoring shunga mos. Get-or-create INSERT ON CONFLICT DO UPDATE RETURNING; cleanup faqat report + approval yoki 4 shart + safety checklist bilan.
