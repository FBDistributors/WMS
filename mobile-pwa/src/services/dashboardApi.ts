import { fetchJSON } from './apiClient'
import type { DashboardSummary } from '../types/dashboard'

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
