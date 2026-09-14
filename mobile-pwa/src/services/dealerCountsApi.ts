import { fetchJSON } from './apiClient'

// Diller ombor qoldig'i sanovi — WMS ledgeridan alohida hujjatlar (backend
// `/dealer-counts`). Admin panel faqat o'qiydi va Excel'ga chiqaradi; sanovni
// mobil ilova yaratadi.

export type DealerOut = {
  org_id: string
  name: string
}

export type DealerCountLineOut = {
  id: string
  product_id: string | null
  sku: string | null
  product_name: string | null
  scanned_barcode: string
  /** null — tayyor ro'yxatdagi hali sanalmagan qator. */
  qty: number | string | null
  /** Ro'yxat to'ldirilgandagi Smartup soni. */
  snapshot_qty: number | string | null
  expiry_date: string | null
  scanned_at: string | null
  /** Xodim haqiqatan sanagan payt; "0 deb hisobla" qatorlarida null. */
  counted_at: string | null
  seq: number
}

export type DealerCountOut = {
  id: string
  client_uuid: string
  dealer_org_id: string
  dealer_name: string | null
  counted_by_user_id: string
  counted_by_name: string | null
  status: DealerCountStatus
  source: 'mobile' | 'web' | 'sheet'
  started_at: string
  submitted_at: string | null
  note: string | null
  lines_count: number
  total_units: number | string
  /** Ro'yxatdagi jami qatorlar va haqiqatan sanalganlari ("45/693"). */
  sheet_lines: number
  counted_lines: number
  assigned_to_user_id: string | null
  assigned_to_name: string | null
  claimed_at: string | null
  uncounted_policy: 'zero' | 'keep' | null
  created_at: string
  warning?: string | null
  lines: DealerCountLineOut[]
}

export type DealerCountStatus = 'draft' | 'in_progress' | 'submitted'

export type DealerCountListOut = {
  items: DealerCountOut[]
  total: number
}

export type DealerCountListQuery = {
  dealer_org_id?: string
  /** Bitta yoki vergul bilan: `draft,in_progress`. */
  status?: string
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}

export async function getDealers() {
  return fetchJSON<DealerOut[]>('/api/v1/dealer-counts/dealers')
}

export async function listDealerCounts(query: DealerCountListQuery = {}) {
  const clean: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') clean[k] = v
  }
  return fetchJSON<DealerCountListOut>('/api/v1/dealer-counts', { query: clean })
}

export async function getDealerCount(id: string) {
  return fetchJSON<DealerCountOut>(`/api/v1/dealer-counts/${encodeURIComponent(id)}`)
}

// --- web'dan yaratish / tahrirlash (draft) ---

export type DealerCountLineIn = {
  product_id?: string
  scanned_barcode: string
  /** Yo'q — ro'yxat qatori (sanalmagan) saqlanadi. */
  qty?: number
  snapshot_qty?: number
  expiry_date?: string
}

export type DealerCountCreateIn = {
  client_uuid: string
  dealer_org_id: string
  note?: string
  lines: DealerCountLineIn[]
  submit?: boolean
  source?: 'mobile' | 'web' | 'sheet'
}

export async function createDealerCount(payload: DealerCountCreateIn) {
  return fetchJSON<DealerCountOut>('/api/v1/dealer-counts', { method: 'POST', body: payload })
}

export async function updateDealerCount(id: string, payload: { note?: string; lines: DealerCountLineIn[] }) {
  return fetchJSON<DealerCountOut>(`/api/v1/dealer-counts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: payload,
  })
}

/** `uncounted`: sanalmagan qatorlar — `zero` (0 deb yoziladi) yoki `keep` (bo'sh qoladi). */
export async function submitDealerCount(id: string, uncounted: 'zero' | 'keep' = 'zero') {
  return fetchJSON<DealerCountOut>(`/api/v1/dealer-counts/${encodeURIComponent(id)}/submit`, {
    method: 'POST',
    body: {},
    query: { uncounted },
  })
}

// --- tayyor ro'yxat (ведомость) ---

export type PrefillSource = 'smartup' | 'shipped' | 'all'

export type PrefillOut = {
  added: number
  skipped: number
  not_in_catalog: number
  sources: PrefillSource[]
  count: DealerCountOut
}

export async function prefillDealerCount(id: string, sources: PrefillSource[], months = 6) {
  return fetchJSON<PrefillOut>(`/api/v1/dealer-counts/${encodeURIComponent(id)}/prefill`, {
    method: 'POST',
    body: { sources, months },
  })
}

export async function releaseDealerCount(id: string) {
  return fetchJSON<DealerCountOut>(`/api/v1/dealer-counts/${encodeURIComponent(id)}/release`, {
    method: 'POST',
    body: {},
  })
}

export async function deleteDealerCount(id: string) {
  return fetchJSON<void>(`/api/v1/dealer-counts/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export type DealerCountCompareRow = {
  sku: string
  product_name: string | null
  counted: number
  smartup: number
  diff: number
  only_in: 'count' | 'smartup' | null
  /** Xodim haqiqatan sanaganmi (ro'yxatdagi sanalmagan qator 0 deb olinadi). */
  is_counted: boolean
}

export type DealerCountCompareOut = {
  dealer_org_id: string
  warehouse_code: string
  source: 'cache' | 'live'
  balance_date: string
  loaded_at: string
  unknown_lines: number
  uncounted_skus: number
  totals: {
    counted: number
    smartup: number
    diff: number
    only_in_count: number
    only_in_smartup: number
    rows: number
  }
  rows: DealerCountCompareRow[]
}

/** Sanov ↔ Smartup qoldig'i (diller filiali + ombor kodi). `refresh` — API'dan qayta. */
export async function compareDealerCount(id: string, refresh = false) {
  return fetchJSON<DealerCountCompareOut>(`/api/v1/dealer-counts/${encodeURIComponent(id)}/compare`, {
    query: refresh ? { refresh: 'true' } : undefined,
  })
}
