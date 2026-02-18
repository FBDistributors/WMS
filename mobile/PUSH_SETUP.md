# Push bildirishnomalar (FCM)

Yig'uvchiga buyurtma yuborilganda ilovada push bildirishnoma chiqadi; bildirishnomaga bosganda shu buyurtma sahifasi ochiladi.

## O'rnatish

1. **Firebase loyihasi**  
   [Firebase Console](https://console.firebase.google.com) da loyiha yarating (yoki mavjudini tanlang).

2. **Android**  
   - Loyihaga Android ilova qo'shing (package name: `mobile/android/app/build.gradle` dagi `applicationId`).  
   - `google-services.json` ni yuklab, `mobile/android/app/google-services.json` ga qo'ying.  
   - `android/build.gradle` da `classpath 'com.google.gms:google-services:4.x.x'` borligini tekshiring.  
   - `android/app/build.gradle` oxirida `apply plugin: 'com.google.gms.google-services'` bo'lishi kerak.

3. **Paketlar**  
   ```bash
   cd mobile
   npm install @react-native-firebase/app @react-native-firebase/messaging
   npx pod-install   # faqat iOS uchun
   ```

4. **Backend**  
   Serverni `backend/PUSH_SETUP.md` (yoki backend doc) bo'yicha sozlang: `GOOGLE_APPLICATION_CREDENTIALS` (Firebase service account JSON).

## Ilovada

- **PickerHome** ochilganda FCM token backendga yuboriladi (`POST /picking/fcm-token`).  
- Bildirishnomaga bosilganda ilova ochiladi va **PickTaskDetails** (shu buyurtma) sahifasiga o'tadi.

Firebase o'rnatilmasa push o'chirilgan bo'ladi; ilova boshqa funksiyalari ishlashda davom etadi.
