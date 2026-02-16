# React Native Android — Exact commands (Windows PowerShell)

**Prerequisites:** Android Studio installed, emulator running (`adb devices` shows `emulator-5554 device`), ANDROID_HOME set.

---

## 1. One-time: set JAVA_HOME

Gradle needs Java. Use Android Studio’s bundled JDK:

**Permanent (recommended):**  
1. Win + R → `sysdm.cpl` → **Advanced** → **Environment Variables**.  
2. **User variables** → **New** → Variable: `JAVA_HOME`, Value: `C:\Program Files\Android\Android Studio\jbr`  
3. OK, then **restart your terminal** (or Cursor).

**This session only:**
```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

**Check:**
```powershell
& "$env:JAVA_HOME\bin\java.exe" -version
```
You should see OpenJDK 17 or 21.

---

## 2. Optional: verify environment

```powershell
adb devices
echo $env:ANDROID_HOME
```
- `adb devices` should list at least one device (e.g. `emulator-5554 device`).  
- ANDROID_HOME should be your SDK path (e.g. `C:\Users\hp\AppData\Local\Android\Sdk`).

---

## 3. Start Metro (Terminal 1 — leave open)

```powershell
cd C:\Users\hp\Desktop\WMS\mobile
npm start
```

Wait until you see something like:
- `Welcome to Metro`
- `Loading dependency graph done`

Leave this terminal open.

---

## 4. Build and run Android (Terminal 2)

If JAVA_HOME is not set in your system, set it in this session first:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
cd C:\Users\hp\Desktop\WMS\mobile
npx react-native run-android
```

If JAVA_HOME is already set (system or profile):

```powershell
cd C:\Users\hp\Desktop\WMS\mobile
npx react-native run-android
```

First run can take 5–10+ minutes (Gradle, NDK). When it finishes you should see:
- `BUILD SUCCESSFUL`
- `info Successfully launched the app on the emulator.` (or device)

The app should open on the emulator.

---

## 5. Success criteria

| Check | What to see |
|-------|-------------|
| **Metro** | Terminal 1: “Loading dependency graph done”, no red errors. |
| **Build** | Terminal 2: “BUILD SUCCESSFUL” and “Successfully launched the app”. |
| **App** | Emulator shows the app UI (e.g. Scanner or default React Native screen). |
| **No red screen** | If the app shows “Could not connect to development server”, ensure Metro (Terminal 1) is running. On emulator you can run: `adb reverse tcp:8081 tcp:8081` |

---

## 6. Common errors and fixes

| Error | Fix |
|-------|-----|
| `JAVA_HOME is not set` or `java: command not found` | Set JAVA_HOME to `C:\Program Files\Android\Android Studio\jbr` (§1). |
| `SDK location not found` | Set ANDROID_HOME (e.g. `C:\Users\hp\AppData\Local\Android\Sdk`). |
| `adb: command not found` | Add `%ANDROID_HOME%\platform-tools` to Path. |
| `No connected devices` | Start emulator in Android Studio (Device Manager) or connect a device; run `adb devices`. |
| Gradle “Unsupported class file major version” | Point JAVA_HOME to JDK 17/21 (Android Studio\jbr). |
| App red screen “Could not connect to development server” | Start Metro in Terminal 1; optionally run `adb reverse tcp:8081 tcp:8081`. |

---

## Project creation (reference)

The **mobile** project already exists at `C:\Users\hp\Desktop\WMS\mobile` (TypeScript, React Native 0.76.6).  

To create a **new** React Native TypeScript project elsewhere in the future:

```powershell
cd C:\Users\hp\Desktop\WMS
npx @react-native-community/cli@latest init mobile --version 0.76.6 --skip-git-init --pm npm
```
(Use a different folder name if `mobile` already exists.)
