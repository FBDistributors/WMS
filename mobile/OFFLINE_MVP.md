# WMS Mobile — Offline MVP (Picker flow)

Qisqa yo‘riqnoma: offline rejim qanday ishlaydi va qanday test qilinadi.

---

## Maqsad

Internet bo‘lmasa ham Picker terishni davom ettirishi mumkin:

- **PickTaskList** va **PickTaskDetails** offline cache’dan ochiladi
- **Barcode scan** offline ishlaydi (cache’dagi task/lines orqali; barcode_index task detail cache’da)
- Terish harakatlari **offline queue** ga yoziladi
- Internet qaytganda navbat **avtomatik** sinxronlanadi (yoki "Sinxronlash" tugmasi)

---

## Modullar

| Modul | Vazifa |
|-------|--------|
| `src/network/networkContext.tsx` | NetInfo, `isOnline` state, online bo‘lganda avto-sync |
| `src/offline/offlineDb.ts` | SQLite: cache (tasks, task detail, barcode_index) + offline_queue |
| `src/offline/offlineQueue.ts` | Queue: add, get pending/failed, retry |
| `src/offline/syncEngine.ts` | Pending queue’ni FIFO serverga yuborish (PICK_SCAN, PICK_CONFIRM_ITEM, PICK_CLOSE_TASK) |

---

## Cache strategiya

- **Login / PickerHome** dan keyin:
  - **Online:** PickTaskList ochilganda `/api/v1/picking/documents` chaqiriladi, javob `cached_pick_tasks` ga yoziladi
  - Task detail ochilganda `/api/v1/picking/documents/{id}` chaqiriladi, javob `cached_pick_task_items` ga va barcode’lar `barcode_index` ga yoziladi
- **Offline:**
  - PickTaskList: ro‘yxat `cached_pick_tasks` dan o‘qiladi
  - PickTaskDetails: bitta task `cached_pick_task_items` dan o‘qiladi
  - Scan: hozircha terish ekranida barcode qidirish doc.lines orqali (barcode_index task detail cache bilan to‘ldirilgan)

---

## Offline queue

Faqat **offline** bo‘lganda harakatlar queue ga yoziladi:

- **PICK_SCAN** — bitta shtrix skanerlanganda (1 birlik)
- **PICK_CONFIRM_ITEM** — qator uchun qo‘shimcha miqdor tasdiqlanganda
- **PICK_CLOSE_TASK** — "Terishni tugatish" bosilganda

**Sync:** Online bo‘lganda yoki QueueScreen’da "Sinxronlash" bosilganda `syncEngine.syncPendingQueue()` FIFO bo‘yicha serverga yuboradi. Muvaffaqiyat → `done`, xato → `failed` + "Qayta urinish".

---

## UI

- **PickerHome:** Yuqorida offline bo‘lsa "Offline" badge; banner: "Offline. Navbatda: X ta". "Offline navbat (X)" kartasi → **QueueScreen**
- **QueueScreen:** Pending / Failed ro‘yxat, "Sinxronlash" tugmasi, failed uchun "Qayta urinish"

---

## Qanday test qilish

1. **Cache:**  
   - Internet **yoqik** holda ilovani oching, Login → PickerHome → Pick task list.  
   - Avval online bo‘lib list va bitta task detail ochib cache to‘ldiring.  
   - Keyin Internet ni o‘chiring (Wi‑Fi/mobil ma’lumot).  
   - PickTaskList va PickTaskDetails ni oching — ma’lumot cache’dan chiqishi kerak.

2. **Offline terish:**  
   - Offline holda task detail da shtrix skanerlang yoki qator bo‘yicha miqdor tasdiqlang.  
   - "Terishni tugatish" bosing.  
   - Barcha harakatlar faqat lokaldagi queue ga yoziladi, xato bo‘lmasligi kerak.

3. **Sync:**  
   - Internet ni qayta yoqing.  
   - Bir oz kutib turing yoki PickerHome’dan "Offline navbat" → "Sinxronlash" bosing.  
   - QueueScreen’da pending’lar ketma-ket "done" bo‘lishi, serverda ham terish aks etishi kerak.

4. **Failed + Retry:**  
   - Offline da bir nechta harakat qiling, keyin serverni o‘chirib qo‘ying (yoki noto‘g‘ri API), keyin "Sinxronlash" bosing.  
   - Ba’zi elementlar "failed" bo‘ladi.  
   - Serverni qayta yoqing, failed elementda "Qayta urinish" bosing — qayta sinxronlash ishlashi kerak.

---

## Edge cases (MVP)

- **Task serverda o‘zgargan:** Conflict banner hozircha qo‘yilmagan; keyingi versiyada "Task yangilangan, qayta yuklab oling" va queue’dagi tegishli eventlarni failed qilmasdan yo‘l-yo‘riq qo‘shish mumkin.
- **401:** Sync paytida 401 bo‘lsa token o‘chiriladi, foydalanuvchi Login’ga yo‘naltiriladi (mavjud client interceptor).
- **App qayta ochilganda:** Queue SQLite’da saqlanadi, ilova qayta ochilganda ham qoladi.

---

## O‘rnatish

```bash
cd mobile
npm install
npx react-native run-android
```

`@react-native-community/netinfo` va `react-native-sqlite-storage` package.json’da. Android uchun native link odatda avtomatik.
