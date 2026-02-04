# MOBILE PICKING FLOW — MVP Screens (Chiqim / Picking)

## Maqsad
Ombor operatori mobil qurilmada chiqim (picking) jarayonini maksimal soddalik, minimal qarorlar, FEFO avtomatik va offline-first tamoyillari bilan bajaradi.

## Scope (MVP)
- Faqat OUT hujjatlar bilan ishlash.
- FEFO va location bo‘yicha tartiblash.
- Harakatlar request_id bilan idempotent.
- Offline queue: vaqtincha local saqlash va keyin sync.
- Minimal UI: tezkor harakat va kam klik.

## Asosiy qoidalar (MVP)
- Operator batch tanlamaydi — FEFO bo‘yicha tizim tanlaydi.
- Mahsulotlar pick list’da ombor joyi bo‘yicha tartiblanadi (default).
- Skan rejimi avtomatik:
  - OUT (picking) uchun default: har dona skan (1 skan = +1)
  - Zarurat bo‘lsa: “Skan + miqdor” rejimi qo‘lda almashtiriladi.
- Offline bo‘lsa ham ishlaydi: harakatlar local queue’ga tushadi, keyin sync bo‘ladi.
- Har bir harakat request_id bilan idempotent yuboriladi.

---

## Ekranlar oqimi (MVP)
1) Pick List (Hujjatlar ro‘yxati)
2) Document Details (Hujjat ichidagi mahsulotlar)
3) Scan (Skan ekran)
4) Quantity Confirm (Miqdor tasdiqlash / tahrirlash)
5) Progress (Jarayon ko‘rsatkichi)
6) Offline & Queue (Offline holat + navbat)
7) Finish (Yakunlash)

Diagramma (soddalashtirilgan)

Pick List
→ Document Details
→ Scan
→ Quantity Confirm
→ Progress
→ (Done) Finish
→ (Offline) Offline & Queue → (Sync) qaytish

---

## Umumiy UI elementlar
### Offline indikator
- Yuqorida doimiy banner: “Offline — harakatlar keyin yuboriladi”
- Yuqori burchakda internet icon (online/offline)

### FEFO batch ko‘rsatish
- Batch ma’lumot (batch_number, expiry_date) ko‘rinadi
- Expiry yaqin bo‘lsa ogohlantirish:
  - 0–30 kun: “Yaroqlilik muddati yaqin”
  - 31–90 kun: “E’tibor”

### Progress va statuslar
- Hujjat statuslari: confirmed → in_progress → partial → completed
- Line status: pending → partial → done
- Progress bar: done/total (line bo‘yicha)

---

# 1) PICK LIST EKRANI (Hujjatlar ro‘yxati)

## Operator ko‘radi
- Hujjatlar ro‘yxati (OUT)
- Har hujjatda:
  - Document raqami (reference / document_number)
  - Status: confirmed / partial / in_progress
  - Qisqa progress: “12/30 line done”
  - Sana/vaqt (agar mavjud)
  - Prioritet (agar bo‘lsa)

## Operator nima qiladi
- Hujjatni tanlaydi
- Qidirish: hujjat raqami bo‘yicha (minimal)
- Refresh qiladi

## Tugmalar (minimal)
- “Ochish” (hujjat kartasida)
- “Yangilash” (refresh)
- “Offline Queue” (ikon orqali)

## Backend API
- GET /api/v1/documents?doc_type=OUT&status=confirmed,partial&limit=50&offset=0
- (ixtiyoriy) GET /api/v1/documents/{id} (detal uchun)

## Xato holatlar
- Network error:
  - Online bo‘lsa: “Serverga ulanishda xato”
  - Offline bo‘lsa: “Offline — so‘nggi kesh ko‘rsatilmoqda”

---

# 2) DOCUMENT DETAILS EKRANI (Hujjat ichidagi mahsulotlar)

## Operator ko‘radi
- Hujjat sarlavhasi:
  - Document number
  - Status
  - Umumiy progress (bar)
- Mahsulotlar ro‘yxati:
  - Mahsulot nomi/SKU/barcode
  - Kerakli miqdor
  - Chiqilgan miqdor (done)
  - Qolgan miqdor (remaining)
  - Ombor joyi (location code) — asosiy
  - Item status: pending / partial / done

Default sorting: location code bo‘yicha (A-1-1 → A-1-2 → B-2-1...)

## Operator nima qiladi
- Keyingi bajariladigan mahsulotni tanlaydi (yoki tizim “Next item” sifatida tepaga chiqaradi)
- “Skan” ekraniga o‘tadi

## Tugmalar
- “Skan boshlash” (primary)
- “Orqaga” (Pick list)
- “Offline Queue” (ikon)

## Backend API
- GET /api/v1/documents/{document_id}
- GET /api/v1/documents/{document_id}/movements (chiqilganlar history)
- (ixtiyoriy) GET /api/v1/stock-movements/by-document/{document_id}

