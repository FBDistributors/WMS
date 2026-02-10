import { fetchJSON } from './apiClient'

export type Product = {
  id: string
  name: string
  sku: string
  barcode?: string
  barcodes?: string[]
  brand?: string
  brand_id?: string | null
  brand_name?: string | null
  brand_display_name?: string | null
  category?: string
  photo_url?: string
  is_active: boolean
  created_at?: string
}

export type ProductListResponse = {
  items: Product[]
  total: number
  limit: number
  offset: number
}

export type ProductsQuery = {
  q?: string
  search?: string
  limit?: number
  offset?: number
}

export async function getProducts(query: ProductsQuery = {}) {
  return fetchJSON<ProductListResponse>('/api/v1/products', {
    query: {
      search: query.search ?? query.q,
      limit: query.limit,
      offset: query.offset,
    },
  })
}

export async function getProduct(id: string) {
  return fetchJSON<Product>(`/api/v1/products/${id}`)
}

export type ProductCreateInput = {
  sku: string
  name: string
  brand?: string
  category?: string
  status?: 'active' | 'inactive'
  barcodes?: string[]
  photo_url?: string
}

export async function createProduct(payload: ProductCreateInput) {
  return fetchJSON<Product>('/api/v1/products', {
    method: 'POST',
    body: payload,
  })
}

export type ProductImportItem = {
  sku: string
  name: string
  brand?: string
  category?: string
  status?: 'active' | 'inactive'
  barcodes?: string[]
}

export type ProductImportFailure = {
  row: number
  sku?: string
  reason: string
}

export type ProductImportResult = {
  inserted: number
  updated?: number
  failed: ProductImportFailure[]
}

export async function importProducts(payload: ProductImportItem[]) {
  return fetchJSON<ProductImportResult>('/api/v1/products/import', {
    method: 'POST',
    body: payload,
  })
}

export type SmartupProductsSyncInput = {
  code?: string
  begin_created_on?: string
  end_created_on?: string
  begin_modified_on?: string
  end_modified_on?: string
}

export type SmartupProductsSyncResult = {
  run_id: string
  inserted: number
  updated: number
  skipped: number
  errors_count: number
  status: string
}

export type SmartupSyncRun = {
  id: string
  run_type: string
  started_at: string
  finished_at?: string | null
  inserted_count: number
  updated_count: number
  skipped_count: number
  error_count: number
  status: string
}

export async function syncProductsFromSmartup(payload: SmartupProductsSyncInput = {}) {
  return fetchJSON<SmartupProductsSyncResult>('/api/v1/products/sync-smartup', {
    method: 'POST',
    body: payload,
  })
}

export async function listProductsSyncRuns() {
  return fetchJSON<SmartupSyncRun[]>('/api/v1/products/sync-smartup/runs')
}
