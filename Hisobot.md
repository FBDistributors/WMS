# WMS loyihasi — yagona hisobot

Bu fayl loyihada bajarilgan ishlar, arxitektura va yo‘riqnomalarning **yagona manbai**dir. Avvalgi tarqalgan `.md` hujjatlar shu hisobotga yig‘ilgan yoki qisqa xulosalar bilan almashtirildi.

---

## 1. Rahbarlar uchun qisqa xulosa

**WMS (Warehouse Management System)** — ombor jarayonlarini bitta tizimda boshqarish: qabul, saqlash, terish (picking), buyurtmalar, hisobotlar.

| Yo‘nalish | Mazmun |
|-----------|--------|
| **Inventar** | Haqiqiy vaqtda qoldiq; partiya va **muddati** kuzatiladi; FEFO. |
| **Terish** | Mobil ilova, shtrixkod, wave picking, FEFO. |
| **Qabul** | Lot va muddat; o‘tgan muddat qabul qilinmaydi. |
| **Buyurtmalar** | SmartUp integratsiyasi; o‘rikzor/tashkiliy harakatlar. |
| **Xavfsizlik** | Rollar (Admin, Controller, Picker), audit log, **bitta profil — bitta qurilma** (sessiya). |
| **Mobil** | React Native va PWA/Capacitor; **offline** navbat; **push** (FCM). |

**Texnologiya:** FastAPI + PostgreSQL (backend), React (PWA admin), React Native (Android), i18n (o‘zbek, rus, ingliz). **Hosting:** **VPS** (backend + PostgreSQL + SmartUp worker), admin PWA — statik hosting (masalan Vercel yoki VPS/nginx).

### Hosting (production)

| Komponent | Joy | Manzil / eslatma |
|-----------|-----|------------------|
| **Backend API** | VPS | `https://api.fbwarehouse.uz` — FastAPI (`wms-api` systemd) |
| **PostgreSQL** | VPS (localhost) | `DATABASE_URL` — `/etc/wms/api.env` va `backend/.env` |
| **SmartUp worker** | VPS | `wms-smartup-worker` — `backend/worker.py` |
| **Admin PWA** | Statik hosting | `www.fbwarehouse.uz` (yoki loyiha domeni) |
| **Mobil (Flutter/RN)** | APK / store | default API: `api.fbwarehouse.uz` |

**Production:** barcha servislar **VPS server**da (`api.fbwarehouse.uz`). Deploy: [`backend/deploy/vps/VPS_DEPLOY_RUNBOOK.md`](backend/deploy/vps/VPS_DEPLOY_RUNBOOK.md), yangilash: `bash backend/deploy/vps/update-wms.sh`.

---

## 2. Umumiy ma’lumot va tuzilma

Loyiha **backend (FastAPI + PostgreSQL)**, **veb-admin (React PWA + Vite)**, **React Native (Android)** va **PWA/Capacitor (Android)** dan iborat. **SmartUp ERP** bilan API orqali integratsiya (buyurtmalar, mahsulotlar, inventory sinxroni, background worker).

```
WMS/
├── backend/           # FastAPI, Alembic, integratsiyalar, worker
├── mobile/            # React Native (Android)
├── mobile-pwa/        # React PWA, Capacitor, Tauri (desktop)
├── docs/              # (avvalgi texnik yozuvlar Hisobotga yig‘ildi)
├── Hisobot.md         # Ushbu fayl
└── requirements.txt   # (agar loyiha ildizida bo‘lsa — backend bilan tekshiring)
```

---

## 3. Texnologiyalar

| Qatlam | Texnologiya |
|--------|----------------|
| Backend | FastAPI, SQLAlchemy, Alembic, PostgreSQL (psycopg2), Pydantic, JWT (python-jose), Passlib |
| Veb | React 19, TypeScript, Vite 7, TailwindCSS, React Router 7, i18next |
| Mobil (native) | React Native 0.76, Vision Camera, React Navigation, SQLite/AsyncStorage, FCM |
| Mobil (PWA) | Vite PWA, Capacitor 8, ML Kit / ZXing, Tauri 2 (desktop) |
| Integratsiya | SmartUp (`SmartupClient`, import/sync, alohida `worker.py` — VPS da `wms-smartup-worker`) |

---

## 4. Backend API modullari (`/api/v1`)

Router orqali: `audit`, `auth`, `brands`, `dashboard`, `documents`, `download`, `movements`, `movements-orikzor`, `orders`, `locations`, `inventory`, `receiving`, `reports`, `picking`, `products`, `integrations`, `users`, `vip-customers`, `scanner`, `waves`.

---

## 5. Ma’lumotlar modeli (asosiy)

- **User** — `active_session_token`, `last_device_info`, sessiya maydonlari.
- **Product, Brand, Location** — mahsulot va joylar.
- **StockMovement** — harakatlar daftari (ledger); `on_hand` / `reserved` / `available` hisoblari.
- **Stock lot** — `batch`, `expiry_date`, FEFO indekslari.
- **Order, OrderLine, OrderWmsState** — buyurtmalar.
- **Document, DocumentLine** — terish hujjatlari.
- **AuditLog**, **SmartupSyncRun** va boshqalar.

---

## 6. Mobil va veb ilovalar

