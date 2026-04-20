import { buildApiUrl, fetchJSON } from './apiClient'

const TOKEN_KEY = 'wms_token'

export type VipBrandLimit = {
  brand_id: string
  min_expiry_months: number
}

export type VipCustomer = {
  id: string
  customer_id: string
  customer_name: string | null
  min_expiry_months: number
  created_at: string
  brand_limits: VipBrandLimit[]
}

export type VipCustomerCreateInput = {
  customer_id: string
  customer_name?: string | null
  min_expiry_months: number
}

export type VipCustomerUpdateInput = {
  customer_name?: string | null
  min_expiry_months?: number
}

export type VipBrandLimitInput = {
  brand_id: string
  min_expiry_months: number
}

export async function getVipCustomers(search?: string, limit = 100, offset = 0) {
  return fetchJSON<VipCustomer[]>('/api/v1/vip-customers', {
    query: { search, limit, offset },
  })
}

export async function createVipCustomer(payload: VipCustomerCreateInput) {
  return fetchJSON<VipCustomer>('/api/v1/vip-customers', { method: 'POST', body: payload })
}

export async function updateVipCustomer(id: string, payload: VipCustomerUpdateInput) {
  return fetchJSON<VipCustomer>(`/api/v1/vip-customers/${id}`, { method: 'PUT', body: payload })
}

export async function putVipCustomerBrandLimits(id: string, limits: VipBrandLimitInput[]) {
  return fetchJSON<VipCustomer>(`/api/v1/vip-customers/${id}/brand-limits`, {
    method: 'PUT',
    body: limits,
  })
}

export async function deleteVipCustomer(id: string) {
  return fetchJSON<void>(`/api/v1/vip-customers/${id}`, { method: 'DELETE' })
}

export type VipCustomerImportResult = {
  created: number
  updated: number
  errors: { row: number; detail: string }[]
}

export async function importVipCustomers(file: File): Promise<VipCustomerImportResult> {
  const form = new FormData()
  form.append('file', file)
  const token = localStorage.getItem(TOKEN_KEY)
  const url = buildApiUrl('/api/v1/vip-customers/import')
  const response = await fetch(url, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  const isJson = contentType.includes('application/json')
  const payload = isJson ? await response.json() : await response.text()
  if (!response.ok) {
    const detail =
      isJson && payload && typeof payload === 'object' && 'detail' in payload
        ? String((payload as { detail?: unknown }).detail)
        : typeof payload === 'string'
          ? payload
          : 'Import failed'
    throw new Error(detail)
  }
  return payload as VipCustomerImportResult
}
