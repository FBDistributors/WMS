import { buildApiUrl, fetchJSON } from './apiClient'
import { appFetch } from '../utils/appFetch'

const TOKEN_KEY = 'wms_token'

export type GeneralCustomer = {
  id: string
  customer_id: string
  customer_name: string | null
  created_at: string
}

export type GeneralCustomerCreateInput = {
  customer_id: string
  customer_name?: string | null
}

export type GeneralCustomerUpdateInput = {
  customer_name?: string | null
}

export type GeneralCustomerImportResult = {
  created: number
  updated: number
  errors: { row: number; detail: string }[]
}

export async function getGeneralCustomers(search?: string, limit = 100, offset = 0) {
  return fetchJSON<GeneralCustomer[]>('/api/v1/general-customers', {
    query: { search, limit, offset },
  })
}

export async function createGeneralCustomer(payload: GeneralCustomerCreateInput) {
  return fetchJSON<GeneralCustomer>('/api/v1/general-customers', { method: 'POST', body: payload })
}

export async function updateGeneralCustomer(id: string, payload: GeneralCustomerUpdateInput) {
  return fetchJSON<GeneralCustomer>(`/api/v1/general-customers/${id}`, { method: 'PUT', body: payload })
}

export async function deleteGeneralCustomer(id: string) {
  return fetchJSON<void>(`/api/v1/general-customers/${id}`, { method: 'DELETE' })
}

export async function importGeneralCustomers(file: File): Promise<GeneralCustomerImportResult> {
  const form = new FormData()
  form.append('file', file)
  const token = localStorage.getItem(TOKEN_KEY)
  const url = buildApiUrl('/api/v1/general-customers/import')
  const response = await appFetch(url, {
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
  return payload as GeneralCustomerImportResult
}
