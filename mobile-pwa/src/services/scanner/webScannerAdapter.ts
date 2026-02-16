/**
 * Web scanner adapter - returns null for scanOnce() on web.
 * Web flow uses CameraScanner component with ZXing/html5-qrcode.
 */

export type WebScanResult = { code: string } | null

/** Web does not support native scanOnce - use CameraScanner component instead */
export async function webScanOnce(): Promise<WebScanResult> {
  return null
}