## Xato holatlar
- Hujjat statusi cancelled/completed:
  - “Bu hujjat yopilgan. Operatsiya mumkin emas.”

---

# 3) SCAN EKRANI (Skan qilish)

## Operator ko‘radi
- Aktiv mahsulot kartasi:
  - Nom/SKU
  - Location (qaerdan olinadi)
  - Remaining qty
- Skan input (kamera yoki skaner)
- FEFO tanlangan batch info (faqat ma’lumot):
  - Batch: BN-...
  - Expiry: YYYY-MM-DD (yoki “N/A”)
  - Ogohlantirish (agar expiry yaqin)

## Operator nima qiladi
- Barcode skan qiladi
- Tizim barcode mosligini tekshiradi
- Default rejim: OUT uchun “har dona skan” → har skan +1

## Tugmalar
- “Tasdiqlash” (primary) — to‘liq miqdor bo‘lsa
- “Qisman chiqim” (secondary) — qoldiq yetarli bo‘lmasa yoki qisman yuborilsa
- “Miqdor kiritish” (toggle) — skan+miqdor rejimiga o‘tish
- “Orqaga”

## Backend API (tekshiruv va yuborish)
- (ixtiyoriy) GET /api/v1/inventory?product_id={id}&location_id={id} (real-time qoldiq ko‘rish)
- POST /api/v1/stock-movements/ (tasdiqlashda)

## Xato holatlar
- Barcode mos emas:
  - “Noto‘g‘ri mahsulot skan qilindi. To‘g‘ri SKU’ni skan qiling.”
- Qoldiq yetarli emas:
  - “Qoldiq yetarli emas. Mavjud: X, Kerakli: Y”
  - “Qisman chiqim” tugmasini taklif qil
- Offline:
  - “Offline — harakat navbatga saqlandi. Keyin sync qilinadi.”

---

# 4) QUANTITY CONFIRM EKRANI (Miqdor tasdiqlash / tahrirlash)

## Operator ko‘radi
- Tanlangan mahsulot
- Plan qty, picked qty, remaining
- Kiritilgan qty (yangi chiqim)
- FEFO batch info (readonly)
- “Sabab” maydoni (faqat adjustment bo‘lsa; picking’da yo‘q)

## Operator nima qiladi
- Miqdorni tahrirlaydi (faqat kerak bo‘lsa)
- Tasdiqlaydi

## Tugmalar
- “Tasdiqlash”
- “Qaytish”
- “Qisman chiqim”

## Backend API
POST /api/v1/stock-movements/

### Request body (OUT)
```json
{
  "movement_type": "OUT",
  "document_id": "uuid",
  "product_id": "uuid",
  "from_location_id": "uuid",
  "quantity": 5,
  "request_id": "uuid-or-ulid",
  "reference_number": "SO-2026-000123",
  "note": "picking",
  "mode": "scan_each"
}
```

---

# 5) PROGRESS EKRANI (Jarayon ko‘rsatkichi)

## Operator ko‘radi
- Hujjat progress bar (done/total)
- So‘nggi skan qilingan item
- “Qolgan itemlar” soni
- Hujjat statusi (in_progress / partial / completed)

## Operator nima qiladi
- “Davom etish” (keyingi item)
- “Yakunlash” (hamma item tugagan bo‘lsa)

## Tugmalar
- “Davom etish”
- “Yakunlash”
- “Orqaga”

## Backend API
- GET /api/v1/documents/{document_id} (progressni yangilash)

## Xato holatlar
- Sync xato:
  - “Serverga yuborilmadi, navbatga saqlandi”

---

# 6) OFFLINE & QUEUE EKRANI (Offline holat + navbat)

## Operator ko‘radi
- Offline banner
- Navbatdagi harakatlar ro‘yxati:
  - request_id
  - vaqt
  - mahsulot
  - qty
  - status: pending / sent / failed

## Operator nima qiladi
- Navbatni ko‘radi
- “Sync” bosadi (online bo‘lsa)
- Failed itemlarni qayta yuboradi

## Backend API
- POST /api/v1/stock-movements/ (navbatdan yuborish)

## Xato holatlar
- Server xato:
  - “Sync muvaffaqiyatsiz. Keyinroq urinib ko‘ring.”

---

# 7) FINISH EKRANI (Yakunlash)

## Operator ko‘radi
- “Picking yakunlandi” xabari
- Hujjat raqami va qisqa summary:
  - done/total
  - vaqt
- Keyingi ishga o‘tish tugmasi

## Operator nima qiladi
- “Pick list”ga qaytadi

## Tugmalar
- “Pick list”ga qaytish

## Backend API
- (ixtiyoriy) GET /api/v1/documents/{document_id} (status completed ko‘rsatish)
