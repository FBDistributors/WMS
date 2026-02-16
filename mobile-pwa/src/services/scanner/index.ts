/**
 * Unified scanner service.
 * - Native (Capacitor Android/iOS): ML Kit barcode scanning
 * - Web: use CameraScanner component (ZXing + html5-qrcode fallback)
 */

import { Capacitor } from '@capacitor/core'
import * as nativeMlkit from './nativeMlkitScanner'

export type ScanResult = { code: string; format?: string }

/** Whether app runs as native (Capacitor Android/iOS) */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform()
}

/** Single barcode scan. On native: ML Kit scan(). On web: returns null (use CameraScanner). */
export async function scanOnce(): Promise<ScanResult | null> {
  if (Capacitor.isNativePlatform()) {
    return nativeMlkit.scanOnce()
  }
  return null
}

/** Request camera permission (native only) */
export async function requestCameraPermission(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    return nativeMlkit.requestCameraPermission()
  }
  return true
}
