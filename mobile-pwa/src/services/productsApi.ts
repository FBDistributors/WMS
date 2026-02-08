import { fetchJSON } from './apiClient'

export type Product = {
  id: string
  name: string
  sku: string
  barcode?: string
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
  limit?: number
  offset?: number
}

export async function getProducts(query: ProductsQuery = {}) {
  return fetchJSON<ProductListResponse>('/api/v1/products', {
    query: {
      q: query.q,
      limit: query.limit,
      offset: query.offset,
    },
  })
}

export async function getProduct(id: string) {
  return fetchJSON<Product>(`/api/v1/products/${id}`)
}
