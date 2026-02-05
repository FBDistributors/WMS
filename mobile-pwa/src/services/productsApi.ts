import { fetchJSON } from './api/client'
import { getProductMock, getProductsMock } from './productsApi.mock'

export type ProductStatus = 'active' | 'inactive'

export type Product = {
  id: string
  name: string
  sku: string
  barcode?: string
  status: ProductStatus
}

export type ProductsQuery = {
  q?: string
  limit?: number
  offset?: number
}

const USE_MOCK_ADMIN = import.meta.env.VITE_USE_MOCK_ADMIN !== 'false'

export async function getProducts(query: ProductsQuery = {}) {
  if (USE_MOCK_ADMIN) {
    return getProductsMock(query)
  }

  // TODO: replace with real backend endpoint when available.
  return fetchJSON<Product[]>('/api/v1/products', {
    query: {
      q: query.q,
      limit: query.limit,
      offset: query.offset,
    },
  })
}

export async function getProduct(id: string) {
  if (USE_MOCK_ADMIN) {
    return getProductMock(id)
  }

  // TODO: replace with real backend endpoint when available.
  return fetchJSON<Product>(`/api/v1/products/${id}`)
}
