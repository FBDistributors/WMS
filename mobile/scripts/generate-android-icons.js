/**
 * Generates Android launcher icons from src/assets/logo.png
 * into all mipmap-* folders (ic_launcher.png and ic_launcher_round.png).
 * Run: node scripts/generate-android-icons.js
 */
const fs = require('fs');
const path = require('path');

const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const LOGO = path.join(ROOT, 'src', 'assets', 'logo.png');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

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

  const buffer = await sharp(LOGO)
    .resize(192, 192)
    .png()
    .toBuffer();

  for (const [folder, size] of Object.entries(SIZES)) {
    const dir = path.join(RES, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const resized = await sharp(buffer).resize(size, size).png().toBuffer();
    const squarePath = path.join(dir, 'ic_launcher.png');
    const roundPath = path.join(dir, 'ic_launcher_round.png');
    fs.writeFileSync(squarePath, resized);
    fs.writeFileSync(roundPath, resized);
    console.log('Written', size + 'px ->', folder);
  }
  console.log('Done. ic_launcher and ic_launcher_round updated in all mipmap-* folders.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
