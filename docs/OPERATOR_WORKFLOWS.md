# OPERATOR WORKFLOWS — WMS (MVP)

## Maqsad
Ombor operatorlari uchun WMS’da asosiy ish jarayonlarini (workflow) qadam-baqadam belgilash:
- Kirim (Receiving)
- Chiqim (Picking)
- Ichki ko‘chirish (Transfer)
- Inventory Adjustment (Tuzatish)
- Offline mode (offline-first)

## Umumiy qoidalar
- Hamma operatsiyalar StockMovement orqali amalga oshadi.
- Inventory to‘g‘ridan-to‘g‘ri yozilmaydi — faqat movement orqali o‘zgaradi.
- Har bir harakat idempotent bo‘lishi shart: request_id majburiy.
- FEFO default: chiqimda expiry yaqin batch birinchi chiqadi.
- Hujjatlar Document orqali boshqariladi:
  - type: IN / OUT / TRANSFER / ADJUSTMENT
  - status: draft / confirmed / in_progress / partial / completed / cancelled
- Ombor joyi bo‘yicha tartib: operator kam yursin.

---

# 1) KIRIM (RECEIVING FLOW)

## 1.1 Avtomatik hujjat (ERP/Admin yaratadi)

### Ma’no
ERP yoki admin tizimi IN hujjat yaratadi. Operator faqat qabul qiladi va joylashtiradi.

### Qadamlar
1) Operator “Kirim” bo‘limiga kiradi → hujjatni tanlaydi (status: confirmed)
2) Mahsulotni skan qiladi (barcode)
3) Tizim mahsulotni topadi, operator miqdor kiritadi
4) Batch ma’lumotini kiritadi (agar kerak bo‘lsa):
   - batch_number
   - expiry_date (agar mavjud)
5) Joy (location) tanlaydi (yoki skan qiladi: location barcode)
6) “Tasdiqlash” bosadi
7) Tizim movement yaratadi, inventory yangilanadi, hujjat progress yangilanadi
8) Hamma itemlar qabul qilinganda hujjat status: completed

### Operator harakati
- Barcode skan
- Qty kiritish
- Batch/expiry kiritish (agar kerak)
- Location tanlash
- Tasdiqlash

### Tizim reaksiyasi
- Product/Location mavjudligini tekshiradi
- Batch yaratadi yoki topadi
- Inventory qoldig‘ini oshiradi
- StockMovement log yozadi
- Document status auto yangilanadi

### API endpointlar (MVP)
- GET /api/v1/documents?doc_type=IN&status=confirmed,partial
- GET /api/v1/documents/{id}
- POST /api/v1/stock-movements/ (IN)

### IN request body (misol)
```json
{
  "movement_type": "IN",
  "document_id": "uuid",
  "product_id": "uuid",
  "to_location_id": "uuid",
  "batch_number": "BN-001",
  "expiry_date": "2026-12-31",
  "quantity": 20,
  "request_id": "uuid",
  "reference_number": "PO-2026-00123"
}
```

---

# 2) CHIQIM (PICKING FLOW)

## 2.1 Avtomatik hujjat (Sales/ERP yaratadi)

### Ma’no
OUT hujjat ERP/sotuv tizimi orqali keladi. Operator faqat chiqim qiladi.

### Qadamlar
1) Operator “Picking” bo‘limiga kiradi → hujjatni tanlaydi (status: confirmed/partial)
2) Mahsulotlar location bo‘yicha tartiblanadi (kam yurish uchun)
3) Operator itemni skan qiladi
4) Tizim barcode mosligini tekshiradi
5) Miqdor tasdiqlanadi (scan_each yoki scan_with_qty)
6) StockMovement yaratilib, picked qty yangilanadi
7) Hamma itemlar bajarilganda hujjat status: completed

### Operator harakati
- Hujjat tanlash
- Barcode skan
- Qty tasdiqlash
- Qisman chiqim (zarurat bo‘lsa)

