/**
 * Android launcher ikoni – faqat web app (mobile-pwa) ishlatadigan ikon.
 * Web'dagi pwa-192x192.png dan resize qilinadi, boshqa o'zgarishsiz.
 * Boshqa joydagi logo/icon (login, header) o'zgarmaydi.
 * Run: node scripts/generate-android-icons.js
 */
const fs = require('fs');
const path = require('path');

const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
/** Web app PWA ikoni – launcher uchun aynan shu ishlatiladi */
const WEB_ICON = path.resolve(ROOT, '..', 'mobile-pwa', 'public', 'pwa-192x192.png');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

const SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

async function main() {
  if (!fs.existsSync(WEB_ICON)) {
    console.error('Web icon topilmadi:', WEB_ICON);
    console.error('mobile-pwa/public/pwa-192x192.png mavjud bo\'lishi kerak.');
    process.exit(1);
  }

  for (const [folder, size] of Object.entries(SIZES)) {
    const dir = path.join(RES, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const icon = await sharp(WEB_ICON)
      .resize(size, size)
      .png()
      .toBuffer();

    const squarePath = path.join(dir, 'ic_launcher.png');
    const roundPath = path.join(dir, 'ic_launcher_round.png');
    fs.writeFileSync(squarePath, icon);
    fs.writeFileSync(roundPath, icon);
    console.log('Written', size + 'px ->', folder);
  }
  console.log('Done. Launcher ikoni = web app ikoni (pwa-192x192.png).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
