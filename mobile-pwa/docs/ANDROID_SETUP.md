# FB WMS – Android App Setup

This document describes how to build and run the WMS PWA as a native Android app using Capacitor and ML Kit barcode scanning.

## Prerequisites

- Node.js 18+
- npm or pnpm
- Android Studio (Arctic Fox or newer)
- Java 17 (JDK 17)
- Android SDK (API 33+ recommended)
- Physical Android device or emulator

## Setup

### 1. Install dependencies

```bash
cd mobile-pwa
npm install
```

### 2. Build web assets

```bash
npm run build
```

### 3. Add Capacitor (if not already added)

Capacitor is already integrated. The Android project lives in `android/`.

### 4. Sync web assets to Android

```bash
npm run android:sync
```

This runs `npm run build` and `npx cap sync android`, copying the built web app into the Android project.

### 5. Open Android Studio

```bash
npm run android:open
```

Or open `mobile-pwa/android` in Android Studio.

### 6. Run on device

1. Connect an Android device via USB (enable USB debugging) or start an emulator.
2. In Android Studio: **Run** → **Run 'app'** (or Shift+F10).

## Native Barcode Scanner

The app uses **Google ML Kit** via `@capacitor-mlkit/barcode-scanning` for native barcode scanning on Android. This provides:

- Sharp image quality (no getUserMedia blur)
- Continuous autofocus
- Fast EAN-13 / EAN-8 / CODE_128 / QR_CODE recognition

### Flow

- **Native (default on Android)**: Tap the big "Scan" button → ML Kit opens → scan → result returned.
- **Web scanner**: Tap "Use web scanner" to fall back to the ZXing/html5-qrcode camera-based scanner.

### Permissions

- `CAMERA` permission is declared in `AndroidManifest.xml`.
- On first run, the app requests camera permission for the native scanner.

### Google Barcode Scanner module (Android)

On Android, ML Kit’s ready-to-use scanner uses the **Google Barcode Scanner module** (via Play Services). Most devices with Google Play Services have this preinstalled. If not, the plugin can prompt to install it.

## Release build

### Build APK (debug)

```bash
cd android
./gradlew assembleDebug
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`

### Build APK (release)

1. Create a keystore (one-time):
   ```bash
   keytool -genkey -v -keystore wms-release.keystore -alias wms -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Configure signing in `android/app/build.gradle` (or use `signingConfigs` in a `keystore.properties` file).

3. Build:
   ```bash
   cd android
   ./gradlew assembleRelease
   ```

### Build AAB (for Play Store)

```bash
cd android
./gradlew bundleRelease
```

AAB output: `android/app/build/outputs/bundle/release/app-release.aab`

## Scripts reference

| Script            | Description                                      |
|-------------------|--------------------------------------------------|
| `npm run build`   | Build web app (Vite) to `dist/`                  |
| `npm run android:sync` | Build + sync web assets to Android           |
| `npm run android:open` | Open Android project in Android Studio      |

## Troubleshooting

- **Camera permission denied**: Check app Settings → Permissions and ensure Camera is allowed.
- **Barcode scanner fails**: Try "Use web scanner" as fallback.
- **Sync issues**: Run `npm run build` then `npx cap sync android` manually.
- **Gradle errors**: In Android Studio, use **File → Sync Project with Gradle Files**.
