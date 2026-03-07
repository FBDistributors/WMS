import { fetchJSON } from './apiClient'

export type VipCustomer = {
  id: string
  customer_id: string
  customer_name: string | null
  min_expiry_months: number
  created_at: string
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

export async function deleteVipCustomer(id: string) {
  return fetchJSON<void>(`/api/v1/vip-customers/${id}`, { method: 'DELETE' })
}