### Tizim reaksiyasi
- FEFO bo‘yicha batch tanlaydi
- Inventory qoldig‘ini kamaytiradi
- Document/Line statuslarini yangilaydi

### API endpointlar (MVP)
- GET /api/v1/documents?doc_type=OUT&status=confirmed,partial
- GET /api/v1/documents/{id}
- POST /api/v1/stock-movements/ (OUT)

### OUT request body (misol)
```json
{
  "movement_type": "OUT",
  "document_id": "uuid",
  "product_id": "uuid",
  "from_location_id": "uuid",
  "quantity": 5,
  "request_id": "uuid",
  "reference_number": "SO-2026-000123",
  "note": "picking",
  "mode": "scan_each"
}
```

---

# 3) TRANSFER (ICHKI KO‘CHIRISH)

## 3.1 Ichki ko‘chirish hujjati

### Ma’no
Ombor ichida A lokatsiyadan B lokatsiyaga ko‘chirish.

### Qadamlar
1) Operator “Transfer” bo‘limiga kiradi → hujjat tanlaydi
2) Manba lokatsiyadan mahsulotni skan qiladi
3) Qty tasdiqlaydi
4) Maqsad lokatsiyani skan qiladi
5) “Tasdiqlash” bosadi

### Operator harakati
- Mahsulot va lokatsiyalarni skan
- Qty kiritish
- Tasdiqlash

### Tizim reaksiyasi
- Inventory A dan kamayadi, B ga qo‘shiladi
- Transfer movement log yoziladi
- Document status yangilanadi

### API endpointlar (MVP)
- GET /api/v1/documents?doc_type=TRANSFER&status=confirmed,partial
- GET /api/v1/documents/{id}
- POST /api/v1/stock-movements/ (TRANSFER)

---

# 4) INVENTORY ADJUSTMENT (TUZATISH)

## 4.1 Manual tuzatish

### Ma’no
Inventarizatsiya yoki xatolik sababli qoldiqni manual tuzatish.

### Qadamlar
1) Operator “Adjustment” bo‘limiga kiradi
2) Mahsulotni skan qiladi
3) To‘g‘ri qty kiritadi
4) Sabab kiritadi (majburiy)
5) Tasdiqlaydi

### Operator harakati
- Barcode skan
- Qty kiritish
- Sabab kiritish
- Tasdiqlash

### Tizim reaksiyasi
- Inventory +/− bo‘yicha yangilanadi
- Adjustment movement log yoziladi

### API endpointlar (MVP)
- POST /api/v1/stock-movements/ (ADJUSTMENT)

---

# 5) OFFLINE MODE (OFFLINE-FIRST)

## Ma’no
Internet yo‘q bo‘lsa ham operator ishlashda davom etadi. Harakatlar local queue’ga yoziladi.

### Qadamlar
1) Offline banner ko‘rinadi
2) Operator skan/qty tasdiqlaydi
3) Harakatlar queue’ga tushadi (pending)
4) Internet qaytsa avtomatik yoki manual sync

### UI/UX
- “Offline — harakatlar keyin yuboriladi” banner
- Queue ekrani: pending / sent / failed
- Failed itemlar qayta yuboriladi

### API endpointlar
- POST /api/v1/stock-movements/ (sync vaqtida)

---

# 6) HUJJAT STATUSLARI

- draft: hali boshlanmagan
- confirmed: ishga tayyor
- in_progress: bajarilmoqda
- partial: qisman bajarilgan
- completed: tugagan
- cancelled: bekor qilingan

---

# 7) MINIMAL DATA MODELLAR

## Document
- id
- type
- reference_number
- status
- created_at

## DocumentLine
- product_id
- product_name
- barcode
- required_quantity
- picked_quantity
- location_code

## StockMovement
- movement_type
- document_id
- product_id
- quantity
- request_id
- from_location_id / to_location_id
- batch_number / expiry_date
- note
