/**
 * Build qilingan APK ni backend/static/wms-app.apk ga nusxalaydi.
 * Web orqali yuklab olish yangi APK ni beradi.
 * Build dan keyin, commit/push dan oldin ishlating:
 *   cd mobile && node scripts/copy-apk-to-backend.js
 */
const fs = require('fs');
const path = require('path');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const APK_SOURCE = path.join(
  MOBILE_ROOT,
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'debug',
  'app-debug.apk'
);
const BACKEND_STATIC = path.join(MOBILE_ROOT, '..', 'backend', 'static');
const APK_DEST = path.join(BACKEND_STATIC, 'wms-app.apk');

if (!fs.existsSync(APK_SOURCE)) {
  console.error('APK topilmadi. Avval build qiling:');
  console.error('  cd mobile && npx react-native run-android');
  console.error('  yoki: cd mobile/android && ../gradlew assembleDebug');
  console.error('Manba:', APK_SOURCE);
  process.exit(1);
}

if (!fs.existsSync(BACKEND_STATIC)) {
  fs.mkdirSync(BACKEND_STATIC, { recursive: true });
}

fs.copyFileSync(APK_SOURCE, APK_DEST);
const stat = fs.statSync(APK_DEST);
const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
console.log('OK: APK nusxalandi ->', APK_DEST);
console.log('    O\'lcham:', sizeMB, 'MB');
console.log('    Endi backend/static/wms-app.apk ni commit qilib push qiling.');
