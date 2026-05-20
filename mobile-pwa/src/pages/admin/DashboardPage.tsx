import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Package,
  ClipboardList,
  SearchCheck,
  PackageCheck,
  LayoutGrid,
  FileSpreadsheet,
  Loader2,
  CalendarRange,
  TrendingUp,
} from 'lucide-react'
import * as XLSX from 'xlsx'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { KpiCard } from '../../admin/components/KpiCard'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import {
  getOrdersByStatus,
  getPickingOrderStats,
  getPickingStaffStats,
  type PickingOrderStats,
  type PickingStaffStatsRow,
} from '../../services/dashboardApi'
import { getReserveStuckSummary } from '../../services/inventoryApi'
import { writeExcelFile } from '../../utils/exportExcel'

// Yangi = Smartupdan kelgan, admin yig'uvchiga yubormagan
const STATUS_XOM = ['imported']
// Yig'ishda = admin yuborgan, yig'uvchi yig'ib controllerga yubormagan (allocated → picking)
const STATUS_YIGISHDA = ['allocated', 'picking']
// Tekshiruvda = yig'uvchi controllerga yuborgan, controller yakunlamagan
const STATUS_TEKSHIRUVDA = ['picked']
// Yakunlangan = controller tekshirib yakunlagan (completed) yoki packed/shipped
const STATUS_YAKUNLANGAN = ['completed', 'packed', 'shipped']

function aggregateByFourGroups(
  rows: { status: string; count: number }[]
): { xom: number; yigishda: number; tekshiruvda: number; yakunlangan: number } {
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]))
  const sum = (statuses: string[]) => statuses.reduce((acc, s) => acc + (byStatus[s] ?? 0), 0)
  return {
    xom: sum(STATUS_XOM),
    yigishda: sum(STATUS_YIGISHDA),
    tekshiruvda: sum(STATUS_TEKSHIRUVDA),
    yakunlangan: sum(STATUS_YAKUNLANGAN),
  }
}

