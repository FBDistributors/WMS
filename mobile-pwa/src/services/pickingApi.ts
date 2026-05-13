import { fetchJSON } from './apiClient'

export type PickListStatus = 'NEW' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'ERROR' | 'UNKNOWN'

/** Yakunlangan yoki bekor — mobil terish oqimi o‘rniga faqat ko‘rish. */
export function isTerminalPickListStatus(status: PickListStatus): boolean {
  return status === 'DONE' || status === 'ERROR'
}

export type PickList = {
  id: string
  document_no: string
  /** Buyurtma ID (WMS status / yig'uvchini almashtirish uchun). */
  order_id?: string | null
  order_number?: string | null
  delivery_number?: string | null
  created_at?: string
  completed_at?: string | null
  /** Backend document status string (for labels). */
  document_status: string
  /** Buyurtma WMS bosqichi (buyurtma bo'lsa); badge va oqim yorlig'i uchun. */
  order_wms_status?: string | null
  status: PickListStatus
  total_lines: number
  picked_lines: number
  picker_name?: string | null
  controller_name?: string | null
  updated_at?: string
}

export type PickLineStatus = 'NEW' | 'IN_PROGRESS' | 'DONE' | 'ERROR'

export type PickLine = {
  id: string
  product_name: string
  location_code: string
  batch?: string | null
  expiry_date?: string | null
  barcode?: string | null
  sku?: string | null
  qty_required: number
  qty_picked: number
  status: PickLineStatus
  /** VIP muddat: faqat ma'lumot, terilmaydi */
  is_vip_expiry_informational?: boolean
  vip_expiry_information_key?: string | null
}

export type PickListDetails = PickList & {
  lines: PickLine[]
}

type BackendPickingListItem = {
  id: string
  reference_number: string
  order_id?: string | null
  order_number?: string | null
  delivery_number?: string | null
  status: string
  order_wms_status?: string | null
  lines_total: number
  lines_done: number
  completed_at?: string | null
  assigned_to_user_name?: string | null
  controlled_by_user_name?: string | null
  updated_at?: string
}

type BackendDocumentLine = {
  id?: string
  line_id?: string
  product_name: string
  location_code: string
  batch?: string | null
  expiry_date?: string | null
  barcode?: string | null
  sku?: string | null
  qty_required: number
  qty_picked: number
  is_vip_expiry_informational?: boolean
  vip_expiry_information_key?: string | null
}

type BackendPickingDetails = {
  id: string
  reference_number: string
  order_number?: string | null
  status: string
  lines: BackendDocumentLine[]
  progress: {
    picked: number
    required: number
  }
}

const STATUS_MAP: Record<string, PickListStatus> = {
  draft: 'NEW',
  confirmed: 'NEW',
  new: 'NEW',
  in_progress: 'IN_PROGRESS',
  partial: 'IN_PROGRESS',
  picked: 'REVIEW',
  completed: 'DONE',
  packed: 'DONE',
  shipped: 'DONE',
  cancelled: 'ERROR',
}

function mapStatus(status: string): PickListStatus {
  return STATUS_MAP[status] ?? 'UNKNOWN'
}

/** Jadval badge rangi: buyurtma WMS (Jarayon oqimi). */
function mapWmsStatusToPickListBadge(wms: string | null | undefined): PickListStatus | null {
  if (wms == null || String(wms).trim() === '') return null
  const k = String(wms).toLowerCase()
  if (k === 'imported') return 'NEW'
  if (k === 'allocated' || k === 'picking') return 'IN_PROGRESS'
  if (k === 'picked') return 'REVIEW'
  if (k === 'completed' || k === 'packed' || k === 'shipped') return 'DONE'
  if (k === 'cancelled' || k === 'cancelling_in_progress') return 'ERROR'
  return 'UNKNOWN'
}

function mapLineStatus(line: BackendDocumentLine): PickLineStatus {
  if (line.is_vip_expiry_informational) return 'DONE'
  if (line.qty_picked >= line.qty_required) return 'DONE'
  if (line.qty_picked > 0) return 'IN_PROGRESS'
  return 'NEW'
}

