# FB Warehouse — Native Android (Kotlin)

Flutter (`mobile_flutter/`) ilovasini bosqichma-bosqich almashtirish uchun yangi native
Android ilova. To'liq reja: [`kotlin_migration_reja.md`](../kotlin_migration_reja.md).

Bu — **Bosqich 0 (poydevor)**: loyiha skeleti, tarmoq qatlami, auth oqimi (login →
`/auth/me` → chiqish). Backend o'zgarmagan — bir xil `https://api.fbwarehouse.uz/api/v1`.

## Texnologiyalar
- Kotlin + Jetpack Compose (Material3)
- Hilt (DI)
- Retrofit + OkHttp + kotlinx.serialization
- DataStore Preferences (token saqlash)
- Room (kelajakda offline kesh uchun ulangan, hali ishlatilmaydi)

## Ishga tushirish
1. Android Studio'da `mobile_kotlin/` papkasini oching (Open an existing project).
2. Gradle sync avtomatik boshlanadi (birinchi marta Gradle 8.14.3 va bog'liqliklarni
   yuklab oladi — internet kerak).
3. `app` konfiguratsiyasini tanlab ▶ Run bosing (emulyator yoki jismoniy qurilma).

Terminaldan build qilish uchun (Windows PowerShell):
```powershell
cd mobile_kotlin
./gradlew.bat :app:assembleDebug
```

## Muhim eslatmalar
- **Firebase/push hali sozlanmagan.** Bu Bosqich 5 (Notifications)da qo'shiladi —
  Firebase Console'da yangi Android app (`uz.fbwarehouse.native`) ro'yxatdan
  o'tkaziladi va `app/google-services.json` qo'yiladi (xuddi Play Store uchun Flutter
  ilovada qilinganidek).
- **Release imzolash hali yo'q.** Debug build bilan ishlaydi; release keystore
  keyingi bosqichlarda (tarqatishga tayyor bo'lganda) qo'shiladi.
- **Package nomi:** `uz.fbwarehouse.native` — Flutter ilovaning
  `uz.fbwarehouse.wms`idan ataylab farqli, chunki ikkalasi o'tish davrida parallel
  ishlaydi (bir xil qurilmaga ikkalasi ham o'rnatilishi mumkin).

## Keyingi bosqich
Bosqich 1 — Picker asosiy oqimi (pick tasks, terish, konsolidatsiya, offline
navbat). Tafsilotlar uchun `kotlin_migration_reja.md`ga qarang.
