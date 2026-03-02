# WMS Mobile — Offline rejim hisoboti

Tekshiruv sanasi: 2025 (loyiha holati bo‘yicha).

---

## Xulosa

**Ilova hozircha to‘liq online rejimda ishlaydi.** Offline rejim uchun alohida mantiq (tarmoq aniqlash, lokal saqlash, navbat) **implementatsiya qilinmagan**. Internet bo‘lmasa barcha asosiy sahifalar xato yoki “Qayta urinish” ko‘rsatadi.

---

## 1. Tarmoq holati aniqlanmaydi

- **NetInfo** yoki boshqa “reachability” kutubxonasi **ishlatilmaydi**.
- Ilova “online / offline” ni bilmaydi, faqat so‘rov yuborilganda (masalan, Axios) tarmoq xatosi keladi.

**Natija:** Offline ekanligini oldindan bildirish yoki UI ni “offline” rejimiga o‘zgartirish mumkin emas.

---

## 2. Lokal saqlash (cache) yo‘q

**AsyncStorage** da faqat quyidagilar saqlanadi:

| Ma’lumot      | Kalit              | Qayerda ishlatiladi   |
|---------------|--------------------|------------------------|
| JWT token     | `@wms_access_token`| Kirish / API so‘rovlar |
| Tanlangan til | `@wms_locale`      | i18n (O‘zbek/Rus/Eng)  |

**Saqlanmaydi:**

- Pick task ro‘yxati (oldingi yuklangan list)
- Bitta task tafsiloti (document + lines)
- Inventar ro‘yxati yoki mahsulot tafsiloti
- Skaner orqali so‘ralgan mahsulotlar
- Offline qilish kerak bo‘lgan har qanday “navbat” (pending actions)

**Natija:** Internet uzilsa, ro‘yxatlar va tafsilotlar qayta yuklanmaydi, faqat xato + “Qayta urinish”.

---

## 3. Sahifa-by-sahifa offline xulosa

| Sahifa / funksiya   | Offline holat |
|---------------------|----------------|
| **Login**           | Kirish so‘rovi tarmoqsiz ishlamaydi → xato (Alert). Foydalanuvchi login ekranida qoladi. |
| **PickerHome**      | Sahifa ochiladi (faqat UI). “Offline navbat” kartasi bor, lekin bosilganda **hech narsa qilmaydi** (`onPress={() => {}}`). |
| **PickTaskList**    | `getOpenTasks()` chaqiriladi → tarmoq xatosi → “Ro‘yxat yuklanmadi” + “Qayta urinish” / “Orqaga”. |
| **PickTaskDetails** | Task ma’lumoti `getTaskById()` dan keladi → offline da xato. Terish (pick/complete) ham serverga ketadi → offline da ishlamaydi. |
| **Inventory**      | Ro‘yxat va joylar API dan → offline da yuklanmaydi, xato. |
| **InventoryDetail** | Mahsulot tafsiloti API dan → offline da xato. |
| **Scanner**         | Barcode skanerlanadi → mahsulot `getProductByBarcode` (API) orqali qidiriladi → offline da “Tarmoq xatosi” yoki server xabari. |
| **Hisob (Account)** | Ma’lumot API dan → offline da yuklanmasa xato. Chiqish (logout) lokal (token o‘chiriladi), lekin serverga POST qilish offline da muvaffaqiyatsiz bo‘ladi. |

---

## 4. API client va xato xabarlari

- **client.ts:** Barcha so‘rovlar `apiClient` (Axios) orqali ketadi. Timeout 20s.
- Offline da odatda **response yo‘q** (`err.response === undefined`), Axios `ERR_NETWORK` yoki `ECONNABORTED` (timeout) beradi.
- Interceptor 401/404/5xx ni maxsus qayta ishlaydi; **tarmoq uzilishi** uchun alohida branch **yo‘q** — oxirida `err.message ?? 'Tarmoq xatosi'` ishlatiladi.
- **Natija:** Foydalanuvchi umumiy tarmoq xatosi yoki “Qayta urinish” tugmasi bilan qoladi; “Internet yo‘q” degan aniq yoki tilga mos xabar yo‘q (agar boshqa joyda qo‘yilmasa).

---

## 5. “Offline navbat” kartasi (PickerHome)

- Matnlar: `offlineQueue` (“Offline navbat” / “Offline queue”) va `syncPending` (“Sinxronlash kutilmoqda”).
- Kartaning `onPress` **bo‘sh**: `onPress={() => {}}`.
- **Haqiqiy offline navbat (pending actions queue)** yoki sinxronlash ekrani **yo‘q**.

---

## 6. Xulosa va tavsiyalar

- **Hozirgi holat:** Ilova **faqat online** rejimda to‘liq ishlaydi; offline da barcha serverga bog‘liq sahifalar xato beradi yoki “Qayta urinish” ko‘rsatadi.
- **Offline qilish uchun kerak bo‘ladigan ishlar (qisqa ro‘yxat):**
  1. **Tarmoq holati:** `@react-native-community/netinfo` (yoki ekvivalent) — online/offline aniqlash va UI/ilova mantiqiga ulash.
  2. **Cache:** O‘qish uchun (masalan, oxirgi pick list, task, inventar) — AsyncStorage yoki SQLite bilan lokal saqlash va offline da shu ma’lumotni ko‘rsatish.
  3. **Offline navbat:** Terish/scan kabi harakatlarni offline da navbatga yozish, keyin online bo‘lganda sinxronlash (backend bunday API qo‘llab-quvvatlash kerak).
  4. **Xabarlar:** Tarmoq yo‘q bo‘lganda aniq “Internet ulanmagan” / “Offline” xabari va (ixtiyoriy) tilga mos matnlar.
  5. **“Offline navbat” kartasi:** Haqiqiy offline navbat va sinxronlash ekraniga yo‘naltirish yoki vaqtincha yashirish.

Ushbu hisobot loyiha kodiga qilingan tekshiruv asosida yozilgan; keyingi o‘zgarishlar hisobotni yangilashni talab qilishi mumkin.
