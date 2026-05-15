import { fetchJSON } from './apiClient'

/** Smartup movement$export raw item (movement_id, barcode, delivery_number, note, movement_items, ...). */
/** Smartup movement qatori; backend WMS boyitishi: yig'ishga yuborilgan buyurtma holati */
export type MovementItem = Record<string, unknown> & {
  wms_order_status?: string | null
}

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
  /** Smartup harakat statusi: N (default), all, yoki vergul bilan ro'yxat */
  smartup_status?: string
  /** WMS status filter: new, picking, review, completed, cancelled, all */
  wms_status?: string
}

export async function getMovements(query: MovementsQuery = {}, init?: { signal?: AbortSignal }) {
  return fetchJSON<MovementsResponse>('/api/v1/movements', { query, signal: init?.signal })
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
  /** SO terish hujjati statusi (backend: so_document_status) */
  so_document_status?: string | null
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
  /** Backend: terish hujjati yo'q bo'lsa true */
  lines_editable?: boolean
}

export type OrderLineCreateBody = {
  name: string
  qty: number
  sku?: string | null
  barcode?: string | null
  uom?: string | null
}

/** Legacy: B#S / B#W / ready_for_picking → imported (canonical WMS). */
function normalizeOrdersStatusQuery(status: string | undefined): string | undefined {
  if (status == null || status === '') return undefined
  const parts = status.split(',').map((s) => {
    const t = s.trim()
    if (t === 'B#S' || t === 'B#W' || t === 'ready_for_picking') return 'imported'
    return t
  })
  return [...new Set(parts.filter(Boolean))].join(',')
}

export type OrdersQuery = {
  status?: string
  q?: string
  created_from?: string
  date_from?: string
  date_to?: string
  filial_id?: string
  brand_ids?: string
  order_source?: string
  search_fields?: string
  limit?: number
  offset?: number
}

export async function getOrders(query: OrdersQuery = {}, init?: { signal?: AbortSignal }) {
  const q = { ...query }
  if (q.status != null) {
    q.status = normalizeOrdersStatusQuery(q.status)
  }
  return fetchJSON<OrdersListResponse>('/api/v1/orders', { query: q, signal: init?.signal })
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

export async function addOrderLine(orderId: string, body: OrderLineCreateBody) {
  return fetchJSON<OrderDetails>(`/api/v1/orders/${orderId}/lines`, {
    method: 'POST',
    body,
  })
}

export async function deleteOrderLine(orderId: string, lineId: string) {
  return fetchJSON<OrderDetails>(`/api/v1/orders/${orderId}/lines/${lineId}`, {
    method: 'DELETE',
  })
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
    diller_items_from_smartup?: number
    mfm_date_filter_mode?: string
    diller_http_body_len?: number
    diller_raw_keys?: string[]
    diller_extracted_rows?: number
    diller_extract_source?: string | null
    mfm_sync_attempts?: Array<{
      mode?: string
      extracted_rows?: number
      orders_parsed?: number
      http_body_len?: number
      raw_keys?: string[]
    }>
    mfm_request_filial_id?: string
    mfm_request_project_code?: string
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

export type AllocationShortageOut = {
  line_id: string
  sku?: string | null
  barcode?: string | null
  required_qty: number
  allocated_qty: number
}

export type SendToPickingValidationFailureOut = {
  order_id: string
  order_number: string
  code: string
  message?: string | null
  shortages: AllocationShortageOut[]
}

export type ValidateSendToPickingResponse = {
  ok: boolean
  failures: SendToPickingValidationFailureOut[]
}

/** Yig‘ishga yuborishdan oldin zaxira tekshiruvi — DB ga yozilmaydi. */
export async function validateOrdersSendToPicking(orderIds: string[]) {
  return fetchJSON<ValidateSendToPickingResponse>('/api/v1/orders/validate-send-to-picking', {
    method: 'POST',
    body: { order_ids: orderIds },
  })
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

export async function reassignOrderPicker(orderId: string, assignedToUserId: string) {
  return fetchJSON<{ pick_task_id: string; assigned_to: string }>(
    `/api/v1/orders/${orderId}/reassign-picker`,
    {
      method: 'POST',
      body: { assigned_to_user_id: assignedToUserId },
    }
  )
}

/** Backend `MovementPayload` (from-movement API). */
export function buildMovementApiPayload(movementId: string, movement: MovementItem) {
  const rawItems = (movement.movement_items as MovementItemLine[] | undefined) ?? []
  const movement_items = rawItems.map((line) => ({
    product_code: line.product_code ?? undefined,
    quantity: typeof line.quantity === 'number' ? line.quantity : Number(line.quantity) || 0,
    name: line.name ?? (line.product_code as string | undefined),
  }))
  return {
    movement_id: movement.movement_id ?? movementId,
    barcode: movement.barcode ?? undefined,
    from_warehouse_code: movement.from_warehouse_code ?? undefined,
    to_warehouse_code: movement.to_warehouse_code ?? undefined,
    note: movement.note ?? undefined,
    delivery_number: (() => {
      const raw = movement.delivery_number
      if (raw === undefined || raw === null) return undefined
      const s = String(raw).trim().slice(0, 64)
      return s || undefined
    })(),
    movement_items,
  }
}

/** Movement uchun DB da Order yaratish yoki qaytarish (qatorlarni tahrirlash). */
export async function ensureMovementOrder(params: {
  source: 'diller' | 'orikzor'
  movement_id: string
  movement: MovementItem
}) {
  const { source, movement_id, movement } = params
  return fetchJSON<OrderDetails>('/api/v1/orders/from-movement/ensure', {
    method: 'POST',
    body: {
      source,
      movement_id,
      movement: buildMovementApiPayload(movement_id, movement),
    },
  })
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
  return fetchJSON<{ pick_task_id: string; assigned_to: string }>(
    '/api/v1/orders/from-movement/send-to-picking',
    {
      method: 'POST',
      body: {
        source,
        movement_id,
        movement: buildMovementApiPayload(movement_id, movement),
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

export type CustomerReturnLine = {
  id: string
  product_id: string
  location_id: string
  product_name: string
  location_code: string
  qty: number | string
  batch: string
  expiry_date?: string | null
}

export type CustomerReturnOut = {
  id: string
  doc_no: string
  customer_id?: string | null
  customer_name?: string | null
  status: string
  created_by_user_id?: string | null
  created_by_user_name?: string | null
  approved_by_user_id?: string | null
  approved_by_user_name?: string | null
  assigned_picker_user_id?: string | null
  assigned_by_user_id?: string | null
  assigned_at?: string | null
  assigned_by_user_name?: string | null
  assigned_picker_user_name?: string | null
  created_at: string
  updated_at: string
  lines: CustomerReturnLine[]
}

export type CustomerReturnListOut = {
  items: CustomerReturnOut[]
  total: number
}

export type CustomerReturnsHistoryQuery = {
  q?: string
  status?: string
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}

export async function getCustomerReturnsHistory(
  query: CustomerReturnsHistoryQuery = {},
  init?: { signal?: AbortSignal }
) {
  return fetchJSON<CustomerReturnListOut>('/api/v1/customer-returns', { query, signal: init?.signal })
}

export async function getCustomerReturn(returnId: string, init?: { signal?: AbortSignal }) {
  return fetchJSON<CustomerReturnOut>(`/api/v1/customer-returns/${returnId}`, {
    signal: init?.signal,
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
