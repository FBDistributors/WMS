import { fetchJSON } from './apiClient'

export type PickerLotInfo = {
  location_code: string
  batch_no: string
  expiry_date: string | null
  available_qty: number
  reserved_qty: number
}

export type PickerInventoryItem = {
  product_id: string
  name: string
  main_barcode: string | null
  best_location: string | null
  available_qty: number
  nearest_expiry: string | null
  top_locations: PickerLotInfo[]
}

export type PickerInventoryListResponse = {
  items: PickerInventoryItem[]
  next_cursor: string | null
}

export type PickerProductLocation = {
  location_id: string
  location_code: string
  lot_id: string
  batch_no: string
  expiry_date: string | null
  on_hand_qty: number
  reserved_qty: number
  available_qty: number
}

export type PickerProductDetailResponse = {
  product_id: string
  name: string
  main_barcode: string | null
  locations: PickerProductLocation[]
}

type QueryParams = {
  q?: string
  barcode?: string
  location_id?: string
  limit?: number
  cursor?: string
}

export async function listPickerInventory(params: QueryParams = {}): Promise<PickerInventoryListResponse> {
  const query: Record<string, string | number> = {}
  if (params.q) query.q = params.q
  if (params.barcode) query.barcode = params.barcode
  if (params.location_id) query.location_id = params.location_id
  if (params.limit) query.limit = params.limit
  if (params.cursor) query.cursor = params.cursor

  return fetchJSON<PickerInventoryListResponse>('/api/v1/inventory/picker', { query })
}

export async function getPickerProductDetail(productId: string): Promise<PickerProductDetailResponse> {
  return fetchJSON<PickerProductDetailResponse>(`/api/v1/inventory/picker/${productId}`)
}

export type InventoryByBarcodeResponse = {
  product_id: string
  name: string
  barcode: string | null
  brand: string | null
  best_locations: { location_code: string; available_qty: number }[]
  fefo_lots: { batch_no: string; expiry_date: string | null; available_qty: number }[]
  total_available: number
}

export async function getInventoryByBarcode(barcode: string): Promise<InventoryByBarcodeResponse> {
  const encoded = encodeURIComponent(barcode.trim())
  return fetchJSON<InventoryByBarcodeResponse>(`/api/v1/inventory/by-barcode/${encoded}`)
}

export type PickerLocationOption = {
  id: string
  code: string
  name: string
}

export async function listPickerLocations(): Promise<PickerLocationOption[]> {
  return fetchJSON<PickerLocationOption[]>('/api/v1/inventory/picker/locations')
}
