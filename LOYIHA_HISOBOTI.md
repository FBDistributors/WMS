# WMS Loyihasi Hisoboti

## Umumiy ma'lumot

**WMS (Warehouse Management System)** — ombor boshqaruv tizimi. Backend (FastAPI + PostgreSQL), veb-admin (React PWA) va **ikkita mobil ilova** — **React Native (Android)** va **PWA/Capacitor (Android)** dan iborat; receiving, picking, inventory, FEFO, offline rejim, push va audit qo'llab-quvvatlanadi.

---

## Texnologiyalar

| Qatlam   | Texnologiya |
|----------|-------------|
| **Backend**  | FastAPI, SQLAlchemy, Alembic, PostgreSQL (psycopg2), Pydantic, JWT (python-jose), Passlib |
| **Frontend (veb)** | React 19, TypeScript, Vite 7, TailwindCSS, React Router 7 |
| **Tillar**   | i18next (o'zbek, rus, ingliz) |
| **Mobil (native)** | React Native 0.76, TypeScript, Vision Camera (barcode), React Navigation, AsyncStorage, SQLite, FCM (push) |
| **Mobil (PWA)**    | Vite PWA, Capacitor 8 (Android), ML Kit, ZXing |
| **Skaner**   | Native: react-native-vision-camera; PWA: ML Kit, ZXing, html5-qrcode, JsBarcode, QRCode |
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
├── mobile/            # React Native Android (native ilova)
│   ├── App.tsx        # Kirish: Login, Home, PickerHome, PickTask*, Scanner, Hisob, Inventory, Queue, Returns, Kirim
│   ├── src/
│   │   ├── config/    # API URL (env.ts)
│   │   ├── api/       # API client (auth, picking, inventory, kirim va h.k.)
│   │   ├── i18n/      # Til (LocaleContext)
│   │   ├── network/   # Offline: NetworkProvider
│   │   ├── notifications/  # FCM, push ochilganda buyurtmaga yo'naltirish
│   │   ├── screens/   # Login, Home, PickerHome, PickTaskList, PickTaskDetails, Scanner, Hisob, Inventory, Queue, Returns, Kirim
│   │   └── types/     # navigation va boshqa
│   └── android/       # Native Android (Gradle, Vision Camera, FCM)
├── mobile-pwa/        # React PWA + Capacitor (Android)
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

## Mobile (React Native) — native Android ilova

**mobile/** — wms-api ga ulangan React Native (TypeScript) ilova, Android-first. Asosiy stack: Login → Home / PickerHome → PickTaskList → PickTaskDetails, Scanner, Hisob, Inventory, Queue, Returns, Kirim/KirimForm.

| Ekran / funksiya | Vazifasi |
|------------------|----------|
| **Login** | Kirish, JWT, sessiya |
| **Home** | Asosiy menyu (rol bo‘yicha) |
| **PickerHome** | Terishchi uy sahifasi |
| **PickTaskList / PickTaskDetails** | Terish vazifalari ro‘yxati va batafsil |
| **Scanner** | Shtrixkod/QR — react-native-vision-camera (EAN-13, EAN-8, Code 128, QR) |
| **Hisob** | Profil / sozlamalar |
| **Inventory / InventoryDetail** | Ombor qoldiqlari |
| **QueueScreen** | Offline navbat (keyin sync) |
| **Returns** | Qaytarishlar (redirect) |
| **Kirim / KirimForm** | Kirim (qabul) hujjatlari |

- **Offline MVP:** cache + queue + sync (NetworkProvider, SQLite/AsyncStorage).
- **Push (FCM):** bildirishnoma bosilganda `PickTaskDetails` ga taskId bilan ochiladi (PUSH_SETUP.md).
- **Tillar:** LocaleProvider (i18n).
- **API:** `src/config/env.ts` da base URL (emulyator: `10.0.2.2:8000`, ishlab chiqish/prod sozlanadi).

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
5. **Offline** — PWA'da va **React Native** da offline navbat (queue) + cache, keyin sync.
6. **Skaner** — **Native:** Vision Camera (EAN, Code 128, QR); **PWA/Capacitor:** ML Kit, ZXing orqali shtrixkod/QR.
7. **Push (native)** — FCM: bildirishnoma bosilganda terish vazifasiga (PickTaskDetails) ochiladi.
8. **SmartUP** — mahsulotlar va inventory sync.

---

## Hujjatlar va audit

- **AUDIT_REPORT.md** — tizim audit'i: 7 ta muhim risk (qty constraint'lar, index'lar, view mantiqi va h.k.), taxminiy ishonchlilik ~65%.
- **EXPIRY_SUMMARY.md** — muddati va FEFO implementatsiyasi (DB, receiving, orders).
- **SESSION_MANAGEMENT.md** — bitta qurilma sessiya sxemasi va backend o'zgarishlari.
- **mobile/README.md**, **PUSH_SETUP.md**, **OFFLINE_MVP.md**, **BOSHDAN_ISHGA_TUSHIRISH.md** — React Native ilova yo'riqnomalari.

---

## Xulosa

Loyiha to'liq stack WMS: backend (FastAPI + PostgreSQL), veb-admin (React PWA), **React Native Android** (terish, skaner, offline, FCM push) va PWA/Capacitor (admin + skaner). FEFO, sessiya boshqaruvi, offline va audit hujjatlashtirilgan. Keyingi qadam — AUDIT_REPORT.md dagi kritik masalalar (constraint'lar, index'lar, view) ni bartaraf etish va production uchun tayyorgarlikni oshirish.
