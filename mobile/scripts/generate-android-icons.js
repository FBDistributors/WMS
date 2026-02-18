/**
 * Generates Android launcher icons from src/assets/logo.png
 * into all mipmap-* folders (ic_launcher.png and ic_launcher_round.png).
 * Logo is drawn smaller (72% of canvas) on white background so it fits nicely.
 * Run: node scripts/generate-android-icons.js
 */
const fs = require('fs');
const path = require('path');

const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const LOGO = path.join(ROOT, 'src', 'assets', 'logo.png');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

/** Logo size as fraction of icon canvas (0.72 = 72%, leaves padding) */
const LOGO_SCALE = 0.72;

const SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

async function main() {
  if (!fs.existsSync(LOGO)) {
    console.error('Logo not found:', LOGO);
    process.exit(1);
  }

  for (const [folder, size] of Object.entries(SIZES)) {
    const dir = path.join(RES, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const logoSize = Math.round(size * LOGO_SCALE);
    const offset = Math.round((size - logoSize) / 2);

    const logoBuf = await sharp(LOGO)
      .resize(logoSize, logoSize)
      .png()
      .toBuffer();

    const icon = await sharp({
      create: { width: size, height: size, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .composite([{ input: logoBuf, left: offset, top: offset }])
      .toBuffer();

    const squarePath = path.join(dir, 'ic_launcher.png');
    const roundPath = path.join(dir, 'ic_launcher_round.png');
    fs.writeFileSync(squarePath, icon);
    fs.writeFileSync(roundPath, icon);
    console.log('Written', size + 'px (logo ' + logoSize + 'px) ->', folder);
  }
  console.log('Done. ic_launcher and ic_launcher_round updated; logo at', Math.round(LOGO_SCALE * 100) + '% of canvas.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