### React Native (`mobile/`)
Login → Home / PickerHome → PickTaskList / PickTaskDetails, Scanner, Inventory, Queue (offline), Returns, Kirim. API URL: `src/config/env.ts` (emulyator: `10.0.2.2`, qurilma: kompyuter LAN IP).

### PWA (`mobile-pwa/`)
Admin, picker, controller oqimlari; skaner; RBAC; til paketlari.

---

## 7. Bajarilgan / hujjatlashtirilgan asosiy ishlar

### 7.1 Muddati va FEFO
- `stock_lots`: `expiry_date`, `batch`, noyob `(product_id, batch, expiry_date)`.
- Indeks: `ix_stock_lots_fefo` `(product_id, expiry_date, id)` — katta hajmda FEFO so‘rovlarini tezlashtirish.
- **Receiving:** o‘tgan `expiry_date` rad etiladi; NULL muddat — muddat talab qilinmaydigan mahsulotlar uchun.
- **Orders:** `_fefo_available_lots()` — `expiry_date ASC NULLS LAST`.
- PWA: `mobile-pwa/src/utils/expiry.ts` — rang/status/validatsiya yordamchilari.

### 7.2 Sessiya (bitta qurilma)
Yangi kirish eski JWT ni bekor qiladi; `get_current_user` faol tokenni tekshiradi; `last_device_info`, `session_started_at` kuzatiladi.

### 7.3 Offline va push
- Native: navbat (queue) + sync; tarmoq holati bilan ishlash.
- FCM: bildirishnoma bosilganda terish vazifasiga yo‘naltirish (sozlama: Firebase/Gradle).

### 7.4 SmartUp worker
Alohida jarayon: `python worker.py`, `SYNC_INTERVAL_SECONDS`, `SYNC_ORDERS_DAYS_BACK`, SmartUp env o‘zgaruvchilari; mahsulot va buyurtmalar idempotent upsert.

### 7.5 Tizim audit (xulosa)
**Tizim audit** asosida: **7 ta muhim xavf zonasi** (masalan, `stock_movements` uchun qat’iy CHECKlar, balans so‘rovlari indekslari, `stock_balances` view va `pick`/`unallocate` mantiqi), **production tayyorgarligi ~65%** — ko‘p foydalanuvchi va yuk ostida kritik tuzatishlar tavsiya etilgan.

### 7.6 Boshqa texnik yo‘nalishlar (avvalgi `docs/` va `backend/` yozuvlari)
Quyidagi mavzular loyihada ishlangan yoki reja sifatida hujjatlangan edi: inventar performans optimizatsiyasi, RBAC standart va audit, zona implementatsiyasi, operator oqimlari, mobil picking ekranlari, wave picking tartibi, production hardening roadmap, Locust/load test rejaları, PostgreSQL indeks audit, SmartUp import optimizatsiyasi, picker QA checklist, mobil test rejasi, Android imzo (release), Metro/cache muammolari, skaner eslatmalari (PWA).

---

## 8. Ishga tushirish qisqa yo‘riqnomasi

### Backend (lokal)
```powershell
cd C:\Users\hp\Desktop\WMS\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env   # DATABASE_URL va boshqalarni to‘ldiring
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 10000
```
- API: `http://localhost:10000/docs`, health: `/health`, `/health/db`.
- Telefon/emulyator: `CORS_ORIGINS=*`, host `0.0.0.0`, URL — LAN IP yoki `10.0.2.2`.

### React Native (Android)
```powershell
cd C:\Users\hp\Desktop\WMS\mobile
npx react-native start --reset-cache
# boshqa terminalda:
npx react-native run-android
```
Metro 8081 band bo‘lsa: `netstat -ano | findstr :8081`, keyin `taskkill /F /PID <pid>`.

### SmartUp worker (lokal)
```powershell
cd C:\Users\hp\Desktop\WMS\backend
alembic upgrade head
python worker.py
```
Kerakli env: `DATABASE_URL`, `SMARTUP_*`, ixtiyoriy `SYNC_INTERVAL_SECONDS`, `SYNC_ORDERS_DAYS_BACK`.

### PWA
```powershell
cd C:\Users\hp\Desktop\WMS\mobile-pwa
npm install
npm run dev
# yoki build: npm run build
```

---

## 9. Keyingi tavsiyalar

1. **Tizim audit** bo‘yicha kritik tuzatishlar: qoldiq manfiy bo‘lmasligi, indekslar, balans view mantiqi.
2. Production: `SECRET_KEY`, CORS cheklovi, monitoring, backup.
3. Kelajakda o‘z ERP/OMS: WMS bilan **alohida database** + **API kontrakt** (push yoki pull) — bitta umumiy DB majburiy emas.

---

## 10. Tashqi xizmatlar (eslatma)

- **Backend (production):** VPS server — `https://api.fbwarehouse.uz` (`/docs`, `/health`, `/health/db`).
- **Frontend:** `fbwarehouse.uz` domenlari CORS ro‘yxatida; admin PWA statik hosting.
- **Server yangilash:** `cd /var/www/wms/backend && bash deploy/vps/update-wms.sh`

---

*Oxirgi yangilanish: production VPS server (`api.fbwarehouse.uz`); barcha tarqalgan `.md` hujjatlar yagona `Hisobot.md` ga birlashtirilgan.*
