# WMS RBAC Audit Report

**Rol:** Senior Security Engineer + WMS Domain Architect  
**Maqsad:** Mavjud RBAC holatini aniqlash, bo‘shliqlar va xavfli joylarni topish, 3 rol (picker, controller, admin) uchun tavsiya va Quick Fix rejasi.

---

# A) Current RBAC Map — endpoint → himoya

API prefix `/api/v1`. Himoya: dependency (Depends) orqali; "Ochiq" = auth yo‘q; "JWT" = faqat get_current_user.

| METHOD | PATH | Nima qiladi | Hozirgi himoya | Dependency |
|--------|------|-------------|----------------|------------|
| **auth** | | | | |
| POST | /auth/login | Login, token qaytarish | Ochiq | — |
| POST | /auth/logout | Logout | JWT | get_current_user |
| GET | /auth/me | Joriy user | JWT | get_current_user |
| **orders** | | | | |
| GET | /orders | Ro‘yxat | orders:read | require_permission("orders:read") |
| GET | /orders/pickers | Pickerlar ro‘yxati | picking:assign VEYA orders:send_to_picking | require_any_permission |
| GET | /orders/{id} | Bitta order | orders:read | require_permission("orders:read") |
| POST | /orders/sync-smartup | SmartUP sync | orders:sync | require_permission("orders:sync") |
| POST | /orders/{id}/send-to-picking | Picking ga yuborish, allocation | orders:send_to_picking | require_permission |
| POST | /orders/{id}/pack | Pack | documents:edit_status | require_permission |
| POST | /orders/{id}/ship | Yetkazish, ship movement | documents:edit_status | require_permission |
| **picking** | | | | |
| GET | /picking/documents | Hujjatlar ro‘yxati | picking:read | require_permission("picking:read") |
| GET | /picking/documents/{id} | Hujjat batafsil | picking:read | require_permission("picking:read") |
| GET | /picking/controllers | Controllerlar | picking:read | require_permission("picking:read") |
| GET | /picking/pickers | Pickerlar | picking:read | require_permission("picking:read") |
| GET | /picking/my-stats | Mening statistikam | JWT | get_current_user |
| POST | /picking/fcm-token | FCM token | JWT | get_current_user |
| POST | /picking/documents/{id}/send-to-controller | Controllerga yuborish | picking:send_to_controller | require_permission |
| POST | /picking/lines/{id}/pick | Terish (pick) | picking:pick | require_permission("picking:pick") |
| POST | /picking/documents/{id}/complete | Hujjatni tugatish | picking:complete | require_permission("picking:complete") |
| **inventory** | | | | |
| GET | /inventory/lots | Lotlar | inventory:read | require_permission("inventory:read") |
| POST | /inventory/lots | Lot yaratish | inventory:adjust | require_permission("inventory:adjust") |
| GET | /inventory/movements | Harakatlar | movements:read | require_permission("movements:read") |
| POST | /inventory/movements | Movement yozish (adjust va boshqalar) | inventory:adjust | require_permission("inventory:adjust") |
| GET | /inventory/summary, summary-light, details, by-product, balances, ... | O‘qish | inventory:read | require_permission("inventory:read") |
| POST | /inventory/fix-duplicate-pick | Takroriy pick tuzatish | inventory:adjust | require_permission("inventory:adjust") |
| GET | /inventory/by-barcode/{barcode} | Barcode bo‘yicha (picker) | picking:read VEYA inventory:read | PICKER_INVENTORY_PERMISSION |
| GET | /inventory/location/{code} | Joy tarkibi | picking:read VEYA inventory:read | PICKER_INVENTORY_PERMISSION |
| GET | /inventory/picker/locations | Picker joylar ro‘yxati | picking:read VEYA inventory:read | PICKER_INVENTORY_PERMISSION |
| GET | /inventory/picker | Picker inventar ro‘yxati | picking:read VEYA inventory:read | PICKER_INVENTORY_PERMISSION |
| GET | /inventory/picker/{product_id} | Mahsulot batafsil | picking:read VEYA inventory:read | PICKER_INVENTORY_PERMISSION |
| **receiving** | | | | |
| GET | /receiving/receipts | Receiptlar | receiving:read | require_permission("receiving:read") |
| GET | /receiving/receipts/{id} | Bitta receipt | receiving:read | require_permission("receiving:read") |
| POST | /receiving/receipts | Receipt yaratish | receiving:write VEYA admin:access | require_any_permission |
| POST | /receiving/receipts/{id}/complete | Receiptni tugatish, movement | receiving:write VEYA admin:access | require_any_permission |
| **locations** | | | | |
| GET | /locations | Ro‘yxat | locations:manage | require_permission("locations:manage") |
| GET | /locations/{id} | Bitta | locations:manage | require_permission("locations:manage") |
| POST | /locations | Yaratish | locations:manage | require_permission("locations:manage") |
| PUT/PATCH | /locations/{id} | Tahrirlash | locations:manage | require_permission("locations:manage") |
| DELETE | /locations/{id} | O‘chirish/faolsizlantirish | locations:manage | require_permission("locations:manage") |
| **products** | | | | |
| GET | /products, /products/{id}, by-barcode, ... | O‘qish | products:read | require_permission("products:read") |
| POST | /products | Yaratish | products:write | require_permission("products:write") |
| POST | /products/import | Import | products:write | require_permission("products:write") |
| **documents** | | | | |
| POST | /documents | Hujjat yaratish | documents:create | require_permission("documents:create") |
| GET | /documents | Ro‘yxat | documents:read | require_permission("documents:read") |
| GET | /documents/{id} | Bitta | documents:read | require_permission("documents:read") |
| PATCH | /documents/{id} | Status (cancel va boshqalar) | documents:edit_status | require_permission("documents:edit_status") |
| **users** | | | | |
| GET | /users | Ro‘yxat | users:manage | require_permission("users:manage") |
| GET | /users/{id} | Bitta | users:manage | require_permission("users:manage") |
| POST | /users | Yaratish | users:manage | require_permission("users:manage") |
| PATCH | /users/{id} | Tahrirlash | users:manage | require_permission("users:manage") |
| POST | /users/{id}/reset-password | Parol reset | users:manage | require_permission("users:manage") |
| DELETE | /users/{id} | Faolsizlantirish | users:manage | require_permission("users:manage") |
| **audit** | | | | |
| GET | /audit | Audit log | audit:read | require_permission("audit:read") |
| **reports** | | | | |
| GET | /reports/stock-summary, fefo-risk, picker-performance | Hisobotlar | reports:read | require_permission("reports:read") |
| **integrations** | | | | |
| POST | /integrations/smartup/import | SmartUP import | admin:access | require_permission("admin:access") |
| **dashboard** | | | | |
| GET | /dashboard/summary, ... | Dashboard | admin:access | require_permission("admin:access") |
| **brands** | | | | |
| GET | /brands | Ro‘yxat | admin:access | require_permission("admin:access") (list); brands:manage (boshqalar) |
| POST/PUT/DELETE | /brands | CRUD | brands:manage | require_permission("brands:manage") |
| **scanner** | | | | |
| POST | /scanner/resolve | Barcode → product/location | picking:read VEYA inventory:read | PICKER_ACCESS |
| **waves** | | | | |
| POST | /waves | Wave yaratish | waves:create | require_permission("waves:create") |
| GET | /waves | Ro‘yxat | waves:read | require_permission("waves:read") |
| GET | /waves/{id} | Bitta | waves:read | require_permission("waves:read") |
| POST | /waves/{id}/start | Start (FEFO allocation) | waves:manage | require_permission("waves:manage") |
| POST | /waves/{id}/pick/scan | Pick skaner | waves:pick | require_permission("waves:pick") |
| POST | /waves/{id}/sorting/scan | Sortirovka | waves:sort | require_permission("waves:sort") |
| POST | /waves/{id}/complete | Wave tugatish | waves:manage | require_permission("waves:manage") |
| **download** | | | | |
| GET | /download/app | APK yuklab olish | Ochiq | Hech narsa |

