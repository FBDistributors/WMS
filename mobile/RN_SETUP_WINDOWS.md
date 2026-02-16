# React Native dev environment — Windows (2026-ready)

## 1. Node.js

**Check:**
```powershell
node -v   # expect v18.x or v20.x / v22.x (LTS)
npm -v    # expect 10.x
```

**Your result:** Node v22.12.0, npm 10.9.0 — OK.

**If missing:** Install Node.js **LTS** from https://nodejs.org/ (v22 or v20). Restart terminal after install.

---

## 2. React Native CLI (no global install)

Use **npx** so the correct CLI version runs per project. Do **not** run `npm install -g react-native-cli`.

**Check:**
```powershell
npx @react-native-community/cli@latest --version
```

**Create/run projects:**
```powershell
npx @react-native-community/cli@latest init <ProjectName> --pm npm
npx react-native run-android
```
Always use `npx`; no global `react-native` install.

---

## 3. Android development environment

**3.1 Set ANDROID_HOME**

SDK path (typical on Windows): `C:\Users\<You>\AppData\Local\Android\Sdk`.

**Option A — User environment (persistent):**

1. Win + R → `sysdm.cpl` → Enter.
2. **Advanced** → **Environment Variables**.
3. Under **User variables** → **New**:
   - Variable: `ANDROID_HOME`
   - Value: `C:\Users\hp\AppData\Local\Android\Sdk`
4. Edit **Path** → **New** → add:
   - `%ANDROID_HOME%\platform-tools`
   - `%ANDROID_HOME%\emulator`
5. OK to close all dialogs. **Restart terminal** (or Cursor).

**Option B — Current PowerShell session only:**
```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator"
```

**3.2 Verify:**
```powershell
# Should print the SDK path
echo $env:ANDROID_HOME

# Should show adb version
adb version

# List devices/emulators (start one from Android Studio if empty)
adb devices
```

**Your result:** ANDROID_HOME was unset and `adb` was not in PATH. After setting as above, `adb` and `adb devices` will work.

---

## 4. If something is missing

| Issue | Fix |
|-------|-----|
| Node missing | Install LTS from https://nodejs.org/; restart terminal. |
| ANDROID_HOME unset | Set as in §3.1; add `platform-tools` and `emulator` to Path. |
| `adb` not found | Same as above; ensure new terminal after changing env. |
| No device | Start an AVD from Android Studio (Device Manager) or connect a physical device with USB debugging. |
| `adb devices` empty | Start emulator first or connect device; run `adb devices` again. |

No global React Native or Expo CLI needed; use `npx` only.

---

## 5. Create new React Native project (TypeScript, Android-first)

From your repo root (e.g. `C:\Users\hp\Desktop\WMS`), run:

```powershell
npx @react-native-community/cli@latest init mobile --version 0.76.6 --skip-git-init --pm npm
```

- **`mobile`** — project folder name (creates `./mobile`).
- **`--version 0.76.6`** — pins a stable RN version (TypeScript is default from 0.71+).
- **`--skip-git-init`** — avoids nesting a new repo if you already have one.
- **`--pm npm`** — use npm.

**Then run on Android:**
```powershell
cd mobile
npm start
```
In a **second terminal** (with ANDROID_HOME set and emulator/device connected):
```powershell
cd mobile
npx react-native run-android
```

---

## Quick checklist

- [ ] `node -v` and `npm -v` OK  
- [ ] `ANDROID_HOME` set to SDK path  
- [ ] `%ANDROID_HOME%\platform-tools` in Path  
- [ ] `adb version` and `adb devices` work  
- [ ] Emulator running or device connected  
- [ ] Use `npx` for React Native (no global CLI)  
- [ ] Create app with command in §5  
