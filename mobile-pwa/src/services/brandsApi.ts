import { fetchJSON } from './apiClient'

export type Brand = {
  id: string
  code: string
  name: string
  display_name?: string | null
  is_active: boolean
}

export type BrandCreateInput = {
  code: string
  name: string
  display_name?: string | null
  is_active?: boolean
}

export type BrandUpdateInput = {
  code?: string
  name?: string
  display_name?: string | null
  is_active?: boolean
}

export async function getBrands(search?: string, includeInactive = false) {
  return fetchJSON<Brand[]>('/api/v1/brands', {
    query: { search, include_inactive: includeInactive },
  })
}

export async function createBrand(payload: BrandCreateInput) {
  return fetchJSON<Brand>('/api/v1/brands', { method: 'POST', body: payload })
}

export async function updateBrand(id: string, payload: BrandUpdateInput) {
  return fetchJSON<Brand>(`/api/v1/brands/${id}`, { method: 'PUT', body: payload })
}

export async function deactivateBrand(id: string) {
  return fetchJSON<Brand>(`/api/v1/brands/${id}`, { method: 'DELETE' })
}

export async function getUnknownBrandCodes() {
  return fetchJSON<string[]>('/api/v1/brands/unknown-codes')
}
