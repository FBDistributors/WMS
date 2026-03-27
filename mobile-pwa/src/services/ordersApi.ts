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
  /** Delta: faqat shu sanadan o'zgartirilganlar (YYYY-MM-DD) */
  begin_modified_on?: string
  /** Delta: faqat shu sanagacha o'zgartirilganlar (YYYY-MM-DD) */
  end_modified_on?: string
  filial_id?: string
  to_warehouse_code?: string
  limit?: number
  offset?: number
  /** Cache ni bypass qilish, SmartUP dan qayta yuklash */
  refresh?: boolean
}

export async function getMovements(query: MovementsQuery = {}) {
  return fetchJSON<MovementsResponse>('/api/v1/movements', { query })
}

/** O'rikzor harakatlari — alohida API (Smartup proxy, Order bilan aloqasi yo'q). */
export async function getOrikzorMovements(
  query: MovementsQuery & { refresh?: boolean } = {}
) {
  return fetchJSON<MovementsResponse>('/api/v1/movements-orikzor', { query })
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
  has_so?: boolean
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

/** Legacy: B#S → B#W (backend endi faqat B#W ni qo‘llab-quvvatlaydi). */
function normalizeOrdersStatusQuery(status: string | undefined): string | undefined {
  if (status == null || status === '') return undefined
  const parts = status.split(',').map((s) => {
    const t = s.trim()
    return t === 'B#S' ? 'B#W' : t
  })
  return parts.filter(Boolean).join(',')
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
  const q = { ...query }
  if (q.status != null) {
    q.status = normalizeOrdersStatusQuery(q.status)
  }
  return fetchJSON<OrdersListResponse>('/api/v1/orders', { query: q })
}

/** Baza va jadval yuklashni tekshirish: B#W soni va q bo'yicha topiladigan buyurtmalar */
export type OrderCheckMatch = { id: string; order_number: string; source_external_id?: string | null; filial_id?: string | null }
export type OrderCheckResponse = {
  total_b_s: number
  total_b_s_all_filial: number
  match_by_order_number: OrderCheckMatch[]
  match_by_source_external_id: OrderCheckMatch[]
  match_by_so_doc_no: Array<{ order_id: string; doc_no: string; order_number: string }>
}

export async function getOrdersCheck(query: { q?: string; filial_id?: string } = {}) {
  return fetchJSON<OrderCheckResponse>('/api/v1/orders/check', { query: query as Record<string, string | undefined> })
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

/** SmartUp order$export dan to'g'ridan-to'g'ri javob (bazaga yozilmaydi). API bo'limida ko'rsatish uchun. */
export type SmartupOrderExportResponse = {
  order: Record<string, unknown>[]
  total: number
}

export type SmartupOrderExportQuery = {
  begin_deal_date?: string
  end_deal_date?: string
  filial_code?: string
  filial_id?: string
}

export async function getSmartupOrderExportRaw(query: SmartupOrderExportQuery = {}) {
  return fetchJSON<SmartupOrderExportResponse>('/api/v1/integrations/smartup/order-export', {
    query: query as Record<string, string | undefined>,
  })
}

export type PickerUser = {
  id: string
  name: string
}

export type ControllerUser = {
  id: string
  name: string
}

export async function getPickerUsers() {
  return fetchJSON<PickerUser[]>('/api/v1/orders/pickers')
}

export async function getControllerUsers() {
  return fetchJSON<ControllerUser[]>('/api/v1/orders/controllers')
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

/** Movement (Tashkiliy/O'rikzor) dan yig'ishga yuborish — Order get-or-create, keyin send-to-picking. */
export type SendMovementToPickingParams = {
  source: 'diller' | 'orikzor'
  movement_id: string
  movement: MovementItem
  assigned_to_user_id: string
}

export async function sendMovementToPicking(params: SendMovementToPickingParams) {
  const { source, movement_id, movement, assigned_to_user_id } = params
  const rawItems = (movement.movement_items as MovementItemLine[] | undefined) ?? []
  const movement_items = rawItems.map((line) => ({
    product_code: line.product_code ?? undefined,
    quantity: typeof line.quantity === 'number' ? line.quantity : Number(line.quantity) || 0,
    name: line.name ?? (line.product_code as string | undefined),
  }))
  return fetchJSON<{ pick_task_id: string; assigned_to: string }>(
    '/api/v1/orders/from-movement/send-to-picking',
    {
      method: 'POST',
      body: {
        source,
        movement_id,
        movement: {
          movement_id: movement.movement_id ?? movement_id,
          barcode: movement.barcode ?? undefined,
          from_warehouse_code: movement.from_warehouse_code ?? undefined,
          to_warehouse_code: movement.to_warehouse_code ?? undefined,
          note: movement.note ?? undefined,
          movement_items,
        },
        assigned_to_user_id,
      },
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

/** Admin: buyurtma statusini o'zgartirish (documents:edit_status kerak). Tekshiruvda: controller_user_id ixtiyoriy (controllerga yuborish). */
export async function updateOrderStatus(
  orderId: string,
  status: string,
  controllerUserId?: string
) {
  const body: { status: string; controller_user_id?: string } = { status }
  if (status === 'picked' && controllerUserId) {
    body.controller_user_id = controllerUserId
  }
  return fetchJSON<OrderDetails>(`/api/v1/orders/${orderId}/status`, {
    method: 'PATCH',
    body,
  })
}
