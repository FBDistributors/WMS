# WMS Loyihasi Hisoboti

## Umumiy ma'lumot

**WMS (Warehouse Management System)** — ombor boshqaruv tizimi. Backend (FastAPI + PostgreSQL) va frontend (React PWA + Android) dan iborat, receiving, picking, inventory, FEFO, offline rejim va audit qo'llab-quvvatlanadi.

---

## Texnologiyalar

| Qatlam   | Texnologiya |
|----------|-------------|
| **Backend**  | FastAPI, SQLAlchemy, Alembic, PostgreSQL (psycopg2), Pydantic, JWT (python-jose), Passlib |
| **Frontend** | React 19, TypeScript, Vite 7, TailwindCSS, React Router 7 |
| **Tillar**   | i18next (o'zbek, rus, ingliz) |
| **Mobil**    | PWA (Vite PWA), Capacitor 8 (Android) |
| **Skaner**   | ML Kit, ZXing, html5-qrcode, JsBarcode, QRCode |
| **Integratsiya** | SmartUP (mahsulotlar/inventory sync) |

---

## Loyiha tuzilishi

```
WMS/
├── backend/          # FastAPI backend
│   ├── app/
│   │   ├── api/v1/endpoints/   # API endpoint'lar
│   │   ├── auth/               # JWT, permissions, security
│   │   ├── core/
│   │   ├── integrations/smartup/
│   │   ├── models/             # SQLAlchemy modellari
│   │   ├── schemas/
│   │   ├── services/
│   │   └── main.py
│   ├── alembic/       # Migratsiyalar
│   ├── scripts/       # seed, import va boshqa skriptlar
│   └── tests/
├── mobile-pwa/        # React PWA + Android
│   └── src/
│       ├── admin/     # Admin panel
│       ├── picking/   # Picking (skaner, FEFO)
│       ├── pages/     # Sahifalar
│       ├── rbac/      # Rollar va route'lar
│       ├── auth/
│       └── ...
├── docs/
├── AUDIT_REPORT.md
├── EXPIRY_SUMMARY.md
├── SESSION_MANAGEMENT.md
└── requirements.txt
```

---

## Backend API modullari

`router.py` orqali ulangan endpoint'lar:

| Prefix        | Modul      | Vazifasi                    |
|---------------|------------|-----------------------------|
| `/audit`      | audit      | Audit log                   |
| `/auth`       | auth       | Autentifikatsiya            |
| `/brands`     | brands     | Brendlar                    |
| `/dashboard`  | dashboard  | Dashboard ma'lumotlari      |
| `/documents`  | documents  | Hujjatlar                   |
| `/orders`     | orders     | Buyurtmalar, FEFO allocation|
| `/locations`  | locations  | Lokatsiyalar                |
| `/inventory`  | inventory  | Ombor qoldiqlari            |
| `/receiving`  | receiving  | Qabul qilish                |
| `/reports`    | reports    | Hisobotlar                  |
| `/picking`    | picking    | Terish (picking)            |
| `/products`   | products   | Mahsulotlar                 |
| `/integrations` | integrations | Tashqi tizimlar (SmartUP) |
| `/users`      | users      | Foydalanuvchilar            |
| `/scanner`    | scanner    | Skaner API                  |
| `/waves`      | waves      | Wave'lar                    |

---

## Ma'lumotlar modeli (asosiy jadvalar)

- **User** — foydalanuvchilar, sessiya (bitta qurilma), `active_session_token`, `last_device_info`
- **Product, Brand** — mahsulotlar va brendlar
- **Location** — ombor joylari
- **StockMovement** — harakatlar daftari (receipt, allocate, pick, adjust va h.k.)
- **Stock lot** — partiyalar, `expiry_date`, `batch`, FEFO uchun
- **Order, Document, DocumentLine** — buyurtmalar va hujjatlar
- **Receipt, Picking** — qabul va terish
- **AuditLog** — audit yozuvlari
- **SmartUP** — integratsiya holati/sync

---

## Frontend: rollar va sahifalar

- **Picker (terishchi):** `/picker`, `/picking/mobile-pwa`, `/picker/inventory`, profil, sozlamalar.
- **Controller:** `/controller`, hujjatlar, mahsulotlar, profil, sozlamalar.
- **Admin:** Dashboard, mahsulotlar, brendlar, buyurtmalar, picking, lokatsiyalar, inventory, receiving, foydalanuvchilar, audit, profil.

RBAC orqali har bir rol uchun alohida route va ruxsatlar (`getHomeRouteForRole`, permission'lar) ishlatiladi.

---

## Asosiy funksiyalar

1. **Inventar** — `StockMovement` daftari orqali "bitta haqiqat manbai", `on_hand` / `reserved` / `available` hisoblash.
2. **FEFO** — `expiry_date` bo'yicha "avval muddati tugaydigan birinchi" terish, index va allocation mantiqi qo'shilgan.
3. **Muddati** — receiving'da o'tgan sana rad etiladi, lot'larda `expiry_date` va `batch` qo'llab-quvvatlanadi.
4. **Sessiya** — bitta profil uchun bitta qurilma: yangi kirish eski token'ni bekor qiladi, `active_session_token` va device ma'lumotlari saqlanadi.
5. **Offline** — PWA'da offline navbat (queue) va keyin sync.
6. **Skaner** — PWA/Capacitor orqali штрихкод/QR skanerlash.
7. **SmartUP** — mahsulotlar va inventory sync.

---

## Hujjatlar va audit

- **AUDIT_REPORT.md** — tizim audit'i: 7 ta muhim risk (qty constraint'lar, index'lar, view mantiqi va h.k.), taxminiy ishonchlilik ~65%.
- **EXPIRY_SUMMARY.md** — muddati va FEFO implementatsiyasi (DB, receiving, orders).
- **SESSION_MANAGEMENT.md** — bitta qurilma sessiya sxemasi va backend o'zgarishlari.

---

## Xulosa

Loyiha to'liq stack WMS: backend (FastAPI + PostgreSQL), React PWA, Android (Capacitor), FEFO, sessiya boshqaruvi, offline va audit hujjatlashtirilgan. Keyingi qadam — AUDIT_REPORT.md dagi kritik masalalar (constraint'lar, index'lar, view) ni bartaraf etish va production uchun tayyorgarlikni oshirish.
