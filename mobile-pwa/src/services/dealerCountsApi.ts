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
  qty: number | string
  expiry_date: string | null
  scanned_at: string | null
  seq: number
}

export type DealerCountOut = {
  id: string
  client_uuid: string
  dealer_org_id: string
  dealer_name: string | null
  counted_by_user_id: string
  counted_by_name: string | null
  status: 'draft' | 'submitted'
  started_at: string
  submitted_at: string | null
  note: string | null
  lines_count: number
  total_units: number | string
  created_at: string
  warning?: string | null
  lines: DealerCountLineOut[]
}

export type DealerCountListOut = {
  items: DealerCountOut[]
  total: number
}

export type DealerCountListQuery = {
  dealer_org_id?: string
  status?: 'draft' | 'submitted'
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

export type DealerCountCompareRow = {
  sku: string
  product_name: string | null
  counted: number
  smartup: number
  diff: number
  only_in: 'count' | 'smartup' | null
}

export type DealerCountCompareOut = {
  dealer_org_id: string
  warehouse_code: string
  source: 'cache' | 'live'
  balance_date: string
  loaded_at: string
  unknown_lines: number
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
