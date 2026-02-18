# Clean and rebuild (Windows)

RNGestureHandlerModule / "mobile has not been registered" xatolaridan keyin.

## 1. Android clean

```powershell
cd C:\Users\hp\Desktop\WMS\mobile\android
.\gradlew.bat clean
```

## 2. Metro ni to‘xtatib, cache tozalab ishga tushirish

Avvalgi Metro terminalida **Ctrl+C**, keyin:

```powershell
cd C:\Users\hp\Desktop\WMS\mobile
npx react-native start --reset-cache
```

"Loading dependency graph done" chiqguncha kuting (bu terminalni yopmang).

## 3. Ilovani build va ishga tushirish (yangi terminalda)

```powershell
cd C:\Users\hp\Desktop\WMS\mobile
npx react-native run-android
```

Emulyator yoki qurilma ulangan bo‘lishi kerak (`adb devices`).
