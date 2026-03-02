# Black screen diagnosis — step-by-step

## Step 1: Minimal render test (DONE)

**Change applied:** `App.tsx` was replaced with a minimal component that only shows "Hello WMS".

**What you do:**
1. In the terminal where Metro is running, press **`r`** to reload (or shake device → Reload).
2. **Expected:** If you see **"Hello WMS"** on the emulator → RN render and Metro connection are OK; the black screen was caused by the camera/scanner screen. Go to **Step 4** (restore full app with camera fixes).
3. **If still black** → Go to Step 2.

---

## Step 2: Metro / bundle connectivity

**Commands (run from `C:\Users\hp\Desktop\WMS\mobile` in PowerShell):**

**2.1 — Kill anything on port 8081 (if Metro won’t start or port is busy):**
```powershell
netstat -ano | findstr :8081
```
Note the **PID** (last column). Then:
```powershell
taskkill /F /PID <PID>
```
(Replace `<PID>` with the number, e.g. `taskkill /F /PID 12345`.)

**2.2 — Start Metro with clean cache:**
```powershell
cd C:\Users\hp\Desktop\WMS\mobile
npx react-native start --reset-cache
```
Wait until you see "Loading dependency graph done" (or "Welcome to Metro").

**2.3 — Check packager from emulator:**
On the **emulator**, open the **Browser** app and go to:
```
http://10.0.2.2:8081/status
```
**Expected:** `packager-status:running` (or similar). If you see that, Metro is reachable from the emulator.

**2.4 — Rebuild and run app:**
In a **second terminal**:
```powershell
cd C:\Users\hp\Desktop\WMS\mobile
npx react-native run-android
```
Then in Metro terminal press **`r`** to reload. Check again if the screen is still black.

---

## Step 3: Check for app crash (Logcat)

If the screen is **still black** after Steps 1 and 2:

**3.1 — Show only errors:**
```powershell
adb logcat *:E
```
Reproduce the black screen (open app / reload), then stop with Ctrl+C.

**3.2 — Or full log (filter by app tag if needed):**
```powershell
adb logcat
```
Look for lines containing `com.mobile`, `ReactNative`, `AndroidRuntime`, or `FATAL`.

**What to look for:** A line like `FATAL EXCEPTION` or `Error:` with a stack trace. Note the **exact error message** and the **file/component** (e.g. `ScannerScreen`, `Camera`, `useCodeScanner`). Fix that crash and run again.

---

## Step 4: When "Hello WMS" works — camera screen

When the minimal app shows "Hello WMS", the black screen comes from the **camera/scanner** screen. Restore the full app (ScannerScreen) with these guarantees:

- **a)** Permission flow: `requestCameraPermission()` and a clear denied state (button + message). Already in place; ScannerScreen shows "Camera access is required" and "Allow Camera" / "Open Settings".
- **b)** AndroidManifest: `<uses-permission android:name="android.permission.CAMERA" />` is present.
- **c)** Camera is rendered **only** when permission is **granted** (`permStatus === 'granted'`).
- **d)** A **visible overlay text** is shown when the camera screen is active so you can see that the screen is rendering even if the preview is black (e.g. on emulator).

**To restore full app:** Replace the minimal `App.tsx` with the content below. The updated `ScannerScreen` already includes permission UI and a persistent "Scanner active" overlay.

**Exact `App.tsx` to restore (full app with ScannerScreen):**
```tsx
/**
 * WMS Mobile — barcode scanner app (React Native, Android-first).
 */
import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { ScannerScreen } from './src/screens/ScannerScreen';

function App(): React.JSX.Element {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#111" />
      <ScannerScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
});

export default App;
```
Then in Metro press **`r`** to reload. You should see either the permission screen or the camera screen with the "Scanner active" overlay (preview may still be black on emulator).

**Emulator note:** Camera preview is often black on emulator; on a **real device** the preview and barcode scan should work.

---

## Step 5: Success criteria

- [ ] **Minimal test:** "Hello WMS" renders on emulator after reload.
- [ ] **Metro:** `http://10.0.2.2:8081/status` shows packager running; Metro runs without errors.
- [ ] **Camera screen:** Permission UI appears when not granted; when granted, camera screen renders with visible overlay text (even if preview is black on emulator).
- [ ] **Real device:** Camera preview works and barcode scan can be tested.
