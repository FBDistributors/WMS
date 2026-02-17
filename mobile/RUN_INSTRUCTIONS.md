# WMS Mobile — Run instructions

## 1. Start Metro

```powershell
cd C:\Users\hp\Desktop\WMS\mobile
npx react-native start
```

Yoki cache tozalab:
```powershell
npx react-native start --reset-cache
```

**Metro 8081 band bo‘lsa (Windows):**
```powershell
netstat -ano | findstr :8081
taskkill /F /PID <PID>
```
Keyin `npx react-native start` qayta ishga tushiring.

---

## 2. Build and run Android

**Ikkinchi terminalda:**
```powershell
cd C:\Users\hp\Desktop\WMS\mobile
npx react-native run-android
```

Emulyator yoki qurilma ulangan bo‘lishi kerak (`adb devices`).

---

## Picker flow

- **Home** → "Picker / Yig‘uvchi" tugmasi → **Picker** ekrani (mock task).
- **Home** → "Skaner (barcode)" → **Scanner** ekrani.
- Picker da "← Ro‘yxat" yoki qurilma **Back** → orqaga.
