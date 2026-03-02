# WMS Mobile — Native Android Barcode Scanner

React Native (TypeScript) app, Android-first. Uses **react-native-vision-camera** for reliable barcode scanning (EAN-13, EAN-8, Code 128, QR). Calls WMS backend `GET /api/v1/products/by-barcode/{barcode}` and shows product card with stock summary.

## Prerequisites

- Node.js 18+
- npm
- **Android Studio** (with Android SDK, NDK, and a device/emulator)
- JDK 17
- Physical Android device or emulator (camera works best on real device)

## Environment / API URL

- **Dev:** API base URL is set in `src/config/env.ts`. Default for emulator: `http://10.0.2.2:8000` (host machine’s localhost).
- **Prod:** Change `PROD_API` in `src/config/env.ts` to your production API URL before release build.
- Optional: use build flavors or `react-native-config` later to switch URLs per build.

## Run in Android Studio / CLI

### 1. Install dependencies

```bash
cd mobile
npm install
```

### 2. Start Metro

```bash
npm start
```

### 3. Run on device/emulator

**Option A — CLI (device/emulator must be connected or running):**

```bash
npm run android
```

**Option B — Android Studio:**

1. Open Android Studio → **Open** → select the repo folder, then the **`mobile/android`** folder (so `android` is the project root).
2. Wait for Gradle sync.
3. Select a device/emulator from the toolbar.
4. Run (green play) or **Run → Run 'app'**.

First run may take several minutes (Gradle + native deps).

## Release build (APK)

1. **Signing (production):** Create a release keystore and set `android/app/build.gradle` `signingConfigs.release` (see [React Native signing](https://reactnative.dev/docs/signed-apk-android)). For a quick local release APK you can keep the debug signing used below.

2. **Build release APK:**

```bash
cd mobile/android
./gradlew assembleRelease
```

On Windows:

```bash
cd mobile\android
gradlew.bat assembleRelease
```

3. **Output:** `mobile/android/app/build/outputs/apk/release/app-release.apk`

4. **Install on device:** Copy the APK to the device and open it, or use `adb install -r app/build/outputs/apk/release/app-release.apk` with device connected.

## Authentication (production)

The backend endpoint `GET /api/v1/products/by-barcode/{barcode}` requires permission `products:read` (authenticated user). To use the app against a protected API:

1. Add a login flow that returns a JWT (or use your existing auth).
2. After login, call `setAuthToken(token)` from `src/api/client.ts`.
3. All requests will then send `Authorization: Bearer <token>`.

## Project structure

```
mobile/
├── App.tsx                 # Entry, renders ScannerScreen
├── src/
│   ├── config/env.ts       # API base URL (dev/prod)
│   ├── api/
│   │   ├── client.ts      # Typed API client (getProductByBarcode)
│   │   └── types.ts       # ProductByBarcode type
│   ├── hooks/
│   │   ├── useCameraPermission.ts  # Camera permission + open Settings
│   │   └── useProductByBarcode.ts  # Fetch product by barcode
│   ├── screens/
│   │   └── ScannerScreen.tsx       # Camera, scan, debounce, product card
│   └── components/
│       └── ProductCard.tsx        # Name, SKU, barcode, brand, stock
├── android/                 # Native Android (Gradle, manifest, permissions)
└── TEST_PLAN.md            # Real-device test checklist
```

## Native setup (already done)

- **Android**
  - `AndroidManifest.xml`: `CAMERA`, `INTERNET`, camera hardware features.
  - `gradle.properties`: `VisionCamera_enableCodeScanner=true` for ML Kit barcode scanning.
- **iOS:** Not configured in this MVP (Android-first).

## Test plan

See **TEST_PLAN.md** for a real-device test checklist (camera permission, denied/permanently denied, scan debounce, API success/error, product card).
