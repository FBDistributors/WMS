# Flutter → Kotlin (native Android) ko'chirish rejasi

*Tuzilgan: 2026-06-29. Maqsad: `mobile_flutter/` ilovasini vaqt o'tishi bilan
to'liq almashtiradigan alohida Kotlin (Jetpack Compose) ilova qurish.*

## Holat (2026-07-01)

- **Bosqich 0 — bajarildi.** Loyiha: [`mobile_kotlin/`](mobile_kotlin). Package
  `uz.fbwarehouse.android` (`uz.fbwarehouse.native` ishlamadi — `native` Java'ning
  zaxiralangan so'zi). Debug build muvaffaqiyatli. Login → `/auth/me` → Home →
  chiqish oqimi ishlaydi.
- **Bosqich 1 — boshlandi (asosiy vertikal kesim).** Pick tasks ro'yxati
  (`GET /picking/documents`) → hujjat detali (`GET /picking/documents/{id}`) →
  qo'lda qator terish (`POST /picking/lines/{id}/pick`, oddiy miqdor kiritish).
  Debug build muvaffaqiyatli.
  **Hali qolgan (Bosqich 1 ichida):** barcode skanerlash (CameraX+ML Kit), quti/dona
  hybrid mantiq, konsolidatsiyalashgan (ko'p buyurtmali) terish, qaytarish sessiyasi,
  offline navbat (WorkManager).
- **Bosqich 2 — boshlandi.** Inventarizatsiya qidiruv: shtrix-kod/SKU bo'yicha
  qidirish (`GET /inventory/by-barcode/{barcode}`) — eng yaxshi joylashuvlar,
  FEFO lotlar, jami mavjud miqdor. Debug build muvaffaqiyatli.
  **Hali qolgan (Bosqich 2 ichida):** joy bo'yicha ko'rish (`/inventory/location/{code}`),
  ko'chirish (movement/transfer) ekranlari.
- **Bosqich 3 — boshlandi.** Yangi mahsulot qabul qilish: shtrix-kod/SKU qidirish
  (Bosqich 2'dagi `InventoryRepository` qayta ishlatildi) → joylashuv tanlash
  (`GET /locations`) → miqdor kiritish → bitta atomik so'rov bilan
  yaratish+yakunlash (`POST /receiving/receipts`, `complete=true`). Debug build
  muvaffaqiyatli.
  **Hali qolgan (Bosqich 3 ichida):** ko'p qatorli qabul (bir nechta mahsulot bitta
  hujjatda), batch/muddat qo'lda kiritish, box/loose hybrid, FEFO guruhlash,
  mijoz qaytarishlari oqimi — bularning barchasi `kirim_form_screen.dart`
  (2475 qator)dagi asosiy murakkablik.
- **Bosqich 4 — boshlandi.** Controller: mijoz qaytarishlari navbati
  (`GET /customer-returns?status=pending_controller`) → detal (qatorlar: mahsulot,
  miqdor, joy) → tasdiqlash (`POST /customer-returns/{id}/controller-approve`).
  Debug build muvaffaqiyatli.
  **Hali qolgan (Bosqich 4 ichida):** picker'ga biriktirish (`assign-picker`),
  qaytarishni yakunlash (`complete`), yig'uvchi tomonidan qaytarish qabul qilish
  oqimi.
- **Bosqich 5 — boshlandi.** Yordamchi funksiyalar: parolni o'zgartirish
  (`POST /auth/change-password`), ilova haqida fikr bildirish — 1-5 yulduz +
  izoh (`POST /app-feedback`). Debug build muvaffaqiyatli (ikkinchi ketma-ket
  xatosiz build).
  **Ataylab qilinmagan:** Notifications ekrani — backendда "mening
  bildirishnomalarim" GET endpoint yo'q, Flutter'da ham bu FCM orqali kelgan
  push'larni lokal saqlashga asoslangan (`persisted_notifications_repository.dart`) —
  bu Firebase/FCM integratsiyasini talab qiladi, hali sozlanmagan. VIP/general
  customers — asosan admin-fokusli/picker uchun mustaqil ekran sifatida past
  qiymat, o'tkazib yuborildi.
- **Qurilmada tasdiqlangan (2026-07-01, foydalanuvchi tomonidan, real backend
  bilan, rol `inventory_controller`):** Login → Home (ism/rol to'g'ri) → Inventory
  qidiruv (haqiqiy mahsulot topildi, joylashuv/FEFO/muddat to'g'ri) → Pick tasks
  ro'yxati (haqiqiy biriktirilgan hujjat ko'rindi). Receiving/pick-line submit
  (yozish amallari), customer returns, change password, feedback hali alohida
  tasdiqlanmagan.

- **Barcode skanerlash qo'shildi (chuqurlik, Bosqich 1/2/3 kesib o'tadi).**
  Qayta ishlatiladigan `ScannerScreen` (CameraX + ML Kit `barcode-scanning`),
  kamera ruxsatini so'raydi, natijani Navigation Compose SavedStateHandle orqali
  chaqiruvchi ekranga qaytaradi. **Inventory** va **Receiving** ekranlariga skan
  tugmasi ulandi — skanerlangan kod avtomatik qidiruvni ishga tushiradi. Debug
  build muvaffaqiyatli (APK hajmi 13MB→46MB — ML Kit native kutubxonalari
  sababli, normal holat).
  **Pick task detail'ga ham ulandi:** FloatingActionButton (skan) — hujjat
  qatorlaridan skanerlangan shtrix-kodga mos, hali tugallanmagan qatorga
  avtomatik 1 dona qo'shadi (`pickLineByBarcode`); mos kelmasa Snackbar orqali
  "topilmadi" xabari. Debug build muvaffaqiyatli.
  **Hali qolgan:** signal tovushi (Flutter'dagi `scan_beep.wav` kabi); skan
  bilan >1 dona qo'shish (hozir har skan = 1 dona).

- **Offline pick navbati qo'shildi (chuqurlik, Bosqich 1).** Room
  (`PendingPickEntity`/`PendingPickDao`/`AppDatabase`) ishga tushirildi.
  `PickingRepository.pickLine` endi tarmoq xatosini (`AppError.Network`)
  alohida ushlaydi: agar internet yo'q bo'lsa, amal lokal bazaga saqlanadi
  (`PickOutcome.Queued`) va progress **optimistik** (lokal) yangilanadi —
  picker internetsiz ham terishni davom ettiraveradi. Hujjat har safar
  ochilganda (`load()`) avval navbatdagi amallar sinxronlanadi
  (`syncPendingPicks`, tartib bo'yicha, birinchi muvaffaqiyatsizlikda
  to'xtaydi), keyin hujjat serverdan qayta o'qiladi. UI: Snackbar orqali
  "Internet yo'q — terish saqlandi" xabari.
  **Build tuzatishi:** Room 2.6.1 KSP annotatsiya protsessori Kotlin
  2.2.20'ning yangi KSP2 rejimi bilan `unexpected jvm signature V` xatosini
  berdi — `gradle.properties`ga `ksp.useKSP2=false` qo'shib KSP1 (legacy)
  rejimiga o'tkazildi, muammo hal bo'ldi.
  **Hali qolgan:** boshqa modullar (receiving, customer returns) uchun
  offline navbat yo'q — hozir faqat picking. WorkManager orqali fon
  sinxronizatsiya (ilova yopiq bo'lsa ham) — hozir faqat ekran ochilganda
  sinxronlanadi.

- **Movement (Stock ko'chirish) ekrani qo'shildi — Bosqich 2 to'ldirildi.**
  `POST /inventory/movements/transfer-location` (`mode=full`) — manba
  joydagi barcha **qutisiz (loose)** zaxirani manzil joyga ko'chiradi (yopiq
  qutilar joyida qoladi — backend Q4 qarori). Ikki joy tanlash dropdown +
  natija xabari (necha qator/harakat ko'chdi). `Idempotency-Key` header
  bilan. Debug build birinchi urinishda muvaffaqiyatli.
  **Hali qolgan:** `mode=partial` (aniq lot+miqdor tanlab ko'chirish) —
  hozir faqat "hammasini ko'chirish"; quti (box) ko'chirish alohida
  endpoint (`relocate_sealed_box`) — ulanmagan.

- **Mijoz qaytarishlari to'liq lifecycle — Bosqich 4 to'ldirildi.** Avvalgi
  faqat "tasdiqlash" (controller-approve) endi to'liq zanjirga kengaytirildi:
  `pending_controller` (tasdiqlash) → `approved` (yig'uvchiga biriktirish,
  `GET /picking/pickers` + `POST .../assign-picker`) → `assigned_to_picker`
  (yakunlash, joylashuv tanlab `POST .../complete`) → `completed`. Navbat
  ekrani endi **ikkala** ro'yxatni birlashtiradi — controller uchun
  `status=pending_controller`, picker uchun `mine_as_picker=true` (bittasi
  rol yetishmasligi sababli xato bersa, jim o'tkaziladi — faqat ikkalasi
  ham muvaffaqiyatsiz bo'lsa xato ko'rsatiladi). Har kartada status yorlig'i.
  Debug build birinchi urinishda muvaffaqiyatli.
  **Hali qolgan:** qator darajasida joy tanlash (`complete` payload'i hozir
  bitta umumiy joy yuboradi, `lines: [{line_id, location_id}]` qo'llab-
  quvvatlanmaydi).

- **Ko'p qatorli kirim — Bosqich 3 kengaytirildi.** `NewReceiptScreen` endi
  bitta mahsulot bilan cheklanmaydi: qidirib/skanerlab, joy va miqdor tanlab
  "Qatorga qo'shish" — bir nechta mahsulot ro'yxatga to'planadi (har birini
  olib tashlash tugmasi bilan), so'ng "Hammasini qabul qilish" bitta atomik
  `POST /receiving/receipts` so'rovida (`lines: [...]`, `complete=true`)
  yuboradi. `ReceivingRepository.receiveSingleLine` → `receiveLines(lines)`
  ga almashtirildi. Debug build birinchi urinishda muvaffaqiyatli.
  **Hali qolgan:** batch/muddat qo'lda kiritish, box/loose hybrid, FEFO
  guruhlash — bularning barchasi `kirim_form_screen.dart` murakkabligi.

- **Batch/muddat qo'lda kiritish qo'shildi.** Har bir kirim qatoriga
  ixtiyoriy partiya raqami (matn) va muddat (Material3 `DatePicker`, ISO
  YYYY-MM-DD) kiritish mumkin — bo'sh qoldirilsa backend avtomatik partiya
  generatsiya qiladi. Qo'shilgan qatorlar ro'yxatida ko'rsatiladi. Debug
  build birinchi urinishda muvaffaqiyatli.
  **Hali qolgan:** box/loose hybrid, FEFO guruhlash — hali `kirim_form_screen.dart`
  murakkabligi qoladi.

- **Quti (box) qabul qilish qo'shildi — muhim topilma.** Ma'lum bo'ldiki,
  mavjud `GET /inventory/by-barcode/{barcode}` (Bosqich 2'da qurilgan)
  yopiq quti shtrix-kodini **allaqachon** tanib olar edi va `scan_kind`,
  `units_per_box`, `box_barcode` maydonlarini qaytarardi — Kotlin tomonida
  shunchaki modellanmagan edi. Yangi endpoint kerak bo'lmadi: DTO'ga 3
  maydon qo'shildi, `NewReceiptViewModel`da `isBoxScan` holati — quti
  skanerlanganda "Miqdor" o'rniga "Quti soni" ko'rsatiladi, jami dona
  avtomatik hisoblanadi (quti soni × quti sig'imi), `box_barcode`/`box_count`
  qo'shimcha yuboriladi (backend `_validate_box_receipt_line` orqali
  tekshiradi: quti mahsulotga mos, qty >= kutilgan). Debug build birinchi
  urinishda muvaffaqiyatli.
  **Hali qolgan:** Picking tomonida hybrid box (quti/dona tanlash pick
  paytida) — bu ancha murakkabroq, chunki bir nechta joy/lot bo'yicha
  quti/loose taqsimotini bilish kerak.

- **Picking'da quti bilan skanerlab terish qo'shildi.** `pickLineByBarcode`
  endi ikki bosqichli: (1) qatorning o'z dona shtrix-kodiga to'g'ridan-to'g'ri
  moslik (tezkor, mavjud yo'l) — mos kelmasa (2) `InventoryRepository`
  orqali kodni hal qilish (`scan_kind`). Agar yopiq **quti** shtrix-kodi
  ekan (mahsulot document qatorlaridan biriga mos) — 1 quti (units_per_box
  qadar dona) avtomatik qo'shiladi, `box_count=1` backendga yuboriladi.
  `PickingLineDto`ga `productId`, `PickLineRequestDto`ga `boxCount`,
  `PendingPickEntity`ga `boxCount` (offline navbat uchun ham) qo'shildi.
  Room sxema versiyasi 2'ga oshirildi (`fallbackToDestructiveMigration` —
  kesh faqat vaqtinchalik navbat, ma'lumot yo'qotish xavfsiz). Debug build
  birinchi urinishda muvaffaqiyatli (10-marta ketma-ket).
  **Hali qolgan:** bir nechta quti sonini kiritish (hozir skan = doim 1
  quti); qisman ochilgan quti (hybrid dona+quti) mantiqi.

- **Offline navbat Receiving'ga ham kengaytirildi.** `PendingReceiptEntity`
  (Room, qatorlar ro'yxati JSON qator sifatida saqlanadi) + `PendingReceiptDao`.
  `ReceivingRepository.receiveLines` endi tarmoq xatosida butun hujjatni
  (barcha qatorlari bilan) navbatga saqlaydi (`ReceiveOutcome.Queued`) —
  picker internetsiz ham kirim qilishni davom ettiraveradi. Ekran ochilganda
  (`init`) avval navbat sinxronlanadi (`syncPendingReceipts`). Room sxema
  versiyasi 3'ga oshirildi. Debug build birinchi urinishda muvaffaqiyatli
  (11-marta ketma-ket).
  **Hali qolgan:** Movement va Customer Returns uchun offline navbat yo'q.

## Qolgan ishlar (asosiy modullar tugagach)

Barcha 5 bosqich boshlab qo'yildi (asosiy vertikal kesim + build tasdiqlangan).
Endi ikki yo'nalish qoladi:
1. **Chuqurlik** — har bosqichdagi "hali qolgan" ro'yxatlarini to'ldirish
   (barcode skanerlash, offline navbat, hybrid box mantiq, ko'p qatorli kirim,
   picker-return oqimi, Firebase/push).
2. **Sifat** — barcha yozish amallarini (pick, receive, approve, change
   password, feedback) haqiqiy qurilmada sinash, xatolarni tuzatish.

**Dizayn bosqichi (qaror, 2026-07-01, foydalanuvchi tomonidan):** hozircha
barcha ekranlar Material3 standart ko'rinishida (brendlash/dizayn yo'q, faqat
asosiy accent rang veb-panelга mos). Vizual dizayn ataylab **keyinga
qoldirilgan** — asosiy funksional oqimlar (picking, inventory, receiving,
customer returns) to'liq tugab, qurilmada sinalgach, **bitta izchil dizayn
bosqichida** barcha ekranlar birga chiroylashtiriladi. Bu erta boshlab, keyin
struktura o'zgarganda qayta ishlashning oldini oladi.

---

## 0. Asosiy qarorlar (boshlashdan oldin tasdiqlanishi kerak)

| Qaror | Tavsiya |
|-------|---------|
| Yangi loyiha joyi | `mobile_kotlin/` — repo ildizida, `mobile_flutter/`ga tegilmaydi |
| Package nomi | `uz.fbwarehouse.wms` band (Flutter Play Store'da). O'tish davrida boshqa nom: `uz.fbwarehouse.native` yoki `uz.fbwarehouse.android`. Cutover kunida asosiy nomga ko'chiriladi (yoki ikkalasi alohida qoladi — hal qilish kerak) |
| UI toolkit | Jetpack Compose (zamonaviy, tez yoziladi, Riverpod'ga konseptual yaqin) |
| Tarmoq | Retrofit + OkHttp (Dio o'rnini bosadi) |
| DI | Hilt |
| Async | Kotlin Coroutines + Flow (Riverpod AsyncNotifier o'rnini bosadi) |
| Lokal DB (offline kesh) | Room (sqflite o'rnini bosadi) |
| Kalit-qiymat saqlash | Jetpack DataStore (shared_preferences o'rnini bosadi) |
| Fon sinxronizatsiya | WorkManager (offline_sync_service o'rnini bosadi) |
| Barcode skaner | CameraX + ML Kit Barcode Scanning (mobile_scanner o'rnini bosadi) |
| Push | Firebase Messaging (o'zgarmaydi — yangi package uchun Firebase'da qayta ro'yxatdan o'tkaziladi, xuddi Play Store sozlashda qilganimizdek) |
| Navigatsiya | Navigation Compose (go_router o'rnini bosadi) |
| Backend | **O'zgarmaydi** — bir xil FastAPI REST API, bir xil auth, bir xil idempotency kalitlari |

---

## 1. Ko'chirish tamoyillari

1. **Backend'ga tegilmaydi.** Ikkala ilova ham bir xil `/api/v1/*` bilan gaplashadi.
2. **Avval funksional tenglik, keyin bezak.** UI'ni chiroylashtirish emas, Flutter'dagi xatti-harakatni aniq takrorlash — birinchi maqsad.
3. **Bosqichma-bosqich, foydalanish chastotasiga qarab.** Eng ko'p ishlatiladigan (picker) oqim birinchi, kamdan-kam ishlatiladigan (VIP customers, feedback) oxirida.
4. **Parallel ishlaydi.** Kotlin tayyor bo'lgunga qadar Flutter production'da qoladi; xodimlar bosqichma-bosqich ko'chiriladi.
5. **Offline-first semantika saqlanadi.** Backend idempotency kalitlari (`sync-${queueId}-${timestamp}` formatida) bilan mos kelishi shart — aks holda takroriy pick/scan yozilib qolishi mumkin.

---

## 2. Hozirgi Flutter ilovaning xaritasi (ko'chirish uchun asos)

Umumiy hajm: ~26 000 qator Dart. Taqsimot:

| Modul | Qator | Murakkablik | Izoh |
|-------|-------|--------------|------|
| `picking` | 6 860 | **ENG YUQORI** | Ko'p buyurtmali konsolidatsiya, hybrid box/loose pick, offline navbat, controller verify |
| `kirim` (receiving) | 4 787 | **ENG YUQORI** | Murakkab forma holati, FEFO, box/loose hybrid, bir nechta oqim |
| `inventory` | 2 188 | O'rta-yuqori | Mahsulot/joy qidiruv, detail, barcode resolve, box breakdown |
| `customer_returns` | 1 394 | O'rta | Navbat, detail, tekshirish oqimi |
| `movements` | 1 050 | O'rta | Mahsulot va pallet-rejim ko'chirish |
| `product_boxes` | 678 | O'rta | Box barcode qidiruv, ro'yxatga olish, joylashtirish |
| `scanner` | 579 | O'rta | Kamera + debounce + resolve routing |
| `auth` | 500 | Past | Login, token, logout, parol o'zgartirish |
| `notifications` | 340 | Past | FCM + lokal bildirishnoma ro'yxati |
| `feedback` | 359 | Past | Yulduzcha reyting + izoh |
| `account` | 274 | Past | Profil + parol o'zgartirish |
| `vip_customers` / `general_customers` | ~120 | Past | Mijoz qidiruv (muddat qoidalari) |
| `queue` / `misc` | ~130 | Past | Stub/joy-band ekranlar |

`shared/` (4 610 qator) — qayta ishlatiladigan widget'lar (tugma, input, karta, panel).
`core/` (1 370 qator) — auth, routing, network, storage, offline, push.
`l10n/` (~1 300 qator, 900+ kalit) — uz/ru/en tarjimalar.

**Eng murakkab yakka fayl:** `kirim_form_screen.dart` (2 475 qator) — Kotlin'da albatta bir nechta kichik composable/ViewModel'ga bo'linishi kerak.

---

## 3. Bosqichlar (roadmap)

### Bosqich 0 — Poydevor (fondament)
**Maqsad:** butun zanjirni (login → backend → token → navigatsiya) uchidan-uchiga tekshirish.
- Yangi Android loyiha skeleti (Gradle, package nomi, Hilt graf)
- Tarmoq qatlami: Retrofit + OkHttp + auth interceptor (token, 401 handling — `app_dio.dart` naqshini ko'chirish)
- DataStore (token/sozlamalar)
- Room sxemasi (offline kesh uchun, sqflite'ga mos)
- Firebase: yangi Android app ro'yxatdan o'tkazish (push uchun)
- Login ekrani + auth oqimi (birinchi to'liq vertikal kesim)
- Internal testing uchun keystore/CI (Play Store tajribasidan foydalanamiz)

### Bosqich 1 — Picker asosiy oqimi (ENG YUQORI USTUVORLIK)
Kundalik eng ko'p ishlatiladigan qism — xodimlar birinchi shu bilan ishlaydi.
- Picker home/dashboard
- Pick tasks ro'yxati + detail
- Qo'lda qator terish (`picker_work_screen` ekvivalenti)
- Konsolidlashtirilgan terish (hybrid box/loose) — **eng murakkab mantiq, ehtiyotkorlik bilan ko'chiriladi**
- Qaytarish sessiyasi (return items)
- Barcode skaner (CameraX + ML Kit) + signal tovushi
- Offline navbat + sinxronizatsiya (WorkManager): PICK_SCAN, PICK_CONFIRM_ITEM, PICK_CLOSE_TASK

### Bosqich 2 — Inventarizatsiya + Ko'chirishlar
- Inventarizatsiya qidiruv/detail/barcode-resolve
- Movement ekrani (mahsulot/pallet ko'chirish)
- Product boxes (box barcode qidiruv/ro'yxatga olish/joylashtirish/olib tashlash)

### Bosqich 3 — Kirim (receiving) — IKKINCHI ENG YUQORI USTUVORLIK
- Kirim hub
- Kirim-new (joy bo'yicha / mahsulot bo'yicha)
- Kirim form (2475 qatorli — modulларга bo'lib ko'chiriladi)
- Box/loose hybrid + FEFO mantig'ini ko'chirish

### Bosqich 4 — Controller / Mijoz qaytarishlari
- Customer returns navbat + detail + tekshirish oqimi

### Bosqich 5 — Yordamchi funksiyalar
- Notifications ekrani (FCM + lokal ro'yxat)
- Account/profil/parol
- VIP customers, general customers qidiruv
- Feedback/reyting

### Bosqich 6 — i18n + sayqal + QA
- ~900 tarjima kalitini Android `strings.xml`ga ko'chirish (uz/ru/en) — ARB fayllardan skript bilan konvertatsiya qilish mumkin
- Haqiqiy backend bilan to'liq regressiya testi
- Offline chekka holatlar (edge case) testi

### Bosqich 7 — Tarqatish (rollout)
- Internal testing track (yangi Play Console yozuvi — package boshqa bo'lgani uchun alohida ilova bo'ladi)
- Flutter bilan parallel ishlash, picker fikr-mulohazasini yig'ish
- Bosqichma-bosqich cutover: avval testerlar, keyin barcha ombor xodimlari
- Kotlin tenglikka va barqarorlikka yetgach, Flutter uchun "sunset" sanasi belgilash

---

## 4. Xavflar va e'tibor talab qiladigan joylar

- **Ikki kodbaza parallel davri.** O'tish davrida har bir muhim bug-fix ikkala tomonda ham qilinishi kerak bo'lishi mumkin.
- **Offline sync semantikasi.** Backend idempotency format (`sync-${queueId}-${timestamp}`) aniq takrorlanishi shart — `idempotency_key.py` modelini backend'da tekshirib chiqish kerak.
- **Firebase qayta sozlash.** Yangi package = yangi Firebase Android app (jarayon Play Store sozlashda bir marta bajarilgan, takrorlash oson).
- **Barcode skanerlash sifati.** CameraX+ML Kit va mobile_scanner boshqacha ishlashi mumkin — ombordagi haqiqiy shtrix-kod yorliqlarida sinov o'tkazish shart.
- **Jamoa hajmi.** Reja bitta to'liq band dasturchi taxminiga asoslangan; qism vaqtli ishlasa muddatlar mos ravishda uzayadi.

---

## 5. Keyingi qadam

Bosqich 0'dan boshlash tavsiya etiladi: yangi loyiha skeleti + login ekrani — bu butun arxitekturani (backend auth, token saqlash, navigatsiya) kichik va tezkor tarzda tasdiqlaydi, keyingi katta bosqichlarga (picking, kirim) ishonch bilan o'tish imkonini beradi.
