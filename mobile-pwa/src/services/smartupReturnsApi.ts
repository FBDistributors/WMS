import { fetchJSON } from './apiClient'

export type SmartupReturnLine = {
  product_code: string | null
  product_name: string | null
  return_quant: number | null
  product_price: number | null
  expiry_date: string | null
  warehouse_code: string | null
  action_name: string | null
}

export type SmartupReturn = {
  id: string
  deal_id: string
  order_deal_id: string | null
  return_date: string | null
  person_name: string | null
  person_code: string | null
  return_reason_id: string | null
  sales_manager_name: string | null
  total_amount: number | null
  status: string | null
  wms_status: string
  note: string | null
  customer_return_id: string | null
  lines_count: number
  lines: SmartupReturnLine[]
}

export type DispatchReturnResponse = {
  customer_return_id: string
  doc_no: string
  status: string
}

export type SmartupReturnsListResponse = {
  items: SmartupReturn[]
  total: number
}

export type SmartupReturnsSyncResponse = {
  fetched: number
  created: number
  updated: number
}

export async function getSmartupReturns(params: {
  q?: string
  onlyNew?: boolean
  limit?: number
  offset?: number
}) {
  const sp = new URLSearchParams()
  if (params.q && params.q.trim()) sp.set('q', params.q.trim())
  if (params.onlyNew === false) sp.set('only_new', 'false')
  sp.set('limit', String(params.limit ?? 50))
  sp.set('offset', String(params.offset ?? 0))
  return fetchJSON<SmartupReturnsListResponse>(`/api/v1/smartup-returns?${sp.toString()}`)
}

export async function getSmartupReturn(id: string) {
  return fetchJSON<SmartupReturn>(`/api/v1/smartup-returns/${id}`)
}

export async function dispatchSmartupReturn(id: string, pickerUserId: string) {
  return fetchJSON<DispatchReturnResponse>(`/api/v1/smartup-returns/${id}/dispatch`, {
    method: 'POST',
    body: { picker_user_id: pickerUserId },
  })
}

export async function syncSmartupReturns() {
  return fetchJSON<SmartupReturnsSyncResponse>('/api/v1/smartup-returns/sync?days=30', {
    method: 'POST',
  })
}
