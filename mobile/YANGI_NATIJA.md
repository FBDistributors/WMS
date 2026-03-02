# Yangi natijani ko‘rish (Picker / Home ekranlari)

Emulyator "WMS OK" ko‘rsatsa — ilova eski bundle ishlatmoqda. Quyidagilarni ketma-ket bajarring.

---

## 1. Metro ishlayotganini tekshiring

**Bitta terminalda** (Cursor yoki PowerShell):

```powershell
cd C:\Users\hp\Desktop\WMS\mobile
npm start
```

"Loading dependency graph done" yoki "Welcome to Metro" chiqguncha **bu terminalni yopmang**. Metro ishlab turishi kerak.

---

## 2. Ilovani qayta yuklang (reload)

- **Variant A:** Metro ishlayotgan terminalda **`r`** bosing (reload). Emulyatordagi ilova yangi bundle ni Metro’dan oladi.
- **Variant B:** Emulyatorda ilovani **silkitib** (Ctrl+M yoki o‘ng tomondagi "..." → "Reload") **Reload** ni tanlang.

Shundan keyin "WMS Mobile" va "Picker / Yig‘uvchi", "Skaner (barcode)" tugmalari chiqishi kerak.

---

## 3. ADB xatosi bo‘lsa ("Unable to connect to adb daemon")

Port 5037 band yoki adb ishlamasa, avval adb’ni to‘g‘irlang:

```powershell
adb kill-server
adb start-server
adb devices
```

Keyin 1–2-qadamni takrorlang (Metro ishga tushiring, reload qiling).

---

## 4. Baribir eski ko‘rinsa — ilovani qayta o‘rnating

Metro **ishlab turgan** bo‘lsa, **ikkinchi terminalda**:

```powershell
cd C:\Users\hp\Desktop\WMS\mobile
npx react-native run-android
```

Build tugagach ilova ochiladi va Metro’dan yangi bundle yuklanadi. Keyin ekranda Home (Picker / Skaner tugmalari) ko‘rinishi kerak.
