import { fetchJSON } from './apiClient'

/** Smartup movement$export raw item (movement_id, barcode, delivery_number, note, movement_items, ...). */
export type MovementItem = Record<string, unknown>

/** Movement item line (movement_items[]. */
export type MovementItemLine = {
  product_code?: string | null
  quantity?: string | number | null
  price?: string | number | null
  amount?: string | number | null
  movement_unit_id?: string | null
  [key: string]: unknown
}

export type MovementsResponse = {
  movement: MovementItem[]
  total?: number
}

export type MovementsQuery = {
  begin_created_on?: string
  end_created_on?: string
  filial_id?: string
  limit?: number
  offset?: number
}

export async function getMovements(query: MovementsQuery = {}) {
  return fetchJSON<MovementsResponse>('/api/v1/movements', { query })
}

export type OrderListItem = {
  id: string
  order_number: string
  source_external_id: string
  status: string
  filial_id?: string | null
  customer_id?: string | null
  customer_name?: string | null
  agent_id?: string | null
  agent_name?: string | null
  total_amount?: number | null
  created_at: string
  lines_total: number
  picker_name?: string | null
  controller_name?: string | null
  is_incomplete?: boolean
  from_warehouse_code?: string | null
  to_warehouse_code?: string | null
  movement_note?: string | null
  delivery_date?: string | null
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
  customer_id?: string | null
  customer_name?: string | null
  agent_id?: string | null
  agent_name?: string | null
  total_amount?: number | null
  created_at: string
  delivery_date?: string | null
  lines: OrderLine[]
  from_warehouse_code?: string | null
  to_warehouse_code?: string | null
  movement_note?: string | null
}

export type OrdersQuery = {
  status?: string
  q?: string
  date_from?: string
  date_to?: string
  filial_id?: string
  brand_ids?: string
  order_source?: string
  search_fields?: string
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
  begin_deal_date?: string
  end_deal_date?: string
  filial_code?: string | null
  filial_id?: string | null
  order_source?: string | null
}

export type SmartupSyncResult = {
  created: number
  updated: number
  skipped: number
  detail?: string | null
  errors_count?: number | null
  error?: string | null
  debug?: {
    raw_count?: number | null
    dict_count?: number | null
    filtered_count?: number
    inserted_count?: number
    updated_count?: number
    skipped_count?: number
    skipped_by_reason?: Record<string, number>
    preview?: Array<{
      movement_id?: string
      status?: string
      external_id?: string | null
      from_warehouse_code?: string | null
      to_warehouse_code?: string | null
      first_item?: { product_code?: string; product_article_code?: string; quantity?: unknown }
    }>
  } | null
}

export async function syncSmartupOrders(payload: SmartupSyncInput = {}) {
  return fetchJSON<SmartupSyncResult>('/api/v1/orders/sync-smartup', {
    method: 'POST',
    body: payload,
  })
}

export type SyncOrikzorInput = {
  begin_deal_date?: string
  end_deal_date?: string
}

export async function syncOrikzorOrders(payload: SyncOrikzorInput = {}) {
  return fetchJSON<SmartupSyncResult>('/api/v1/orders/sync-orikzor', {
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

/** Admin: buyurtma statusini o'zgartirish (documents:edit_status kerak). */
export async function updateOrderStatus(orderId: string, status: string) {
  return fetchJSON<OrderDetails>(`/api/v1/orders/${orderId}/status`, {
    method: 'PATCH',
    body: { status },
  })
}
