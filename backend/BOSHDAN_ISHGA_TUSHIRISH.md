# WMS Backend — boshidan ishga tushirish

Backend (FastAPI + PostgreSQL) ni **lokal** da ishga tushirish uchun quyidagi qadamlarni bajaring.

---

## 1. Muhit (bir marta)

- **Python 3.11+** o‘rnatilgan bo‘lishi kerak.
- **PostgreSQL** — lokal yoki masofaviy (masalan Render, Neon) bazasi kerak.

```powershell
cd C:\Users\hp\Desktop\WMS\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

---

## 2. Sozlamalar (.env)

`.env.example` dan nusxa oling va kerakli qiymatlarni yozing. Backend ishga tushganda `.env` avtomatik yuklanadi.

```powershell
copy .env.example .env
```

**.env** da majburiy:

| O‘zgaruvchi    | Tavsif |
|----------------|--------|
| `DATABASE_URL` | PostgreSQL ulanishi, masalan: `postgresql+psycopg2://user:password@localhost:5432/wms` |

Ixtiyoriy (lokal/mobile uchun):

| O‘zgaruvchi    | Default | Tavsif |
|----------------|---------|--------|
| `PORT`         | `10000` | Backend ishlaydigan port. |
| `CORS_ORIGINS` | —       | Frontend/mobile manbai. Lokal va telefonda test qilish uchun `*` qo‘ying. |
| `SECRET_KEY`   | —       | JWT va sessiyalar uchun (production da mustahkam qiling). |

---

## 3. Migratsiyalar

Bazada jadvalar bo‘lishi uchun:

```powershell
alembic upgrade head
```

---

## 4. Serverni ishga tushirish

```powershell
$port = if ($env:PORT) { $env:PORT } else { "10000" }
uvicorn app.main:app --host 0.0.0.0 --port $port
```

Yoki oddiy:

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 10000
```

- **API:** http://localhost:10000  
- **Swagger:** http://localhost:10000/docs  
- **Health:** http://localhost:10000/health va http://localhost:10000/health/db  

---

## 5. Mobile ilovadan ulanish

Telefon yoki emulyator kompyuterdagi backend ga ulanishi kerak bo‘lsa:

1. **.env** da: `CORS_ORIGINS=*`
2. Backend ni `--host 0.0.0.0` bilan ishga tushiring (yuqoridagi kabi).
3. Telefonda: kompyuterning **lokal IP** manzilini ishlating (masalan `http://192.168.1.10:10000`), emulyatorda `http://10.0.2.2:10000`.

---

## Render da: DB, Web Service, Background Worker

Render da **uchala** bir-biriga ulangan:

| Resurs            | Rol |
|-------------------|-----|
| **PostgreSQL (DB)** | Bitta baza — Web va Worker ikkalasi shu bazaga yozadi/o‘qiydi. |
| **Web Service (wms-api)** | FastAPI — `/health`, `/api/v1/...`, migratsiyalar `preDeployCommand` da. |
| **Background Worker (wms-smartup-sync)** | SmartUp dan mahsulot va buyurtmalarni sinxron qiladi. |

**Ulash:** Ikkala servis ham **bir xil** `DATABASE_URL` dan foydalanadi — Render Blueprint orqali avtomatik ulanadi.

**Fayl:** Barcha uchala `backend/render.yaml` da berilgan. Render Dashboard da:

1. **New → Blueprint** (yoki mavjud loyihani Blueprint ga ulang).
2. Repo ni tanlang; **Blueprint path** ni `backend/render.yaml` qiling (yoki **Root Directory** = `backend` qilib, `render.yaml` ni shu papkada qoldiring).
3. Sync/Deploy dan keyin: **wms-db** (PostgreSQL), **wms-api** (Web), **wms-smartup-sync** (Worker) yaratiladi va `DATABASE_URL` avtomatik ulangan bo‘ladi.
4. Worker uchun Dashboard da **SMARTUP_BASE_URL**, **SMARTUP_BASIC_USER**, **SMARTUP_BASIC_PASS** (va ixtiyoriy **SMARTUP_FILIAL_ID**) ni qo‘lda kiriting.

**Eslatma:** Agar DB, Web va Worker allaqachon Render da alohida yaratilgan bo‘lsa, Blueprint ni birinchi marta sync qilganda ularni **mavjud servislar** deb nomi orqali ulash mumkin (Blueprint da `name:` larni o‘zingizdagi servis nomlariga moslashtiring).

---

## Muammo bo‘lsa

| Xato / holat | Nima qilish |
|--------------|-------------|
| `DATABASE_URL env var is required` | `.env` da `DATABASE_URL` to‘g‘ri yozilganini tekshiring. |
| `Database tables missing` (/health/db 500) | `alembic upgrade head` bajarilganini tekshiring. |
| CORS xatosi (brauzer/mobile) | `.env` da `CORS_ORIGINS=*` qo‘ying va serverni qayta ishga tushiring. |
| Port band | Boshqa port: `$env:PORT=10001; uvicorn app.main:app --host 0.0.0.0 --port 10001` |

---

## Qisqa tartib

1. `cd backend` → venv aktiv → `pip install -r requirements.txt`
2. `.env` yarating, `DATABASE_URL` (va ixtiyoriy `PORT`, `CORS_ORIGINS=*`) qo‘ying.
3. `alembic upgrade head`
4. `uvicorn app.main:app --host 0.0.0.0 --port 10000`

Shundan keyin backend ishlaydi; mobile ilova uchun kompyuter IP va shu portdan ulaning.