function mapPickingLineToPickerViewModel(line: BackendDocumentLine): PickLine {
  const id = line.id ?? line.line_id ?? ''
  return {
    id,
    product_name: line.product_name,
    location_code: line.location_code,
    batch: line.batch ?? null,
    expiry_date: line.expiry_date ?? null,
    barcode: line.barcode ?? null,
    sku: line.sku ?? null,
    qty_required: line.qty_required,
    qty_picked: line.qty_picked,
    status: mapLineStatus(line),
    is_vip_expiry_informational: line.is_vip_expiry_informational === true,
    vip_expiry_information_key: line.vip_expiry_information_key ?? null,
  }
}

function mapList(item: BackendPickingListItem): PickList {
  const raw = item.status
  const wmsBadge = mapWmsStatusToPickListBadge(item.order_wms_status)
  return {
    id: item.id,
    document_no: item.reference_number,
    order_id: item.order_id ?? undefined,
    order_number: item.order_number ?? undefined,
    delivery_number: item.delivery_number?.trim() || undefined,
    document_status: raw,
    order_wms_status: item.order_wms_status ?? undefined,
    status: wmsBadge ?? mapStatus(raw),
    total_lines: item.lines_total,
    picked_lines: item.lines_done,
    completed_at: item.completed_at ?? undefined,
    picker_name: item.assigned_to_user_name ?? undefined,
    controller_name: item.controlled_by_user_name ?? undefined,
    updated_at: item.updated_at,
  }
}

function mapDetails(doc: BackendPickingDetails): PickListDetails {
  const totalLines = doc.lines.length
  const pickedLines = doc.lines.filter(
    (line) =>
      line.is_vip_expiry_informational === true || line.qty_picked >= line.qty_required
  ).length
  const raw = doc.status
  return {
    id: doc.id,
    document_no: doc.reference_number,
    order_number: doc.order_number ?? undefined,
    document_status: raw,
    status: mapStatus(raw),
    total_lines: totalLines,
    picked_lines: pickedLines,
    lines: doc.lines.map(mapPickingLineToPickerViewModel),
  }
}

export type ListPickListsOptions = {
  /** Admin Jarayon / Arxiv: backend filtrlash; mobil yig'uvchi/controller uchun yuborilmaydi. */
  processScope?: 'active' | 'archived' | 'cancelled'
  /** Dashboard guruhi: backend `wms_group`; picker/controller uchun server e'tiborsiz. */
  wmsGroup?: 'yigishda' | 'tekshiruvda' | 'yakunlangan'
}

export async function listPickLists(
  limit = 50,
  offset = 0,
  options: ListPickListsOptions = {},
  signal?: AbortSignal
) {
  const data = await fetchJSON<BackendPickingListItem[]>('/api/v1/picking/documents', {
    query: {
      limit,
      offset,
      ...(options.processScope ? { process_scope: options.processScope } : {}),
      ...(options.wmsGroup ? { wms_group: options.wmsGroup } : {}),
    },
    signal,
  })
  return data.map(mapList)
}

export async function getPickListDetails(id: string) {
  const data = await fetchJSON<BackendPickingDetails>(`/api/v1/picking/documents/${id}`)
  return mapDetails(data)
}

export async function getPickListDetailsForPicker(id: string) {
  return getPickListDetails(id)
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export async function pickLineDelta(lineId: string, delta: 1 | -1) {
  return fetchJSON(`/api/v1/picking/lines/${lineId}/pick`, {
    method: 'POST',
    body: { delta, request_id: createRequestId() },
  })
}

export async function completePick(documentId: string) {
  return fetchJSON(`/api/v1/picking/documents/${documentId}/complete`, {
    method: 'POST',
  })
}

/** Cancel a picking document (e.g. test docs). Requires documents:edit_status. */
export async function cancelPickList(documentId: string) {
  return fetchJSON<{ id: string; status: string }>(`/api/v1/documents/${documentId}`, {
    method: 'PATCH',
    body: { status: 'cancelled' },
  })
}
