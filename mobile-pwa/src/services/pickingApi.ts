import { fetchJSON } from './apiClient'

export type PickListStatus = 'NEW' | 'IN_PROGRESS' | 'DONE' | 'ERROR'

export type PickList = {
  id: string
  document_no: string
  created_at?: string
  status: PickListStatus
  total_lines: number
  picked_lines: number
}

export type PickLineStatus = 'NEW' | 'IN_PROGRESS' | 'DONE' | 'ERROR'

export type PickLine = {
  id: string
  product_name: string
  location_code: string
  batch?: string | null
  expiry_date?: string | null
  qty_required: number
  qty_picked: number
  status: PickLineStatus
}

export type PickListDetails = PickList & {
  lines: PickLine[]
}

type BackendPickingListItem = {
  id: string
  reference_number: string
  status: string
  lines_total: number
  lines_done: number
}

type BackendDocumentLine = {
  line_id: string
  product_name: string
  location_code: string
  batch?: string | null
  expiry_date?: string | null
  qty_required: number
  qty_picked: number
}

type BackendPickingDetails = {
  id: string
  reference_number: string
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
  completed: 'DONE',
  cancelled: 'ERROR',
}

function mapStatus(status: string): PickListStatus {
  return STATUS_MAP[status] ?? 'ERROR'
}

function mapLineStatus(line: BackendDocumentLine): PickLineStatus {
  if (line.qty_picked >= line.qty_required) return 'DONE'
  if (line.qty_picked > 0) return 'IN_PROGRESS'
  return 'NEW'
}

function mapPickingLineToPickerViewModel(line: BackendDocumentLine): PickLine {
  return {
    id: line.line_id,
    product_name: line.product_name,
    location_code: line.location_code,
    batch: line.batch ?? null,
    expiry_date: line.expiry_date ?? null,
    qty_required: line.qty_required,
    qty_picked: line.qty_picked,
    status: mapLineStatus(line),
  }
}

function mapList(item: BackendPickingListItem): PickList {
  return {
    id: item.id,
    document_no: item.reference_number,
    status: mapStatus(item.status),
    total_lines: item.lines_total,
    picked_lines: item.lines_done,
  }
}

function mapDetails(doc: BackendPickingDetails): PickListDetails {
  const totalLines = doc.lines.length
  const pickedLines = doc.lines.filter((line) => line.qty_picked >= line.qty_required).length
  return {
    id: doc.id,
    document_no: doc.reference_number,
    status: mapStatus(doc.status),
    total_lines: totalLines,
    picked_lines: pickedLines,
    lines: doc.lines.map(mapPickingLineToPickerViewModel),
  }
}

export async function listPickLists(limit = 50, offset = 0) {
  const data = await fetchJSON<BackendPickingListItem[]>('/api/v1/picking/documents', {
    query: { limit, offset },
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
