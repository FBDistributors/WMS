# WMS Mobile — boshidan ishga tushirish (ro‘yxat)

Terminalni yopib, keyin hammasini noldan ishga tushirish uchun quyidagi qadamlarni **ketma-ket** bajarring.

---

## Oldindan tekshirish (bir marta)

- **ANDROID_HOME** — tizimda o‘rnatilgan bo‘lishi kerak (masalan: `C:\Users\hp\AppData\Local\Android\Sdk`).
- **JAVA_HOME** — Gradle uchun (masalan: `C:\Program Files\Android\Android Studio\jbr`).
- **Node.js** — o‘rnatilgan (`node -v`).

Agar ular bo‘lmasa, `RN_SETUP_WINDOWS.md` yoki `COMMANDS_WINDOWS.md` fayllariga qarang.

---

## 1-qadam: Emulyatorni ishga tushiring

**Yangi terminal** oching (PowerShell yoki Cursor Terminal) va bajaring:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
Start-Process -FilePath "$env:ANDROID_HOME\emulator\emulator.exe" -ArgumentList "-avd","Pixel_4a_API_VanillaIceCream" -WindowStyle Normal
```

Emulyator oynasi ochiladi. **30–60 soniya** kuting — to‘liq yuklansin (bosh ekran ko‘rinsin).

---

## 2-qadam: Metro bundlerni ishga tushiring

**Yana yangi terminal** oching (1-terminalni yopmang, emulyator ishlab turishi kerak). Bajaring:

```powershell
cd C:\Users\hp\Desktop\WMS\mobile
npx react-native start --reset-cache
```

**Kuting:** "Loading dependency graph done" yoki "Welcome to Metro" chiqguncha.  
**Bu terminalni yopmang** — Metro doim ishlab turishi kerak.

---

## 3-qadam: Ilovani build qilib emulyatorga o‘rnating va ishga tushiring

**Uchinchi yangi terminal** oching. Bajaring:

```powershell
cd C:\Users\hp\Desktop\WMS\mobile
npx react-native run-android
```

(Birinchi marta 5–15 daqiqa vaqt ketishi mumkin.)  
Oxirida **BUILD SUCCESSFUL** va "Starting the app on emulator-5554..." chiqadi. Ilova emulyatorda ochiladi.

---

## Natija

Emulyatorda **WMS Mobile** ilovasi ochiladi:

- **"WMS Mobile"** sarlavha
- **"Picker / Yig‘uvchi"** tugmasi — bosilsa terish (Picker) ekrani
- **"Skaner (barcode)"** tugmasi — bosilsa skaner ekrani

---

## Jismoniy telefon (USB kabel orqali)

Ilovani **telefonda** ko‘rish uchun:

1. **Telefonda:** Sozlamalar → Telefon haqida → Build raqami ni 7 marta bosing (Developer options ochiladi). Sozlamalar → Developer options → **USB debugging** yoqing.
2. Telefoni USB orqali ulang. Ekranda **"Allow USB debugging?"** chiqsa — **Allow** (va ixtiyoriy: "Always allow from this computer") tanlang.
3. **Kompyuterda:** Metro ishlab turishi kerak (2-qadam). Keyin bitta terminalda:
   ```powershell
   adb reverse tcp:8081 tcp:8081
   cd C:\Users\hp\Desktop\WMS\mobile
   npx react-native run-android
   ```
   `run-android` ilovani telefonga o‘rnatadi va ishga tushiradi. Birinchi marta build 5–15 daqiqa davom etishi mumkin.

Agar `adb devices` bo‘sh bo‘lsa — USB debugging yoqilganini va telefonda "Allow" bosilganini tekshiring; kerak bo‘lsa kabelni chiqarib qayta ulang.

---

## API (Render wms-api) va Metro muammolari

| Muammo | Nima qilish |
|--------|-------------|
| **Could not connect to development server** | Metro ishlayotganini tekshiring (`npx react-native start --reset-cache`). Telefonda: `adb reverse tcp:8081 tcp:8081`. |
| **API xatosi / 401 Unauthorized** | Login ekranida backend uchun foydalanuvchi bilan kirish (Render’dagi wms-api da user bo‘lishi kerak). |
| **API ga ulanmayapti (timeout)** | `src/config/env.ts` da PROD: `https://wms-api.onrender.com`. Telefon va kompyuter bir xil tarmoqda bo‘lsa, DEV da kompyuter IP manzilini ishlating. |
| **No apps connected** | Emulyator to‘liq yuklanganini tekshiring; `adb devices` da qurilma ko‘rinsin. Keyin `run-android` qayta ishga tushiring. |

---

## Muammo bo‘lsa

| Muammo | Nima qilish |
|--------|-------------|
| `adb` topilmayapti | ANDROID_HOME o‘rnating va Path ga `%ANDROID_HOME%\platform-tools` qo‘shing. |
| `No devices` / `adb devices` bo‘sh | Emulyator: to‘liq yuklanganini tekshiring. Telefon: USB debugging yoqilgan, "Allow USB debugging" da Allow bosing; kabelni qayta ulang. |
| `JAVA_HOME is not set` | JAVA_HOME = `C:\Program Files\Android\Android Studio\jbr` o‘rnating. |
| Metro 8081 band | `netstat -ano \| findstr :8081` → `taskkill /F /PID <PID>` → 2-qadamni qaytaring. |
| Qizil ekran / 500 xato | Metro ni to‘xtatib, 2-qadamni `--reset-cache` bilan qayta bajarib, 3-qadamda ilovani qayta run qiling. |

---

## Qisqa tartib

1. **Terminal 1:** Emulyatorni ishga tushirish (yuqoridagi Start-Process buyruq).
2. **Terminal 2:** `cd mobile` → `npx react-native start --reset-cache` (Metro, yopilmasin).
3. **Terminal 3:** `cd mobile` → `npx react-native run-android` (build + ilovani ochish).

Shu tartibda bajarilsa, natijani ko‘rishingiz kerak.
