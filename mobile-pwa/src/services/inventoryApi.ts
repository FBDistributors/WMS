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
  reserved: number
  available: number
  location_id?: string | null
  location_code: string
  location_type?: string | null
  sector?: string | null
}

export type InventoryMovement = {
  id: string
  product_id: string
  product_code?: string | null
  product_name?: string | null
  lot_id: string
  batch?: string | null
  location_id: string
  location_code?: string | null
  qty_change: number
  movement_type: string
  reason_code?: string | null
  source_document_type?: string | null
  source_document_id?: string | null
  created_at: string
  created_by_user_id?: string | null
  created_by_username?: string | null
}

export type ReserveHistoryRow = {
  id: string
  movement_type: string
  qty_change: number
  created_at: string
  created_by_user_id?: string | null
  created_by_username?: string | null
  source_document_type?: string | null
  source_document_id?: string | null
  product_id: string
  product_code?: string | null
  product_name?: string | null
  location_id: string
  location_code?: string | null
  lot_id: string
  batch?: string | null
  order_id?: string | null
  order_number?: string | null
  doc_no?: string | null
}

export type ReserveHistoryResponse = {
  items: ReserveHistoryRow[]
  total: number
  limit: number
  offset: number
}

/** Net reserve per (product, order) for reserve-health table */
export type ReserveByOrderRow = {
  product_id: string
  product_code: string
  product_name: string
  order_id: string
  order_number?: string | null
  reserved_qty: number
  last_movement_at: string
  last_movement_by_user_id?: string | null
  last_movement_by_username?: string | null
}

export type ReserveByOrderResponse = {
  items: ReserveByOrderRow[]
}

export type ReserveStuckSampleRow = {
  product_id: string
  product_code: string
  product_name: string
  order_id: string
  order_number?: string | null
  reserved_qty: number
  last_movement_at: string
  age_hours: number
  last_movement_by_user_id?: string | null
  last_movement_by_username?: string | null
}

export type ReserveStuckSummaryResponse = {
  warehouse: WarehouseFilter
  age_hours: number
  stuck_orders_count: number
  stuck_products_count: number
  stuck_rows_count: number
  oldest_hours: number
  sample: ReserveStuckSampleRow[]
}

export type ReserveByOrderQuery = {
  warehouse?: WarehouseFilter
  search?: string
}

export async function getReserveByOrder(query: ReserveByOrderQuery = {}, signal?: AbortSignal) {
  return fetchJSON<ReserveByOrderResponse>('/api/v1/inventory/reserve-by-order', {
    query: {
      warehouse: query.warehouse,
      search: query.search,
    },
    signal,
  })
}

export type ReserveStuckSummaryQuery = {
  warehouse?: WarehouseFilter
  age_hours?: number
  sample_limit?: number
}

export async function getReserveStuckSummary(
  query: ReserveStuckSummaryQuery = {},
  signal?: AbortSignal,
) {
  return fetchJSON<ReserveStuckSummaryResponse>('/api/v1/inventory/reserve-stuck-summary', {
    query: {
      warehouse: query.warehouse,
      age_hours: query.age_hours ?? 48,
      sample_limit: query.sample_limit ?? 5,
    },
    signal,
  })
}

export type WarehouseFilter = 'main' | 'showroom'

export type InventorySummaryQuery = {
  search?: string
  product_ids?: string[]
  only_available?: boolean
  low_stock_threshold?: number
  warehouse?: WarehouseFilter
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
      warehouse: query.warehouse,
    },
    signal,
  })
}

export type InventoryDetailsQuery = {
  product_id?: string
  location_id?: string
  expiry_before?: string
  show_zero?: boolean
  warehouse?: WarehouseFilter
}

export async function getInventoryDetails(query: InventoryDetailsQuery = {}) {
  return fetchJSON<InventoryDetailRow[]>('/api/v1/inventory/details', {
    query: {
      product_id: query.product_id,
      location_id: query.location_id,
      expiry_before: query.expiry_before,
      show_zero: query.show_zero,
      warehouse: query.warehouse,
    },
  })
}

export type InventorySummaryByLocationQuery = {
  search?: string
  product_ids?: string[]
  only_available?: boolean
  /** Include Smartup products with zero stock (barcha mahsulotlar, qoldiq kiritish uchun) */
  include_all_products?: boolean
  warehouse?: WarehouseFilter
}

export async function getInventorySummaryByLocation(query: InventorySummaryByLocationQuery = {}) {
  return fetchJSON<InventorySummaryWithLocationRow[]>('/api/v1/inventory/summary-by-location', {
    query: {
      search: query.search,
      product_ids: query.product_ids?.join(','),
      only_available: query.only_available,
      include_all_products: query.include_all_products,
      warehouse: query.warehouse,
    },
  })
}

