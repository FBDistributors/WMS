# Play Market uchun release imzolash (AAB)

AAB ni **release** rejimida imzolash uchun quyidagilarni qiling.

## 1. Release keystore yaratish (bir marta)

Terminalda (PowerShell yoki CMD):

```bash
cd android/app
keytool -genkeypair -v -storetype PKCS12 -keystore my-release-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

- So‘raladigan parol va ma’lumotlarni yozing (ism, tashkilot va h.k.) va **eslab qoling**.
- `my-release-key.keystore` va `my-key-alias` ni o‘zgartirsangiz, 2-qadamda ham shunday yozing.

## 2. keystore.properties yaratish

- `keystore.properties.example` faylini nusxalab `keystore.properties` deb saqlang.
- Ichini to‘ldiring (parollarni o‘zingiz qo‘ygan qiymatlar bilan):

```properties
storeFile=my-release-key.keystore
storePassword=PAROL_SIZ_KIRITGAN
keyAlias=my-key-alias
keyPassword=PAROL_SIZ_KIRITGAN
```

- **Muhim:** `keystore.properties` va `*.keystore` fayllarini git ga commit qilmaslik kerak (maxfiy).

## 3. AAB yig‘ish

```bash
cd android
.\gradlew.bat bundleRelease
```

Tayyor AAB: `android/app/build/outputs/bundle/release/app-release.aab`  
Bu faylni Play Console’ga yuklang — "signed in debug mode" xatosi ketadi.
