/**
 * Offline cache for barcode -> inventory lookup.
 * TTL: 20 minutes. Uses localStorage.
 */
const CACHE_PREFIX = 'wms_barcode_'
const TTL_MS = 20 * 60 * 1000

type CachedInventory = {
  product_id: string
  name: string
  barcode: string | null
  best_locations: { location_code: string; available_qty: number }[]
  fefo_lots: { batch_no: string; expiry_date: string | null; available_qty: number }[]
  total_available: number
  timestamp: number
}

function cacheKey(barcode: string): string {
  return CACHE_PREFIX + barcode
}

export function setBarcodeCache(
  barcode: string,
  data: Omit<CachedInventory, 'timestamp'>
): void {
  try {
    const payload: CachedInventory = { ...data, timestamp: Date.now() }
    localStorage.setItem(cacheKey(barcode), JSON.stringify(payload))
  } catch {
    // ignore
  }
}

export function getBarcodeCache(barcode: string): Omit<CachedInventory, 'timestamp'> | null {
  try {
    const raw = localStorage.getItem(cacheKey(barcode))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedInventory
    const age = Date.now() - parsed.timestamp
    if (age > TTL_MS) return null
    const { timestamp, ...rest } = parsed
    return rest
  } catch {
    return null
  }
}