/** Lightweight paginated summary - fast initial load */
export type InventorySummaryLightQuery = {
  search?: string
  brand_ids?: string[]
  only_available?: boolean
  include_locations?: boolean
  limit?: number
  offset?: number
  /** main | showroom — separate balance (showroom not added to main) */
  warehouse?: WarehouseFilter
}

export type InventorySummaryLightResponse = {
  items: InventorySummaryLightRow[]
  total: number
  limit: number
  offset: number
}

export type NegativeBalanceRow = {
  product_id: string
  sku?: string | null
  location_id: string
  location_code: string
  lot_id: string
  batch: string
  expiry_date?: string | null
  on_hand: number
  reserved: number
  available: number
}

export type NegativeBalanceCheckResponse = {
  total_rows: number
  rows: NegativeBalanceRow[]
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
  barcode?: string | null
  brand_id?: string | null
  brand_name?: string | null
  total_qty: number
  available_qty: number
  locations?: InventorySummaryLightLocation[] | null
}

export async function getInventorySummaryLight(query: InventorySummaryLightQuery = {}) {
  return fetchJSON<InventorySummaryLightResponse>('/api/v1/inventory/summary-light', {
    query: {
      search: query.search,
      brand_ids: query.brand_ids?.join(','),
      only_available: query.only_available ?? true,
      include_locations: query.include_locations ?? true,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
      warehouse: query.warehouse,
    },
  })
}

/** Location breakdown for one product - load on row expand */
export type InventoryByProductRow = {
  location_code: string
  location_type?: string | null
  qty: number
  reserved_qty: number
  available_qty: number
  expiry_date?: string | null
}

export async function getInventoryByProduct(productId: string, warehouse?: WarehouseFilter) {
  return fetchJSON<InventoryByProductRow[]>(`/api/v1/inventory/by-product/${productId}`, {
    query: warehouse ? { warehouse } : {},
  })
}

export type NegativeBalanceCheckQuery = {
  product_id?: string
  warehouse?: WarehouseFilter
  limit?: number
}

export async function getNegativeBalanceCheck(query: NegativeBalanceCheckQuery = {}) {
  return fetchJSON<NegativeBalanceCheckResponse>('/api/v1/inventory/negative-balance-check', {
    query: {
      product_id: query.product_id,
      warehouse: query.warehouse,
      limit: query.limit ?? 200,
    },
  })
}

/** Inventory at a single location (for location detail page): product code, barcode, brand, expiry, qty */
export type InventoryByLocationRow = {
  product_id: string
  product_code: string
  product_name: string
  barcode?: string | null
  brand?: string | null
  lot_id: string
  batch: string
  expiry_date?: string | null
  on_hand: number
  available: number
}

export async function getInventoryByLocation(locationId: string) {
  return fetchJSON<InventoryByLocationRow[]>(`/api/v1/inventory/by-location/${locationId}`)
}

export type InventoryMovementsQuery = {
  product_id?: string
  lot_id?: string
  location_id?: string
  movement_type?: string
  reason_code?: string
  scope?: 'warehouse_transfer'
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}

export type ReserveHistoryQuery = {
  search?: string
  movement_type?: string
  date_from?: string
  date_to?: string
  warehouse?: WarehouseFilter
  limit?: number
  offset?: number
}

export async function getInventoryMovements(query: InventoryMovementsQuery = {}) {
  return fetchJSON<InventoryMovement[]>('/api/v1/inventory/movements', {
    query,
  })
}

/** Joydan-joyga ko'chirish (juftlangan qatorlar). */
export type WarehouseTransfer = {
  id: string
  product_id: string
  product_code?: string | null
  product_name?: string | null
  lot_id: string
  batch?: string | null
  qty: number
  from_location_id: string
  from_location_code?: string | null
  to_location_id: string
  to_location_code?: string | null
  created_at: string
  created_by_user_id?: string | null
  created_by_username?: string | null
  movement_out_id: string
  movement_in_id: string
}

export type WarehouseTransfersQuery = {
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}

export async function getWarehouseTransfers(query: WarehouseTransfersQuery = {}) {
  return fetchJSON<WarehouseTransfer[]>('/api/v1/inventory/movements/warehouse-transfers', {
    query,
  })
}

export async function getReserveHistory(query: ReserveHistoryQuery = {}) {
  return fetchJSON<ReserveHistoryResponse>('/api/v1/inventory/reserve-history', {
    query: {
      search: query.search,
      movement_type: query.movement_type,
      date_from: query.date_from,
      date_to: query.date_to,
      warehouse: query.warehouse,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    },
  })
}

export type StockLot = {
  id: string
  product_id: string
  batch: string
  expiry_date?: string | null
  created_at?: string
}

export async function listStockLots(productId?: string) {
  return fetchJSON<StockLot[]>('/api/v1/inventory/lots', {
    query: productId ? { product_id: productId } : undefined,
  })
}

