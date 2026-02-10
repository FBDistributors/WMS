import { fetchJSON } from './apiClient'

export type OrderListItem = {
  id: string
  order_number: string
  source_external_id: string
  status: string
  filial_id?: string | null
  customer_name?: string | null
  created_at: string
  lines_total: number
}

export type OrdersListResponse = {
  items: OrderListItem[]
  total: number
  limit: number
  offset: number
}

export type OrderLine = {
  id: string
  sku?: string | null
  barcode?: string | null
  name: string
  qty: number
  uom?: string | null
}

export type OrderDetails = {
  id: string
  order_number: string
  source_external_id: string
  status: string
  filial_id?: string | null
  customer_name?: string | null
  created_at: string
  lines: OrderLine[]
}

export type OrdersQuery = {
  status?: string
  q?: string
  date_from?: string
  date_to?: string
  filial_id?: string
  limit?: number
  offset?: number
}

export async function getOrders(query: OrdersQuery = {}) {
  return fetchJSON<OrdersListResponse>('/api/v1/orders', { query })
}

export async function getOrder(id: string) {
  return fetchJSON<OrderDetails>(`/api/v1/orders/${id}`)
}

export type SmartupSyncInput = {
  begin_deal_date: string
  end_deal_date: string
  filial_code?: string | null
}

export type SmartupSyncResult = {
  created: number
  updated: number
  skipped: number
}

export async function syncSmartupOrders(payload: SmartupSyncInput) {
  return fetchJSON<SmartupSyncResult>('/api/v1/orders/sync-smartup', {
    method: 'POST',
    body: payload,
  })
}

export type PickerUser = {
  id: string
  name: string
}

export async function getPickerUsers() {
  return fetchJSON<PickerUser[]>('/api/v1/orders/pickers')
}

export async function sendOrderToPicking(orderId: string, assignedToUserId: string) {
  return fetchJSON<{ pick_task_id: string; assigned_to: string }>(
    `/api/v1/orders/${orderId}/send-to-picking`,
    {
      method: 'POST',
      body: { assigned_to_user_id: assignedToUserId },
    }
  )
}

export async function packOrder(orderId: string) {
  return fetchJSON<OrderDetails>(`/api/v1/orders/${orderId}/pack`, {
    method: 'POST',
  })
}

export async function shipOrder(orderId: string) {
  return fetchJSON<OrderDetails>(`/api/v1/orders/${orderId}/ship`, {
    method: 'POST',
  })
}