---

# B) Gaps & Risks (kritiklik bo‘yicha)

## Kritik

| # | Muammo | Qayerda | Ta’sir |
|---|--------|--------|--------|
| 1 | **Picker backend da receiving:write bor** | `backend/app/auth/permissions.py` — picker roli | Picker token bilan POST /receiving/receipts va complete chaqirib, kirim yozishi mumkin. |
| 2 | **Download/app ochiq** | `backend/app/api/v1/endpoints/download.py` | Auth yo‘q — ma’lumot o‘grilash emas, lekin APK public; agar faqat ichki kerak bo‘lsa auth qo‘shish mumkin. |
| 3 | **move-to-zone endpoint yo‘q** | Hujjatda reja, kodda amalda yo‘q | Kelajakda qo‘shilsa: faqat controller/admin (inventory:adjust yoki alohida permission) qilishi kerak. |
| 4 | **inventory_controller da picking:complete bor, documents:edit_status yo‘q** | permissions.py | Controller hujjatni "complete" qiladi, lekin cancel (edit_status) qila olmaydi — bu maqsadga muvofiq. Lekin controller "approve/adjust" uchun inventory:adjust olmagan; adjust faqat admin/supervisor. |

## Yuqori

| # | Muammo | Qayerda | Ta’sir |
|---|--------|--------|--------|
| 5 | **Frontend picker da inventory:read yo‘q** | `mobile-pwa/src/rbac/permissions.ts` — picker faqat picking:* | Picker inventory (by-barcode, picker list) backend da picking:read VEYA inventory:read bilan ochiq; backend picker ga receiving:write bergani xavfli, frontend esa picker ga kamroq bergan. |
| 6 | **Faqat frontend guard** | Admin route lar | Admin sahifalar RequirePermission("admin:access") + alohida permission; backend ham shu permission ni tekshiradi — ziddiyat yo‘q. Lekin boshqa rol token bilan admin endpoint ni chaqirsa backend 403 beradi. |
| 7 | **orders/ship va pack — documents:edit_status** | orders.py | Ship va cancel bir xil permission; rol ajratish (masalan ship faqat controller) hozir yo‘q. |

