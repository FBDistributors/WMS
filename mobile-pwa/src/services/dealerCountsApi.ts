import { fetchJSON } from './apiClient'

// Diller ombor qoldig'i sanovi — WMS ledgeridan alohida hujjatlar (backend
// `/dealer-counts`). Sanov shu yerda yaratiladi va tahrirlanadi, xodimlar telefonda
// skanerlab sanaydi; holat, qulf va "yuborish" yo'q.

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
  /** null — sanalmagan qator. */
  qty: number | string | null
  /** Ro'yxat to'ldirilgandagi Smartup soni. */
  snapshot_qty: number | string | null
  expiry_date: string | null
  /** Diller omboridagi joy (javon / zona). */
  location_code: string | null
  counted_at: string | null
  counted_by_name: string | null
  /** Kiritishlar soni va oxirgi jamidan beri ko'rinishi ("12 + 5") — qayta skanda qo'shilgan. */
  entries_count: number
  entries_brief: string | null
  seq: number
}

/** Qatorga bitta kiritish: set — jami yozildi, add — qo'shildi, clear — tozalandi. */
export type DealerCountEntryOut = {
  id: string
  kind: 'set' | 'add' | 'clear'
  qty: number | string | null
  user_name: string | null
  counted_at: string
}

/** Holatsiz sanov: web'da yaratiladi, telefonda sanaladi. `is_active` — dillerning faol sanovi. */
export type DealerCountOut = {
  id: string
  client_uuid: string
  dealer_org_id: string
  dealer_name: string | null
  created_by_user_id: string
  created_by_name: string | null
  is_active: boolean
  source: 'mobile' | 'web' | 'sheet'
  created_at: string
  note: string | null
  lines_count: number
  total_units: number | string
  /** Ro'yxatdagi jami qatorlar va haqiqatan sanalganlari ("45/693"). */
  sheet_lines: number
  counted_lines: number
  last_counted_at: string | null
  last_counted_by_name: string | null
  lines: DealerCountLineOut[]
}

export type DealerCountListOut = {
  items: DealerCountOut[]
  total: number
}

export type DealerCountListQuery = {
  dealer_org_id?: string
  /** true — faqat faol sanovlar. */
  active?: boolean
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}

export async function getDealers() {
  return fetchJSON<DealerOut[]>('/api/v1/dealer-counts/dealers')
}

export async function listDealerCounts(query: DealerCountListQuery = {}) {
  const clean: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') clean[k] = v
  }
  return fetchJSON<DealerCountListOut>('/api/v1/dealer-counts', { query: clean })
}

export async function getDealerCount(id: string) {
  return fetchJSON<DealerCountOut>(`/api/v1/dealer-counts/${encodeURIComponent(id)}`)
}

// --- web: yaratish va qator darajasidagi tahrir (telefon sanaganiga tegmaydi) ---

export type DealerCountLineIn = {
  product_id?: string
  scanned_barcode: string
  /** Yo'q — ro'yxat qatori (sanalmagan). */
  qty?: number
  snapshot_qty?: number
  expiry_date?: string
  location_code?: string
}

export type DealerCountCreateIn = {
  client_uuid: string
  dealer_org_id: string
  note?: string
  lines?: DealerCountLineIn[]
  /** Dillerda faol sanov bo'lsa — eskisini yopib yangisini yaratish. */
  replace?: boolean
  source?: 'web' | 'sheet'
}

export async function createDealerCount(payload: DealerCountCreateIn) {
  return fetchJSON<DealerCountOut>('/api/v1/dealer-counts', { method: 'POST', body: payload })
}

export async function addDealerCountLines(id: string, lines: DealerCountLineIn[]) {
  return fetchJSON<{ added: number; updated: number; count: DealerCountOut }>(
    `/api/v1/dealer-counts/${encodeURIComponent(id)}/lines`,
    { method: 'POST', body: { lines } },
  )
}

/** Faqat berilgan maydonlar o'zgaradi; `qty: null` — "sanalmagan"ga qaytarish. */
export type DealerCountLinePatch = {
  qty?: number | null
  expiry_date?: string | null
  location_code?: string | null
}

export async function patchDealerCountLine(id: string, lineId: string, patch: DealerCountLinePatch) {
  return fetchJSON<DealerCountOut>(
    `/api/v1/dealer-counts/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`,
    { method: 'PATCH', body: patch },
  )
}

export async function getDealerCountLineEntries(id: string, lineId: string) {
  return fetchJSON<DealerCountEntryOut[]>(
    `/api/v1/dealer-counts/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}/entries`,
  )
}

export async function deleteDealerCountLine(id: string, lineId: string) {
  return fetchJSON<DealerCountOut>(
    `/api/v1/dealer-counts/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`,
    { method: 'DELETE' },
  )
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
