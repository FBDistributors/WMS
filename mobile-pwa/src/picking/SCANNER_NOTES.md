# Barcode Scanner – Notes & Limitations

## Supported Environments

- **HTTPS required** – Camera API requires secure context
- **PWA** – Works in installed PWA on Android
- **Android Chrome** – Full support: torch, zoom, device switch, tap-to-focus
- **Desktop Chrome/Firefox** – Works with webcam

## Limitations

### iOS Safari

- **Torch** – Not supported (no MediaStreamTrack torch capability)
- **Zoom** – Often not available via `applyConstraints`
- **pointsOfInterest** – Limited or no support
- **focusMode: 'continuous'** – May be ignored
- **Workaround** – Use alternative scanner (html5-qrcode fallback) if primary fails

### General

- **Permission denied** – User must grant camera permission; some browsers block on HTTP
- **Multiple cameras** – Device list may be empty until permission is granted
- **Ultra-wide camera** – Filtered out when selecting back camera; main (1x) preferred

## Fallback

If @zxing/browser fails to start or decode, use "Try alternative scanner" to switch to **html5-qrcode**. It uses its own camera handling and can work where ZXing struggles.

## 1D Barcode Formats

Primary scanner (ZXing) is configured for:

- EAN_13
- EAN_8
- CODE_128
- CODE_39

QR codes are also supported by default.