## O‘rta

| # | Muammo | Qayerda | Ta’sir |
|---|--------|--------|--------|
| 8 | **inventory:adjust** | Admin + supervisor da | Adjust, fix-duplicate-pick, POST lots, POST movements — barchasi inventory:adjust. Controller da yo‘q — to‘g‘ri. Picker da yo‘q — to‘g‘ri. |
| 9 | **locations:manage** | Barcha CRUD bir permission | Joy yaratish/tahrirlash faqat admin/supervisor; controller da yo‘q. |
| 10 | **users:manage** | Faqat admin (warehouse_admin) | Backend da supervisor da users:manage yo‘q — to‘g‘ri. |

---

# C) Recommended RBAC Matrix (3 rol: picker, controller, admin)

Biz faqat **picker**, **inventory_controller**, **warehouse_admin** (admin) bilan ishlaymiz. supervisor va receiver ni hisobga olmasak:

| Permission / operatsiya | Picker | Controller | Admin |
|------------------------|--------|------------|-------|
| picking:read | ✅ | ✅ | ✅ |
| picking:pick | ✅ | ❌ | ✅ |
| picking:complete | ❌ (faqat o‘zi terganini tasdiqlash — hozir complete bor) | ✅ | ✅ |
| picking:send_to_controller | ✅ | ❌ | ✅ |
| inventory:read | ✅ | ✅ | ✅ |
| inventory:adjust | ❌ | ✅ (approve/adjust) | ✅ |
| inventory:count | ❌ (count qiladi, adjust qilmasin) | ✅ | ✅ |
| receiving:read | ❌ yoki ✅ (ko‘rish ixtiyoriy) | ✅ | ✅ |
| receiving:write | ❌ | ✅ | ✅ |
| documents:read | ✅ (o‘z vazifalari) | ✅ | ✅ |
| documents:edit_status | ❌ | ✅ (cancel, status) | ✅ |
| orders:read | ❌ | ✅ | ✅ |
| orders:send_to_picking | ❌ | ✅ | ✅ |
| locations:manage | ❌ | ❌ | ✅ |
| users:manage | ❌ | ❌ | ✅ |
| audit:read | ❌ | ✅ | ✅ |
| reports:read | ❌ | ✅ | ✅ |
| admin:access | ❌ | ✅ (panel kirish) | ✅ |
| integrations (SmartUP) | ❌ | ❌ | ✅ |
| brands:manage | ❌ | ❌ | ✅ |
| products:read | ✅ | ✅ | ✅ |
| products:write | ❌ | ❌ | ✅ |
| movements:read | ❌ | ✅ | ✅ |
| waves:* | loyiha qoidasiga qarab (picker wave:pick) | ✅ | ✅ |

**Xavfli operatsiyalar — qaysi rol:**

- **inventory adjust (+/-)** → Controller, Admin (Picker ❌).
- **move-to-zone (expired/damaged)** → Controller, Admin (reason_code majburiy); Picker faqat ko‘rish yoki maxsus "move_expired" permission.
- **order cancel / document status** → Controller, Admin (Picker ❌).
- **location create/edit** → Admin only.
- **user/role management** → Admin only.
- **integrations (SmartUP)** → Admin only.
- **fix-duplicate-pick, cleanup** → Admin (yoki controller agar inventory:adjust bersak).

---

# D) Patch List — qaysi faylga nima

## 1-kun: Backend — eng xavfli tuzatishlar