export type CreateMovementPayload = {
  product_id: string
  lot_id: string
  location_id: string
  qty_change: number
  movement_type: 'adjust'
  reason_code?: string
}

export async function createMovement(payload: CreateMovementPayload) {
  return fetchJSON<InventoryMovement>('/api/v1/inventory/movements', {
    method: 'POST',
    body: payload,
  })
}

export type BrandZeroStockResponse = {
  brand_id: string
  products_affected: number
  lots_affected: number
  stock_movements_created: number
  reserve_movements_created: number
  reserve_lots_affected: number
  movements_created: number
  skipped: number
}

export type BrandZeroMode = 'brand_only' | 'reserve_only' | 'brand_and_reserve'

export type MainZeroStockResponse = {
  warehouse: 'main'
  mode: BrandZeroMode
  products_affected: number
  lots_affected: number
  stock_movements_created: number
  reserve_movements_created: number
  reserve_lots_affected: number
  movements_created: number
  skipped: number
}

export async function zeroBrandStock(
  brandId: string,
  mode: BrandZeroMode = 'brand_only',
  idempotencyKey?: string,
) {
  return fetchJSON<BrandZeroStockResponse>(`/api/v1/inventory/brands/${brandId}/zero-stock`, {
    method: 'POST',
    query: { mode },
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  })
}

export async function zeroMainStock(
  mode: BrandZeroMode = 'brand_and_reserve',
  idempotencyKey?: string,
) {
  return fetchJSON<MainZeroStockResponse>('/api/v1/inventory/zero-stock/main', {
    method: 'POST',
    query: { mode },
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  })
}

export type ImportQtyLine = { code: string; qty: number }

export type ImportQtyPayload = {
  location_id: string
  lines: ImportQtyLine[]
  warehouse?: WarehouseFilter
}

export type ImportQtyErrorItem = { code: string; message: string }

export type ImportQtyResponse = {
  applied_rows: number
  skipped_rows: number
  errors: ImportQtyErrorItem[]
}

const IMPORT_QTY_MAX_LINES = 5000

/** Excel/CSV dan qatorlar — qoldiqka qo‘shish (backend SKU/barcode + miqdor). */
export async function importInventoryQty(payload: ImportQtyPayload) {
  if (payload.lines.length > IMPORT_QTY_MAX_LINES) {
    throw new Error(`Too many rows (max ${IMPORT_QTY_MAX_LINES})`)
  }
  return fetchJSON<ImportQtyResponse>('/api/v1/inventory/import-qty', {
    method: 'POST',
    body: {
      location_id: payload.location_id,
      lines: payload.lines,
      warehouse: payload.warehouse,
    },
  })
}

export { IMPORT_QTY_MAX_LINES }

export type ImportQtyRowLine = {
  code: string
  qty: number
  location_code: string
  /** ISO date YYYY-MM-DD; omit or undefined when no expiry */
  expiry_date?: string | null
  /** brands.id (UUID) yoki admin dagi brend kodi (masalan 006) — backend ikkalasini ham qabul qiladi */
  brand_id?: string | null
  /** Exceldan — faqat ko‘rinish; API ga yuborilmaydi */
  barcode?: string
  product_name?: string
  brand?: string
}

/** Har qatorda joy kodi + ixtiyoriy muddat (eksport «qoldiq muddati» shabloni). */
export async function importInventoryQtyRows(payload: {
  lines: ImportQtyRowLine[]
  warehouse?: WarehouseFilter
}) {
  if (payload.lines.length > IMPORT_QTY_MAX_LINES) {
    throw new Error(`Too many rows (max ${IMPORT_QTY_MAX_LINES})`)
  }
  return fetchJSON<ImportQtyResponse>('/api/v1/inventory/import-qty-rows', {
    method: 'POST',
    body: {
      warehouse: payload.warehouse,
      lines: payload.lines.map((l) => ({
        code: l.code,
        qty: l.qty,
        location_code: l.location_code,
        ...(l.expiry_date ? { expiry_date: l.expiry_date } : {}),
        ...(l.brand_id ? { brand_id: l.brand_id } : {}),
      })),
    },
  })
}

/** SmartUP balance$export — cache yoki refresh=1 da SmartUP dan yangilash. warehouse_code: 001 = qoldiq, 002 = bron. filial_id: header (all = barcha filiallar). */
export async function getSmartupBalance(options?: {
  signal?: AbortSignal
  refresh?: boolean
  warehouse_code?: string
  filial_id?: string | null
}) {
  const refresh = options?.refresh === true
  const warehouse_code = options?.warehouse_code?.trim() || '001'
  const query: Record<string, string> = { warehouse_code }
  if (refresh) query.refresh = '1'
  const fid = options?.filial_id?.trim()
  if (fid) query.filial_id = fid
  return fetchJSON<unknown>('/api/v1/inventory/smartup-balance', {
    signal: options?.signal,
    query,
  })
}
