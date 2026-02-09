import { fetchJSON } from './apiClient'

export type Product = {
  id: string
  name: string
  sku: string
  barcode?: string
  barcodes?: string[]
  brand?: string
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
