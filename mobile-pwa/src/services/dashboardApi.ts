import { fetchJSON } from './apiClient'
import type { ActivePick, DashboardSummary } from '../types/dashboard'

type ApiPickDocumentItem = {
  id: string
  document_no: string
  order_number?: string | null
  status: string
  lines_picked: number
  lines_total: number
  picker_name: string | null
  controller_name: string | null
  updated_at?: string
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

export type PickingStaffStatsRow = {
  user_id: string
  full_name: string
  documents_count: number
  lines_count: number
  total_picked_qty: number
}

export type PickingStaffStatsResponse = {
  pickers: PickingStaffStatsRow[]
  controllers: PickingStaffStatsRow[]
}

export type StaffGroup = 'shahar' | 'region'

export async function getPickingStaffStats(params?: {
  date_from?: string
  date_to?: string
  group?: StaffGroup
  completed_only?: boolean
}): Promise<PickingStaffStatsResponse> {
  const query: Record<string, string> = {}
  if (params?.date_from) query.date_from = params.date_from
  if (params?.date_to) query.date_to = params.date_to
  if (params?.group) query.group = params.group
  if (params?.completed_only) query.completed_only = 'true'
  return fetchJSON<PickingStaffStatsResponse>('/api/v1/dashboard/picking-staff-stats', { query })
}

export type StaffRole = 'picker' | 'controller'

export type StaffOrderRow = {
  document_id: string
  order_id: string | null
  document_no: string
  order_number: string | null
  customer_name: string | null
  status: string
  lines_count: number
  picked_qty: number
  activity_at: string | null
  first_assigned_at: string | null
  sent_to_controller_at: string | null
  controller_verification_started_at: string | null
  completed_at: string | null
  pick_seconds: number | null
  control_total_seconds: number | null
  control_check_seconds: number | null
}

export type StaffTimingPickerRow = {
  user_id: string
  full_name: string
  orders_count: number
  total_units: number
  total_positions: number
  units_per_hour: number
  positions_per_hour: number
  median_seconds: number
}

export type StaffTimingControllerRow = {
  user_id: string
  full_name: string
  orders_count: number
  total_units: number
  total_positions: number
  units_per_hour: number
  positions_per_hour: number
  check_count: number
  median_total_seconds: number
  median_check_seconds: number
}

export type StaffTimingResponse = {
  pickers: StaffTimingPickerRow[]
  controllers: StaffTimingControllerRow[]
}

export async function getStaffTiming(params?: {
  date_from?: string
  date_to?: string
  group?: StaffGroup
}): Promise<StaffTimingResponse> {
  const query: Record<string, string> = {}
  if (params?.date_from) query.date_from = params.date_from
  if (params?.date_to) query.date_to = params.date_to
  if (params?.group) query.group = params.group
  return fetchJSON<StaffTimingResponse>('/api/v1/dashboard/staff-timing', { query })
}

export async function getStaffOrders(params: {
  userId: string
  role: StaffRole
  dateFrom?: string
  dateTo?: string
  group?: StaffGroup
}): Promise<StaffOrderRow[]> {
  const query: Record<string, string> = { user_id: params.userId, role: params.role }
  if (params.dateFrom) query.date_from = params.dateFrom
  if (params.dateTo) query.date_to = params.dateTo
  if (params.group) query.group = params.group
  const data = await fetchJSON<{ items: StaffOrderRow[] }>('/api/v1/dashboard/staff-orders', { query })
  return data.items
}

export type DailyCompletedPoint = {
  date: string
  count: number
}

export type PickingOrderStats = {
  date_from: string
  date_to: string
  completed_today: number
  completed_in_period: number
  days_in_period: number
  avg_completed_per_day: number
  daily?: DailyCompletedPoint[]
}

export async function getPickingOrderStats(params?: {
  date_from?: string
  date_to?: string
  avg_all_time?: boolean
}): Promise<PickingOrderStats> {
  const query: Record<string, string> = {}
  if (params?.date_from) query.date_from = params.date_from
  if (params?.date_to) query.date_to = params.date_to
  if (params?.avg_all_time) query.avg_all_time = 'true'
  return fetchJSON<PickingOrderStats>('/api/v1/dashboard/picking-order-stats', { query })
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
    order_number: item.order_number ?? undefined,
    status: item.status,
    picked: item.lines_picked,
    total: item.lines_total,
    picker_name: item.picker_name ?? undefined,
    controller_name: item.controller_name ?? undefined,
    updated_at: item.updated_at,
  }))
}
