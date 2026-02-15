import { fetchJSON } from './apiClient'

export type InventorySummaryRow = {
  product_id: string
  product_code: string
  name: string
  on_hand_total: number
  reserved_total: number
  available_total: number
  lots_count: number
  locations_count: number
}

export type InventoryDetailRow = {
  product_id: string
  lot_id: string
  batch: string
  expiry_date?: string | null
  location_id: string
  location_code: string
  location_type?: string | null
  sector?: string | null
  location_path: string
  on_hand: number
  reserved: number
  available: number
}

/** One row per (product, location) for inventory table with expandable location rows */
export type InventorySummaryWithLocationRow = {
  product_id: string
  product_code: string
  name: string
  brand?: string | null
  on_hand: number
  available: number
  location_id?: string | null
  location_code: string
  location_type?: string | null
  sector?: string | null
}

export type InventoryMovement = {
  id: string
  product_id: string
  lot_id: string
  location_id: string
  qty_change: number
  movement_type: string
  source_document_type?: string | null
  source_document_id?: string | null
  created_at: string
  created_by_user_id?: string | null
}

export type InventorySummaryQuery = {
  search?: string
  product_ids?: string[]
  only_available?: boolean
  low_stock_threshold?: number
}

export async function getInventorySummary(
  query: InventorySummaryQuery = {},
  signal?: AbortSignal
) {
  return fetchJSON<InventorySummaryRow[]>('/api/v1/inventory/summary', {
    query: {
      search: query.search,
      product_ids: query.product_ids?.join(','),
      only_available: query.only_available,
      low_stock_threshold: query.low_stock_threshold,
    },
    signal,
  })
}

export type InventoryDetailsQuery = {
  product_id?: string
  location_id?: string
  expiry_before?: string
  show_zero?: boolean
}

export async function getInventoryDetails(query: InventoryDetailsQuery = {}) {
  return fetchJSON<InventoryDetailRow[]>('/api/v1/inventory/details', {
    query,
  })
}

export type InventorySummaryByLocationQuery = {
  search?: string
  product_ids?: string[]
  only_available?: boolean
  /** Include Smartup products with zero stock (barcha mahsulotlar, qoldiq kiritish uchun) */
  include_all_products?: boolean
}

export async function getInventorySummaryByLocation(query: InventorySummaryByLocationQuery = {}) {
  return fetchJSON<InventorySummaryWithLocationRow[]>('/api/v1/inventory/summary-by-location', {
    query: {
      search: query.search,
      product_ids: query.product_ids?.join(','),
      only_available: query.only_available,
      include_all_products: query.include_all_products,
    },
  })
}

/** Lightweight paginated summary - fast initial load */
export type InventorySummaryLightQuery = {
  search?: string
  only_available?: boolean
  include_locations?: boolean
  limit?: number
  offset?: number
}

export type InventorySummaryLightResponse = {
  items: InventorySummaryLightRow[]
  total: number
  limit: number
  offset: number
}

export type InventorySummaryLightLocation = {
  location_code: string
  qty: number
  available_qty: number
  expiry_date?: string | null
}

export type InventorySummaryLightRow = {
  product_id: string
  product_name: string
  product_code: string
  brand_name?: string | null
  total_qty: number
  available_qty: number
  locations?: InventorySummaryLightLocation[] | null
}

export async function getInventorySummaryLight(query: InventorySummaryLightQuery = {}) {
  return fetchJSON<InventorySummaryLightResponse>('/api/v1/inventory/summary-light', {
    query: {
      search: query.search,
      only_available: query.only_available ?? true,
      include_locations: query.include_locations ?? true,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    },
  })
}

/** Location breakdown for one product - load on row expand */
export type InventoryByProductRow = {
  location_code: string
  location_type?: string | null
  qty: number
  available_qty: number
  expiry_date?: string | null
}

export async function getInventoryByProduct(productId: string) {
  return fetchJSON<InventoryByProductRow[]>(`/api/v1/inventory/by-product/${productId}`)
}

export type InventoryMovementsQuery = {
  product_id?: string
  lot_id?: string
  location_id?: string
  movement_type?: string
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}

export async function getInventoryMovements(query: InventoryMovementsQuery = {}) {
  return fetchJSON<InventoryMovement[]>('/api/v1/inventory/movements', {
    query,
  })
}
