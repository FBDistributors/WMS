/**
 * Native ML Kit barcode scanner via @capacitor-mlkit/barcode-scanning.
 * Used on Capacitor Android/iOS for sharp, fast scanning with continuous autofocus.
 */

import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning'
import { Capacitor } from '@capacitor/core'

export type NativeScanResult = { code: string; format?: string }

/** Check if native scanner is available (Capacitor native platform) */
export function isNativeScannerAvailable(): boolean {
  return Capacitor.isNativePlatform()
}

/** Request camera permission (required before scan on Android) */
export async function requestCameraPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const { camera } = await BarcodeScanner.requestPermissions()
    return camera === 'granted' || camera === 'limited'
  } catch {
    return false
  }
}

/** Check if Google Barcode Scanner module is available (Android only). Required for scan() on devices without Play Services. */
export async function isGoogleScannerModuleAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true
  try {
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
    return available
  } catch {
    return false
  }
}

/** Install Google Barcode Scanner module (Android). Call when isGoogleBarcodeScannerModuleAvailable() returns false. */
export async function installGoogleScannerModule(): Promise<boolean> {
  try {
    await BarcodeScanner.installGoogleBarcodeScannerModule()
    return true
  } catch {
    return false
  }
}

/** Single barcode scan using ML Kit ready-to-use UI. Returns first barcode rawValue. */
export async function scanOnce(): Promise<NativeScanResult | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const { supported } = await BarcodeScanner.isSupported()
    if (!supported) return null
    const perm = await requestCameraPermission()
    if (!perm) return null

    // On Android, check if Google Barcode Scanner module is available
    const googleAvailable = await isGoogleScannerModuleAvailable()
    if (!googleAvailable) {
      await installGoogleScannerModule()
      return null
    }

    const { barcodes } = await BarcodeScanner.scan({
      formats: [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.Code128, BarcodeFormat.QrCode],
      autoZoom: true,
    })
    const b = barcodes?.[0]
    if (!b?.rawValue && !b?.displayValue) return null
    return { code: (b.rawValue || b.displayValue || '').trim(), format: b.format }
  } catch (e) {
    console.warn('Native scan error:', e)
    return null
  }
}
