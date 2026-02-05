import type { Product, ProductsQuery } from './productsApi'

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
  {
    id: 'mock-3',
    name: 'Gel 200ml',
    sku: 'SKU-0003',
    barcode: '8600000000035',
    status: 'active',
  },
]

export async function getProductsMock(query: ProductsQuery = {}) {
  const term = query.q?.toLowerCase().trim()
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

export async function getProductMock(id: string) {
  const product = mockProducts.find((item) => item.id === id)
  if (!product) {
    throw new Error('Product not found')
  }
  return product
}
