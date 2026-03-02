/**
 * Offline cache for picker inventory.
 * TTL: 20 minutes. Uses localStorage (IndexedDB can be added later).
 */
const CACHE_KEY = 'wms_picker_inventory_cache'
const TTL_MS = 20 * 60 * 1000 // 20 minutes

type CachedResponse = {
  data: unknown
  timestamp: number
}

export function setPickerInventoryCache(data: unknown): void {
  try {
    const payload: CachedResponse = { data, timestamp: Date.now() }
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
  } catch {
    // ignore
  }
}

export function getPickerInventoryCache(): { data: unknown; isStale: boolean } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedResponse
    const age = Date.now() - parsed.timestamp
    const isStale = age > TTL_MS
    return { data: parsed.data, isStale }
  } catch {
    return null
  }
}

export function clearPickerInventoryCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // ignore
  }
}
