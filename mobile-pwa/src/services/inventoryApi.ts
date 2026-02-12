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

export async function getInventorySummary(query: InventorySummaryQuery = {}) {
  return fetchJSON<InventorySummaryRow[]>('/api/v1/inventory/summary', {
    query: {
      search: query.search,
      product_ids: query.product_ids?.join(','),
      only_available: query.only_available,
      low_stock_threshold: query.low_stock_threshold,
    },
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
