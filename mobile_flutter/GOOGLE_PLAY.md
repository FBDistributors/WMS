# Google Play: FB Warehouse (Flutter)

## 1. Play Console (brauzerda — kod bilan bajarilmaydi)

- **Android developer verification** va akkaunt sozlamalarini tugating (banner yo‘qolguncha).
- **FB Warehouse** listing oching va **Application ID** (package name) ni tekshiring.
- Agar listingda boshqa package bo‘lsa, uni [`android/app/build.gradle.kts`](android/app/build.gradle.kts) dagi `applicationId` bilan bir xil qiling yoki Play’da yangi listing yarating.

Bu loyiha uchun standart ID: **`uz.fbwarehouse.app`**.

## 2. Firebase (`google-services.json`)

Package o‘zgarganda Firebase Console → loyiha **fb-warehouse-76a0c** → **Add app** → Android → package **`uz.fbwarehouse.app`** → yangi `google-services.json` ni yuklab, [`android/app/google-services.json`](android/app/google-services.json) bilan almashtiring.

Eski `com.example.mobile_flutter` clienti bilan yangi package ishlamaydi.

## 3. Release imzo

1. Kalit yarating (bir marta): [Flutter Android signing](https://docs.flutter.dev/deployment/android#sign-the-app).
2. `android/key.properties.example` ni `android/key.properties` qilib nusxalang va `storeFile` ni o‘z `.jks` yo‘lingizga moslang.
3. `android/upload-keystore.jks` (yoki siz tanlagan nom) repoga **kiritilmaydi** (`.gitignore`).

`key.properties` bo‘lmasa, release build **debug** imzo bilan yig‘iladi — **Play qabul qilmaydi**.

## 4. App Bundle

```bash
cd mobile_flutter
flutter pub get
flutter build appbundle --release
```

Natija: `build/app/outputs/bundle/release/app-release.aab` — Play’da **App bundles** orqali yuklanadi.

Har yangi yuklashda `pubspec.yaml` ichidagi `version: x.y.z+build` da **build** raqamini oshiring.