function formatQty(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatAvgPerDay(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

/** Excel worksheet name: max 31 chars, no \\ / ? * [ ] : */
function sheetNameSafe(label: string): string {
  const cleaned = label.replace(/[:\\/?*[\]]/g, ' ').trim()
  return (cleaned.slice(0, 31) || 'Sheet').trim()
}

function StaffStatsTable({
  rows,
  isLoading,
  emptyLabel,
  t,
}: {
  rows: PickingStaffStatsRow[]
  isLoading: boolean
  emptyLabel: string
  t: (key: string) => string
}) {
  if (isLoading) {
    return (
      <div className="relative min-h-[6rem]">
        <LoadingOverlay label={t('common:messages.loading')} />
      </div>
    )
  }
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{emptyLabel}</p>
  }
  return (
    <table className="min-w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 dark:border-slate-700">
          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
            {t('admin:dashboard.staff_col_rank')}
          </th>
          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
            {t('admin:dashboard.staff_col_name')}
          </th>
          <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
            {t('admin:dashboard.staff_col_orders')}
          </th>
          <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
            {t('admin:dashboard.staff_col_lines')}
          </th>
          <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
            {t('admin:dashboard.staff_col_qty')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.user_id} className="border-b border-slate-100 dark:border-slate-800">
            <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{index + 1}</td>
            <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.full_name}</td>
            <td className="px-3 py-2 text-right font-medium text-slate-900 dark:text-slate-100">
              {row.documents_count}
            </td>
            <td className="px-3 py-2 text-right text-slate-800 dark:text-slate-200">{row.lines_count}</td>
            <td className="px-3 py-2 text-right font-medium text-slate-900 dark:text-slate-100">
              {formatQty(row.total_picked_qty)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function DashboardPage() {
  const { t } = useTranslation(['admin', 'common', 'inventory'])
  const navigate = useNavigate()
  const [ordersByStatus, setOrdersByStatus] = useState<{ status: string; count: number }[]>([])
  const [pickerRows, setPickerRows] = useState<PickingStaffStatsRow[]>([])
  const [controllerRows, setControllerRows] = useState<PickingStaffStatsRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState(todayIsoDate)
  const [dateTo, setDateTo] = useState(todayIsoDate)
  const [pickingOrderStats, setPickingOrderStats] = useState<PickingOrderStats | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [stuckRowsCount, setStuckRowsCount] = useState(0)
  const [stuckOrdersCount, setStuckOrdersCount] = useState(0)
  const [stuckOldestHours, setStuckOldestHours] = useState(0)

  const counts = useMemo(() => aggregateByFourGroups(ordersByStatus), [ordersByStatus])
  const totalOrders = counts.xom + counts.yigishda + counts.tekshiruvda + counts.yakunlangan

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const dateFromQ = dateFrom.trim() || undefined
      const dateToQ = dateTo.trim() || undefined
      const [ordersByStatusData, staffData, pickingStats, stuckMain, stuckShowroom] = await Promise.all([
        getOrdersByStatus().catch(() => []),
        getPickingStaffStats({
          date_from: dateFromQ,
          date_to: dateToQ,
        }).catch(() => ({ pickers: [], controllers: [] })),
        getPickingOrderStats({
          date_from: dateFromQ,
          date_to: dateToQ,
        }),
        getReserveStuckSummary({ warehouse: 'main', age_hours: 48, sample_limit: 3 }).catch(
          () => null,
        ),
        getReserveStuckSummary({ warehouse: 'showroom', age_hours: 48, sample_limit: 3 }).catch(
          () => null,
        ),
      ])
      setOrdersByStatus(Array.isArray(ordersByStatusData) ? ordersByStatusData : [])
      setPickerRows(Array.isArray(staffData?.pickers) ? staffData.pickers : [])
      setControllerRows(Array.isArray(staffData?.controllers) ? staffData.controllers : [])
      setPickingOrderStats(pickingStats)
      const stuckTotal = (stuckMain?.stuck_rows_count ?? 0) + (stuckShowroom?.stuck_rows_count ?? 0)
      const stuckOrders =
        (stuckMain?.stuck_orders_count ?? 0) + (stuckShowroom?.stuck_orders_count ?? 0)
      const oldest = Math.max(stuckMain?.oldest_hours ?? 0, stuckShowroom?.oldest_hours ?? 0)
      setStuckRowsCount(stuckTotal)
      setStuckOrdersCount(stuckOrders)
      setStuckOldestHours(oldest)
    } catch {
      setError(t('admin:dashboard.load_error'))
      setStuckRowsCount(0)
      setStuckOrdersCount(0)
      setStuckOldestHours(0)
      setPickingOrderStats(null)
    } finally {
      setIsLoading(false)
    }
  }, [t, dateFrom, dateTo])

  const resetStatsDatesToToday = () => {
    const today = todayIsoDate()
    setDateFrom(today)
    setDateTo(today)
  }

  useEffect(() => {
    void load()
  }, [load])

  const staffStatsExportDisabled =
    isLoading || isExporting || (pickerRows.length === 0 && controllerRows.length === 0)

  const handleExportStaffStatsExcel = useCallback(async () => {
    if (pickerRows.length === 0 && controllerRows.length === 0) return
    setIsExporting(true)
    try {
      const headers = [
        t('admin:dashboard.staff_col_rank'),
        t('admin:dashboard.staff_col_name'),
        t('admin:dashboard.staff_col_orders'),
        t('admin:dashboard.staff_col_lines'),
        t('admin:dashboard.staff_col_qty'),
      ]
      const rowsToAoA = (rows: PickingStaffStatsRow[]) =>
        rows.map((row, index) => [
          index + 1,
          row.full_name,
          row.documents_count,
          row.lines_count,
          row.total_picked_qty,
        ])

      const wb = XLSX.utils.book_new()
      if (pickerRows.length > 0) {
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rowsToAoA(pickerRows)])
        XLSX.utils.book_append_sheet(wb, ws, sheetNameSafe(t('admin:dashboard.pickers_table_title')))
      }
      if (controllerRows.length > 0) {
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rowsToAoA(controllerRows)])
        XLSX.utils.book_append_sheet(wb, ws, sheetNameSafe(t('admin:dashboard.controllers_table_title')))
      }

      const day = new Date().toISOString().slice(0, 10)
      const fromPart = dateFrom.trim() ? dateFrom.trim() : 'all'
      const toPart = dateTo.trim() ? dateTo.trim() : 'all'
      const fileName = `picking_staff_stats_${fromPart}_${toPart}_${day}.xlsx`

      await writeExcelFile(wb, fileName)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      window.alert(`${t('admin:dashboard.staff_stats_export_failed')}\n\n${msg}`)
    } finally {
      setIsExporting(false)
    }
  }, [t, pickerRows, controllerRows, dateFrom, dateTo])

  const statusRows = [
    { key: 'xom' as const, labelKey: 'admin:dashboard.status_xom', count: counts.xom },
    { key: 'yigishda' as const, labelKey: 'admin:dashboard.status_yigishda', count: counts.yigishda },
    { key: 'tekshiruvda' as const, labelKey: 'admin:dashboard.status_tekshiruvda', count: counts.tekshiruvda },
    { key: 'yakunlangan' as const, labelKey: 'admin:dashboard.status_yakunlangan', count: counts.yakunlangan },
    { key: 'barcha' as const, labelKey: 'admin:dashboard.status_barcha', count: totalOrders },
  ]

  return (
    <AdminLayout title={t('admin:dashboard.title')}>
      {error ? (
        <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard
              title={t('admin:dashboard.status_xom')}
              value={isLoading ? '—' : counts.xom}
              icon={Package}
              href="/admin/orders?group=xom"
            />
            <KpiCard
              title={t('admin:dashboard.status_yigishda')}
              value={isLoading ? '—' : counts.yigishda}
              icon={ClipboardList}
              href="/admin/picking?group=yigishda"
            />
            <KpiCard
              title={t('admin:dashboard.status_tekshiruvda')}
              value={isLoading ? '—' : counts.tekshiruvda}
              icon={SearchCheck}
              href="/admin/picking?group=tekshiruvda"
            />
            <KpiCard
              title={t('admin:dashboard.status_yakunlangan')}
              value={isLoading ? '—' : counts.yakunlangan}
              icon={PackageCheck}
              href="/admin/picking/archive?group=yakunlangan"
            />
            <KpiCard
              title={t('admin:dashboard.status_barcha')}
              value={isLoading ? '—' : totalOrders}
              icon={LayoutGrid}
            />
          </div>
          <Card className="mt-6">
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t('admin:dashboard.picking_stats_title')}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('admin:dashboard.picking_stats_hint')}
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
                <span>{t('admin:dashboard.staff_stats_date_from')}</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
                <span>{t('admin:dashboard.staff_stats_date_to')}</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <Button type="button" variant="secondary" className="shrink-0" onClick={resetStatsDatesToToday}>
                {t('admin:dashboard.staff_stats_clear')}
              </Button>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <KpiCard
                title={t('admin:dashboard.picking_stats_today')}
                value={isLoading ? '—' : (pickingOrderStats?.completed_today ?? 0)}
                icon={PackageCheck}
                href="/admin/picking/archive?group=yakunlangan"
              />
              <KpiCard
                title={t('admin:dashboard.picking_stats_period')}
                value={isLoading ? '—' : (pickingOrderStats?.completed_in_period ?? 0)}
                delta={
                  pickingOrderStats
                    ? t('admin:dashboard.picking_stats_period_range', {
                        from: pickingOrderStats.date_from,
                        to: pickingOrderStats.date_to,
                      })
                    : undefined
                }
                icon={CalendarRange}
              />
              <KpiCard
                title={t('admin:dashboard.picking_stats_avg_per_day')}
                value={
                  isLoading
                    ? '—'
                    : formatAvgPerDay(pickingOrderStats?.avg_completed_per_day ?? 0)
                }
                delta={
                  pickingOrderStats
                    ? t('admin:dashboard.picking_stats_avg_days', {
                        days: pickingOrderStats.days_in_period,
                      })
                    : undefined
                }
                icon={TrendingUp}
              />
            </div>
          </Card>

          {stuckRowsCount > 0 ? (
            <Card className="mt-4 border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30">
              <button
                type="button"
                className="w-full text-left"
                onClick={() => navigate('/admin/inventory/reserve-health?warehouse=main')}
              >
                <div className="text-sm font-semibold text-rose-900 dark:text-rose-100">
                  {t('inventory:reserve_health.stuck_alert_title', { hours: 48 })}
                </div>
                <div className="mt-1 text-sm text-rose-800 dark:text-rose-200">
                  {t('inventory:reserve_health.stuck_alert_desc', {
                    rows: stuckRowsCount,
                    orders: stuckOrdersCount,
                    oldest: stuckOldestHours,
                  })}
                </div>
              </button>
            </Card>
          ) : null}

          <Card className="mt-6">
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t('admin:dashboard.orders_by_status')}
            </div>
            <div className="mt-3 overflow-x-auto">
              {isLoading ? (
                <div className="relative min-h-[6rem]">
                  <LoadingOverlay label={t('common:messages.loading')} />
                </div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                        {t('admin:dashboard.status_column')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
                        {t('admin:dashboard.count_column')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusRows.map((row) => {
                      if (row.key === 'barcha') {
                        return (
                          <tr
                            key={row.key}
                            className="border-b border-slate-100 dark:border-slate-800"
                          >
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                              {t(row.labelKey)}
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-slate-900 dark:text-slate-100">
                              {row.count}
                            </td>
                          </tr>
                        )
                      }
                      const path =
                        row.key === 'xom'
                          ? '/admin/orders?group=xom'
                          : row.key === 'yakunlangan'
                            ? '/admin/picking/archive?group=yakunlangan'
                            : `/admin/picking?group=${row.key}`
                      return (
                        <tr
                          key={row.key}
                          role="button"
                          tabIndex={0}
                          onClick={() => navigate(path)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              navigate(path)
                            }
                          }}
                          className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                        >
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            {t(row.labelKey)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-slate-900 dark:text-slate-100">
                            {row.count}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </Card>

          <Card className="mt-6">
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t('admin:dashboard.staff_stats_title')}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('admin:dashboard.staff_stats_uses_period_hint')}
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                disabled={staffStatsExportDisabled}
                onClick={() => void handleExportStaffStatsExcel()}
              >
                {isExporting ? (
                  <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden />
                ) : (
                  <FileSpreadsheet className="mr-2 h-4 w-4 shrink-0" aria-hidden />
                )}
                {t('admin:dashboard.staff_stats_export_excel')}
              </Button>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {t('admin:dashboard.staff_stats_sort_hint')}
            </p>

            <div className="relative mt-6 min-h-[4rem] space-y-6">
              {isLoading ? (
                <div className="absolute inset-0 z-10 flex min-h-[8rem] items-center justify-center rounded-xl bg-white/80 dark:bg-slate-950/80">
                  <LoadingOverlay label={t('common:messages.loading')} />
                </div>
              ) : null}
              <div>
                <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                  {t('admin:dashboard.pickers_table_title')}
                </div>
                <div className="overflow-x-auto">
                  <StaffStatsTable
                    rows={pickerRows}
                    isLoading={false}
                    emptyLabel={t('admin:dashboard.staff_stats_empty')}
                    t={t}
                  />
                </div>
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                  {t('admin:dashboard.controllers_table_title')}
                </div>
                <div className="overflow-x-auto">
                  <StaffStatsTable
                    rows={controllerRows}
                    isLoading={false}
                    emptyLabel={t('admin:dashboard.staff_stats_empty')}
                    t={t}
                  />
                </div>
              </div>
            </div>
          </Card>
        </>
      )}
    </AdminLayout>
  )
}
