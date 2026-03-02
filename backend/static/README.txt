APK for web download: wms-app.apk (web "Mobile ilova" tugmasi shu faylni beradi).
Ishlatiladi: release APK — mobile/android/app/build/outputs/apk/release/app-release.apk

Yangi APK qo'yish (commit/push dan oldin):
  1. Release build: cd mobile/android && gradlew.bat assembleRelease
  2. Nusxalash:     cd mobile && npm run copy-apk
  3. Commit + push (backend/static/wms-app.apk yangilangan bo'ladi)

Yoki qo'lda: app-release.apk -> backend/static/wms-app.apk
APK_PATH env orqali boshqa fayl ham ko'rsatish mumkin.
