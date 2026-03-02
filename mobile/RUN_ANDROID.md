# Run React Native Android — Windows PowerShell

Use this when **ANDROID_HOME** is set and **emulator** or device is connected (`adb devices` shows a device).

---

## 1. Environment (one-time)

### JAVA_HOME (required for Gradle)

Android Studio ships with a JDK. Set **JAVA_HOME** to it:

**Option A — User environment (persistent)**  
1. Win + R → `sysdm.cpl` → **Advanced** → **Environment Variables**.  
2. Under **User variables** → **New**:  
   - Variable: `JAVA_HOME`  
   - Value: `C:\Program Files\Android\Android Studio\jbr`  
3. OK. **Restart terminal.**

**Option B — Current PowerShell session only:**
```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

**Verify:**
```powershell
& "$env:JAVA_HOME\bin\java.exe" -version
```
Expected: openjdk 17 or 21.

---

## 2. Quick check before run

```powershell
# Emulator or device
adb devices

# ANDROID_HOME (optional)
echo $env:ANDROID_HOME
```

---

## 3. Commands to run the app

**Terminal 1 — Metro (leave running):**
```powershell
cd C:\Users\hp\Desktop\WMS\mobile
npm start
```
Wait until you see “Welcome to Metro” and “Loading dependency graph done”.

**Terminal 2 — Build and run Android:**
```powershell
cd C:\Users\hp\Desktop\WMS\mobile
# If JAVA_HOME not set in system, set for this session:
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
npx react-native run-android
```

First run can take several minutes (Gradle download and build). When done, the app should open on the emulator.

---

## 4. If you see errors

| Error | Fix |
|-------|-----|
| `JAVA_HOME is not set` / `java not found` | Set JAVA_HOME to `C:\Program Files\Android\Android Studio\jbr` (see §1). |
| `SDK location not found` | Set ANDROID_HOME to your Android SDK path (e.g. `C:\Users\hp\AppData\Local\Android\Sdk`). |
| `adb: command not found` | Add `%ANDROID_HOME%\platform-tools` to Path. |
| `No connected devices` | Start emulator from Android Studio (Device Manager) or connect a device; run `adb devices`. |
| Gradle build fails (e.g. `Unsupported class file major version`) | Ensure JAVA_HOME points to JDK 17 (Android Studio\jbr). |
| Metro “Unable to resolve module” | In project folder run `npm install`, then `npm start` again. |
| App shows red error “Could not connect to development server” | Ensure Metro is running (Terminal 1); on emulator run `adb reverse tcp:8081 tcp:8081`. |

---

## 5. Success criteria

- **Metro:** Terminal 1 shows “Loading dependency graph done” and no errors when you open the app.  
- **App:** Emulator (or device) shows the React Native app screen (default welcome or your Scanner UI).  
- **Build:** `npx react-native run-android` finishes with “BUILD SUCCESSFUL” and installs/launches the app.
