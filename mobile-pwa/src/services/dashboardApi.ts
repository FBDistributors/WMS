import { fetchJSON } from './apiClient'
import type { ActivePick, DashboardSummary } from '../types/dashboard'

type ApiPickDocumentItem = {
  id: string
  document_no: string
  status: string
  lines_picked: number
  lines_total: number
  picker_name: string | null
  controller_name: string | null
}

type ApiPickDocumentsResponse = {
  items: ApiPickDocumentItem[]
}

type ApiDashboardSummary = {
  total_orders: number
  completed_today: number
  in_picking: number
  active_pickers: number
  exceptions: number
  low_stock: number
  deltas?: {
    total_orders?: string
    completed_today?: string
    in_picking?: string
    active_pickers?: string
    exceptions?: string
    low_stock?: string
  }
}

function toCamelDeltas(deltas?: ApiDashboardSummary['deltas']) {
  if (!deltas) return undefined
  const out: DashboardSummary['deltas'] = {}
  if (deltas.total_orders) out.totalOrders = deltas.total_orders
  if (deltas.completed_today) out.completedToday = deltas.completed_today
  if (deltas.in_picking) out.inPicking = deltas.in_picking
  if (deltas.active_pickers) out.activePickers = deltas.active_pickers
  if (deltas.exceptions) out.exceptions = deltas.exceptions
  if (deltas.low_stock) out.lowStock = deltas.low_stock
  return Object.keys(out).length ? out : undefined
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const data = await fetchJSON<ApiDashboardSummary>('/api/v1/dashboard/summary')
  return {
    totalOrders: data.total_orders,
    completedToday: data.completed_today,
    inPicking: data.in_picking,
    activePickers: data.active_pickers,
    exceptions: data.exceptions,
    lowStock: data.low_stock,
    deltas: toCamelDeltas(data.deltas),
  }
}

export type OrdersByStatusRow = { status: string; count: number }

export async function getOrdersByStatus(): Promise<OrdersByStatusRow[]> {
  const data = await fetchJSON<{ items: OrdersByStatusRow[] }>('/api/v1/dashboard/orders-by-status')
  return data.items
}

export type PickerPerformanceRow = {
  picker_id: string
  picker_name: string
  total_picked_qty: number
  movements_count: number
  documents_count: number
}

export async function getPickerPerformance(params?: {
  date_from?: string
  date_to?: string
}): Promise<PickerPerformanceRow[]> {
  const query: Record<string, string> = {}
  if (params?.date_from) query.date_from = params.date_from
  if (params?.date_to) query.date_to = params.date_to
  const data = await fetchJSON<
    { picker_id: string; picker_name: string; total_picked_qty: string; movements_count: number; documents_count: number }[]
  >('/api/v1/reports/picker-performance', { query })
  return data.map((row) => ({
    picker_id: row.picker_id,
    picker_name: row.picker_name,
    total_picked_qty: Number(row.total_picked_qty),
    movements_count: row.movements_count,
    documents_count: row.documents_count,
  }))
}

export async function getPickDocuments(params?: {
  limit?: number
  offset?: number
  status?: string
}): Promise<ActivePick[]> {
  const searchParams = new URLSearchParams()
  if (params?.limit != null) searchParams.set('limit', String(params.limit))
  if (params?.offset != null) searchParams.set('offset', String(params.offset))
  if (params?.status) searchParams.set('status', params.status)
  const qs = searchParams.toString()
  const data = await fetchJSON<ApiPickDocumentsResponse>(
    `/api/v1/dashboard/pick-documents${qs ? `?${qs}` : ''}`
  )
  return data.items.map((item) => ({
    id: item.id,
    document_no: item.document_no,
    status: item.status,
    picked: item.lines_picked,
    total: item.lines_total,
    picker_name: item.picker_name ?? undefined,
    controller_name: item.controller_name ?? undefined,
  }))
}
