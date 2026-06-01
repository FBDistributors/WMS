# WMS VPS — deploy va diagnostika

**Production hosting:** WMS backend, PostgreSQL va SmartUp worker **VPS server**da ishlaydi. Public API: **`https://api.fbwarehouse.uz`**.

Oxirgi tekshiruv: **2026-05-21** (`vm56637`, commit `5715413`).

---

## Server yangilash (standart deploy)

Yangi kod (masalan `git push` dan keyin) VPS da quyidagicha yangilanadi:

```bash
cd /var/www/wms/backend
bash deploy/vps/update-wms.sh
```

Skript ketma-ketligi: `git pull` → `pip install -r requirements.txt` → `alembic upgrade head` → `systemctl restart wms-api` va `wms-smartup-worker` → `/health` tekshiruv.

**Qo‘lda** (skriptsiz):

```bash
cd /var/www/wms
git pull origin main
cd backend
.venv/bin/pip install -r requirements.txt
set -a && source /etc/wms/api.env && set +a
.venv/bin/alembic upgrade head
sudo systemctl restart wms-api
sudo systemctl restart wms-smartup-worker
curl -s https://api.fbwarehouse.uz/health
```

**Loglar:**

```bash
journalctl -u wms-api -f
journalctl -u wms-smartup-worker -n 50 --no-pager
```

---

## Tezkor diagnostika

```bash
cd /var/www/wms
git pull origin main
cd backend
bash deploy/vps/check-wms-deploy.sh
```

Chiqishni to‘liq nusxa oling (parollar skriptda `***` qilinadi).

---

## 2026-05-21 — vm56637 natijasi (xulosa)

| Tekshiruv | Holat | Izoh |
|-----------|--------|------|
| Git / venv / alembic | OK | `backend/.venv`, alembic 1.18.4 |
| `/var/www/wms/backend/.env` | OK | `DATABASE_URL`, `SECRET_KEY`, SmartUp bor |
| `/etc/wms/api.env` | **Bo‘sh** | Faqat izoh; `DATABASE_URL` yo‘q |
| `wms-api.service` | OK (ishlayapti) | `EnvironmentFile=/etc/wms/api.env` + **`load_dotenv()`** `.env` ni o‘qiydi |
| `wms-smartup-worker` | **Xato** | `api.env` bo‘sh → worker `status=1`, qayta urinadi |
| Alembic (faqat `api.env`) | **Xato** | `DATABASE_URL env var is required` |
| `work_zones` migratsiya | **Bajarilmagan** | Alembic `.env` yoki to‘ldirilgan `api.env` bilan ishga tushirish kerak |
| `wms.service` (eski) | **Ikki nusxa** | `/var/www/wms/venv`, `wms.env` — `wms-api` bilan aralashmasin |

**Sabab:** API `app/main.py` ichida `load_dotenv()` tufayli `backend/.env` dan ishlaydi. Alembic va worker esa asosan **`/etc/wms/api.env`** kutadi (systemd `EnvironmentFile`).

---

## Tuzatish: `api.env` ni `.env` bilan sinxronlash

**1. Zaxira**

```bash
sudo cp /etc/wms/api.env /etc/wms/api.env.bak.$(date +%Y%m%d) 2>/dev/null || true
```

**2. Asosiy o‘zgaruvchilarni `.env` dan ko‘chirish** (parolni terminalda ko‘rsatmaydi)

```bash
cd /var/www/wms/backend
sudo bash deploy/vps/sync-api-env-from-dotenv.sh
```

Agar `export: unbound variable` chiqsa — eski skript `.env` ni `source` qilgan; `git pull` qilib yangi skriptni ishlating (faqat `KEY=value` o‘qiydi).

yoki qo‘lda: `/etc/wms/api.env` ichiga `backend/.env` dagi kamida quyidagilar:

- `DATABASE_URL=postgresql://wms_user:...@localhost:5432/wms_db`
- `SECRET_KEY=...`
- `SMARTUP_BASIC_USER=...`, `SMARTUP_BASIC_PASS=...`, `SMARTUP_FILIAL_ID=...`, `SMARTUP_PROJECT_CODE=trade`
- `CORS_ORIGINS=...` (kerak bo‘lsa)

**3. Ruxsat**

```bash
sudo chmod 600 /etc/wms/api.env
```

**4. Migratsiya (work_zones va boshqalar)**

```bash
cd /var/www/wms/backend
set -a && source /etc/wms/api.env && set +a
.venv/bin/alembic upgrade head
.venv/bin/alembic current   # kutiladi: 20260521_0074 (yoki head)
```

**5. Xizmatlar**

```bash
sudo systemctl restart wms-api
sudo systemctl restart wms-smartup-worker
sudo systemctl status wms-api wms-smartup-worker --no-pager
```

**6. Eski dublikat servisni o‘chirish** (agar faqat `wms-api` ishlatilsa)

```bash
sudo systemctl stop wms
sudo systemctl disable wms
```

---

## Alembic — `.env` bilan (vaqtinchalik, `api.env` bo‘sh bo‘lsa)

```bash
cd /var/www/wms/backend
set -a && source .env && set +a
.venv/bin/alembic upgrade head
```

Doimiy yechim: `api.env` ni to‘ldirish (yuqoridagi sinxron).

---

## Health check yo‘llari

Loyiha endpointlari **prefixsiz**:

- `GET http://127.0.0.1:8000/health`
- `GET http://127.0.0.1:8000/health/db`

`/api/v1/health` — 404 (normal).

---

## Work zone — PWA «Saqlab bo'lmadi» / CORS + 500

**Belgilar:** brauzerda CORS xatosi + `POST /api/v1/work-zones` → 500.

**Asosiy sabab:** `work_zones` jadvali yo'q (migratsiya ishlamagan).

**Tekshirish:**

```bash
curl -s https://api.fbwarehouse.uz/health/db
# work_zones: false bo'lsa — migratsiya kerak
```

**Tuzatish:** yuqoridagi `sync-api-env-from-dotenv.sh` + `alembic upgrade head`, keyin `systemctl restart wms-api`.

---

## Work zone funksiyasi

Migratsiya `20260521_0074` (`work_zones` jadvali) muvaffaqiyatdan keyin:

- Admin PWA: `/admin/work-zones`
- Asosiy SmartUp sinxron: `room_id` ro‘yxatda bo‘lsa buyurtma import qilinmaydi

---

## Foydali buyruqlar

```bash
# Loglar
journalctl -u wms-api -f
journalctl -u wms-smartup-worker -n 50 --no-pager

# Worker xatosi
cd /var/www/wms/backend
set -a && source /etc/wms/api.env && set +a
.venv/bin/python worker.py
```
