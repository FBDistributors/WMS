/** Brauzerda oxirgi muvaffaqiyatli SmartUP balance yuklashini saqlash (qoldiq jadvali uchun). */

const STORAGE_KEY = 'wms_smartup_balance_cache_v1'

export type SmartupBalanceCacheEntry = {
  warehouse_code: string
  filial_id: string
  raw: unknown
  loaded_at: string
}

export type SmartupSummaryCachePayload = {
  q001: Record<string, number>
  q002: Record<string, number>
  loaded_at: string
}

type SmartupBalanceStore = {
  entries: SmartupBalanceCacheEntry[]
  summary?: SmartupSummaryCachePayload
}

function readStore(): SmartupBalanceStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { entries: [] }
    const parsed = JSON.parse(raw) as SmartupBalanceStore
    if (!parsed || typeof parsed !== 'object') return { entries: [] }
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      summary: parsed.summary,
    }
  } catch {
    return { entries: [] }
  }
}

function writeStore(store: SmartupBalanceStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // quota / private mode
  }
}

function mapToRecord(m: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of m) {
    out[k] = v
  }
  return out
}

function recordToMap(rec: Record<string, number> | undefined): Map<string, number> {
  const m = new Map<string, number>()
  if (!rec) return m
  for (const [k, v] of Object.entries(rec)) {
    if (!k) continue
    const n = Number(v)
    if (Number.isFinite(n)) m.set(k, n)
  }
  return m
}

export function cacheKeyForSmartup(warehouseCode: string, filialId?: string | null): string {
  const wh = (warehouseCode || '001').trim() || '001'
  const fid = (filialId ?? '').trim()
  return `${wh}|${fid}`
}

export function readSmartupBalanceRawCache(
  warehouseCode: string,
  filialId?: string | null,
): { raw: unknown; loadedAt: string } | null {
  const key = cacheKeyForSmartup(warehouseCode, filialId)
  const hit = readStore().entries.find(
    (e) => cacheKeyForSmartup(e.warehouse_code, e.filial_id) === key,
  )
  if (!hit?.loaded_at) return null
  return { raw: hit.raw, loadedAt: hit.loaded_at }
}

export function writeSmartupBalanceRawCache(
  warehouseCode: string,
  filialId: string | null | undefined,
  raw: unknown,
): string {
  const loadedAt = new Date().toISOString()
  const key = cacheKeyForSmartup(warehouseCode, filialId)
  const store = readStore()
  const entries = store.entries.filter(
    (e) => cacheKeyForSmartup(e.warehouse_code, e.filial_id) !== key,
  )
  entries.push({
    warehouse_code: (warehouseCode || '001').trim() || '001',
    filial_id: (filialId ?? '').trim(),
    raw,
    loaded_at: loadedAt,
  })
  writeStore({ ...store, entries })
  return loadedAt
}

export function readSmartupSummaryCache(): {
  q001: Map<string, number>
  q002: Map<string, number>
  loadedAt: string
} | null {
  const s = readStore().summary
  if (!s?.loaded_at) return null
  return {
    q001: recordToMap(s.q001),
    q002: recordToMap(s.q002),
    loadedAt: s.loaded_at,
  }
}

export function writeSmartupSummaryCache(
  q001: Map<string, number>,
  q002: Map<string, number>,
): string {
  const loadedAt = new Date().toISOString()
  const store = readStore()
  writeStore({
    ...store,
    summary: {
      q001: mapToRecord(q001),
      q002: mapToRecord(q002),
      loaded_at: loadedAt,
    },
  })
  return loadedAt
}

export function formatSmartupCacheTime(iso: string, locale: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
}
