# WMS Mobile — Test Plan (Real Device)

Use this checklist on a **physical Android device** for reliable camera and network behavior.

---

## 1. Camera permission

| # | Scenario | Steps | Expected |
|---|----------|--------|----------|
| 1.1 | First launch | Install app, open. | App shows “Camera access is required” and an “Allow Camera” (or “Open Settings”) button. |
| 1.2 | Grant permission | Tap “Allow Camera”. | System permission dialog appears. Tap “Allow”. Camera preview appears. |
| 1.3 | Denied once | Force close, clear app data, reopen. Deny when prompted. | App shows message that camera is required and offers “Open Settings”. |
| 1.4 | Permanently denied | After denying, go to system Settings → App → WMS Mobile → Permissions. Turn Camera OFF. Reopen app. | App shows “Open Settings” (no permission dialog). Tapping it opens app Settings. After enabling Camera and returning, camera works. |

---

## 2. Barcode scanning

| # | Scenario | Steps | Expected |
|---|----------|--------|----------|
| 2.1 | EAN-13 | Point camera at an EAN-13 barcode (e.g. product package). | Within 1–2 s, same code is not scanned again (debounce ~1.5 s). One scan triggers “Looking up product…”. |
| 2.2 | Code 128 / QR | Scan a Code 128 or QR code that encodes a barcode value your backend knows. | Same as 2.1: single lookup, debounce works. |
| 2.3 | Debounce | Scan the same barcode twice in a row quickly (< 1.5 s). | Only one API call and one result. Second scan within the window is ignored. |
| 2.4 | Scan again | After a result, tap “Scan another”. | Camera active again, last result cleared. Can scan a new barcode. |

---

## 3. API and product card

| # | Scenario | Steps | Expected |
|---|----------|--------|----------|
| 3.1 | Known barcode | Ensure backend has a product for the barcode. Scan it. | “Looking up product…” then product card with name, SKU, barcode, brand (if any), and stock summary (on hand / available). |
| 3.2 | Unknown barcode | Scan a barcode that does not exist in the backend. | Error message (e.g. “Product not found” or backend error). “Scan again” clears and allows new scan. |
| 3.3 | Network off | Turn off Wi‑Fi and mobile data. Scan any barcode. | Error (e.g. network failed). “Scan again” works after turning network back on. |
| 3.4 | Wrong API URL | In `src/config/env.ts` set `DEV_API` to an invalid URL. Run app, scan. | Error (e.g. connection failed or 4xx/5xx). Restore correct URL and re-test 3.1. |

---

## 4. Stability

| # | Scenario | Steps | Expected |
|---|----------|--------|----------|
| 4.1 | Back to scanner | From product card tap “Scan another”. Scan 3–5 different barcodes in sequence. | No crash. Each scan shows loading then result or error. |
| 4.2 | App background | While camera is showing, press Home. Wait a few seconds. Reopen app. | App resumes; camera preview returns (or permission prompt if OS revoked). |
| 4.3 | Rotation | Rotate device (portrait ↔ landscape) on scanner and on product card. | Layout adapts; no crash. |

---

## Notes

- **Emulator:** Camera and barcode scanning are unreliable in the emulator. Prefer a real device for 2.x and 4.x.
- **Backend:** Ensure `GET /api/v1/products/by-barcode/{barcode}` is reachable from the device (same LAN as host or use prod URL). If the API requires auth, set token via `setAuthToken()` after adding login.
- **Debounce:** Default 1.5 s. Change `DEBOUNCE_MS` in `src/screens/ScannerScreen.tsx` if needed.
