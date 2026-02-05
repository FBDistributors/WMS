import { fetchJSON } from './api/client'

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

const USE_MOCK_ADMIN = import.meta.env.VITE_USE_MOCK_ADMIN === 'true'

const mockProducts: Product[] = [
  {
    id: 'mock-1',
    name: 'Shampun 250ml',
    sku: 'SKU-0001',
    barcode: '8600000000011',
    status: 'active',
  },
  {
    id: 'mock-2',
    name: 'Krem 50ml',
    sku: 'SKU-0002',
    barcode: '8600000000028',
    status: 'inactive',
  },
]

export async function getProducts(query: ProductsQuery = {}) {
  if (USE_MOCK_ADMIN) {
    const term = query.q?.toLowerCase()
    const filtered = term
      ? mockProducts.filter(
          (item) =>
            item.name.toLowerCase().includes(term) ||
            item.sku.toLowerCase().includes(term) ||
            item.barcode?.includes(term)
        )
      : mockProducts
    return filtered
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
    const product = mockProducts.find((item) => item.id === id)
    if (!product) {
      throw new Error('Product not found')
    }
    return product
  }

  // TODO: replace with real backend endpoint when available.
  return fetchJSON<Product>(`/api/v1/products/${id}`)
}
