import { fetchJSON } from './apiClient'

export type ProductBoxProduct = {
  id: string
  name: string
  sku: string
  barcode?: string | null
}

export type ProductBox = {
  id: string
  box_barcode: string
  product_id: string
  units_per_box: number
  label?: string | null
  is_active: boolean
  created_at: string
  product?: ProductBoxProduct | null
}

export type ProductBoxCreate = {
  box_barcode: string
  product_id: string
  units_per_box: number
  label?: string | null
}

export type ProductBoxUpdate = {
  box_barcode?: string
  product_id?: string
  units_per_box?: number
  label?: string | null
  is_active?: boolean
}

export type ProductBoxResolve = {
  product_id: string
  units_per_box: number
  scan_kind: string
  product_name: string
  product_sku: string
  product_barcode?: string | null
  box_id: string
}

export async function listProductBoxes(params?: {
  search?: string
  product_id?: string
  active_only?: boolean
  limit?: number
  offset?: number
}) {
  return fetchJSON<ProductBox[]>('/api/v1/product-boxes', {
    query: {
      search: params?.search,
      product_id: params?.product_id,
      active_only: params?.active_only ?? true,
      limit: params?.limit ?? 100,
      offset: params?.offset ?? 0,
    },
  })
}

export async function createProductBox(payload: ProductBoxCreate) {
  return fetchJSON<ProductBox>('/api/v1/product-boxes', {
    method: 'POST',
    body: payload,
  })
}

export async function updateProductBox(id: string, payload: ProductBoxUpdate) {
  return fetchJSON<ProductBox>(`/api/v1/product-boxes/${id}`, {
    method: 'PATCH',
    body: payload,
  })
}

export async function deleteProductBox(id: string) {
  return fetchJSON<void>(`/api/v1/product-boxes/${id}`, {
    method: 'DELETE',
  })
}

export async function resolveProductBoxBarcode(barcode: string) {
  return fetchJSON<ProductBoxResolve>(
    `/api/v1/product-boxes/by-barcode/${encodeURIComponent(barcode.trim())}`
  )
}