| Fayl | O‘zgartirish |
|------|---------------|
| `backend/app/auth/permissions.py` | **picker** rolidan `receiving:read`, `receiving:write` ni **olib tashlash**. Picker faqat picking:* va inventory:read, products:read. |
| `backend/app/auth/permissions.py` | **inventory_controller** ga: `inventory:adjust`, `inventory:count`, `documents:edit_status`, `receiving:read`, `receiving:write`, `orders:read`, `orders:send_to_picking`, `movements:read` qo‘shish (tavsiya matritsaga moslashtirish). `admin:access` saqlanadi (panel kirish). |
| `backend/app/api/v1/endpoints/download.py` | (Ixtiyoriy) APK uchun optional auth: masalan `require_permission("admin:access")` yoki token tekshiruv — agar APK faqat ichki tarmoqda bo‘lsa. |

## 2-kun: Frontend — route guard va permission map

| Fayl | O‘zgartirish |
|------|---------------|
| `mobile-pwa/src/rbac/permissions.ts` | **picker** uchun `inventory:read` qo‘shish (by-barcode, picker inventory ishlashi uchun). **picker** da receiving yo‘q ekanligini tasdiqlash. |
| `mobile-pwa/src/rbac/permissions.ts` | **inventory_controller** uchun ROLE_PERMISSIONS ni backend tavsiyasi bilan moslashtirish (inventory:adjust, documents:edit_status, receiving:*, orders:read, movements:read). |
| `mobile-pwa/src/app/App.tsx` | Admin route larda controller uchun receiving, inventory adjust, documents edit sahifalari ruxsatini tekshirish (RequirePermission zanjiri). |

## 3-kun: Yangi endpoint lar (move-to-zone, adjust)

| Fayl | O‘zgartirish |
|------|---------------|
| `backend/app/api/v1/endpoints/inventory.py` | POST /inventory/move-to-zone: `require_permission("inventory:adjust")` yoki yangi `inventory:move_zone` (controller + admin). |
| `backend/app/auth/permissions.py` | (Ixtiyoriy) `inventory:move_zone` permission qo‘shish va controller + admin ga berish. |

---

# E) Test Checklist (10–15 tekshiruv)

1. **Picker** token bilan POST /receiving/receipts → 403 (picker da receiving:write olib tashlangandan keyin).
2. **Picker** token bilan POST /inventory/movements (adjust) → 403.
3. **Picker** token bilan PATCH /documents/{id} (cancel) → 403.
4. **Picker** token bilan GET /inventory/picker → 200 (inventory:read yoki picking:read bor).
5. **Picker** token bilan POST /picking/lines/{id}/pick → 200.
6. **Controller** token bilan GET /admin/inventory (veb) → 200; POST /inventory/movements (adjust) → 200 (controller ga inventory:adjust berilganda).
7. **Controller** token bilan PATCH /documents/{id} (cancel) → 200 (controller ga documents:edit_status berilganda).
8. **Controller** token bilan GET /users → 403 (users:manage yo‘q).
9. **Admin** token bilan POST /users, GET /audit, POST /integrations/smartup/import → 200 yoki 204.
10. **Admin** token bilan POST /locations, PATCH /locations/{id} → 200.
11. **Token siz** GET /auth/me → 401.
12. **Noto‘g‘ri rol** GET /orders (picker, orders:read yo‘q) → 403.
13. **Frontend:** Picker login → /picker; Controller → /controller; Admin → /admin; Not-authorized sahifaga yo‘naltirish.
14. **FCM token:** Picker POST /picking/fcm-token → 204 (faqat JWT).
15. **Download/app:** Hozirgi holatda ochiq; auth qo‘shilsa, token siz GET /download/app → 401.

---

# Qisqacha

- **Backend:** Ko‘pchilik endpoint da `require_permission(...)` yoki `require_any_permission(...)` bor. Asosiy gap: **picker** ga `receiving:read`/`receiving:write` berilgani — olib tashlash kerak.
- **Frontend:** Route guard (RequirePermission, RequireRoleOrPermission) admin va controller/picker ajratadi; frontend da picker ga inventory:read qo‘shilsa, by-barcode va picker inventory ishlaydi.
- **Xavfli operatsiyalar:** inventory:adjust, documents:edit_status, users:manage, locations:manage, integrations — faqat admin (va kerak bo‘lsa controller) da bo‘lishi kerak; picker da yo‘q.
- **Quick fix:** 1) permissions.py da picker dan receiving olib tashlash; 2) controller ga tavsiya matritsa bo‘yicha permission qo‘shish; 3) frontend ROLE_PERMISSIONS ni moslash; 4) yuqoridagi test checklist dan 15 ta tekshiruv.
