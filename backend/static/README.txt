APK for web download: wms-app.apk (web "Mobile ilova" tugmasi shu faylni beradi).

Yangi APK qo'yish (commit/push dan oldin):
  1. Mobile build: cd mobile && npx react-native run-android (yoki gradlew assembleDebug)
  2. Nusxalash:     cd mobile && npm run copy-apk
  3. Commit + push (backend/static/wms-app.apk yangilangan bo'ladi)

Yoki qo'lda: mobile/android/app/build/outputs/apk/debug/app-debug.apk -> backend/static/wms-app.apk
APK_PATH env orqali boshqa fayl ham ko'rsatish mumkin.
