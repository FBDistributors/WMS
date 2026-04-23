import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { Package, ClipboardList, SearchCheck, PackageCheck, LayoutGrid } from 'lucide-react'

import { ActivePickList } from '../../admin/components/ActivePickList'
import { AdminLayout } from '../../admin/components/AdminLayout'
import { KpiCard } from '../../admin/components/KpiCard'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import {
  getOrdersByStatus,
  getPickDocuments,
  getPickingStaffStats,
  type PickingStaffStatsRow,
} from '../../services/dashboardApi'
import type { ActivePick } from '../../types/dashboard'

// Yangi = Smartupdan kelgan, admin yig'uvchiga yubormagan
const STATUS_XOM = ['imported', 'B#W']
// Yig'ishda = admin yuborgan, yig'uvchi yig'ib controllerga yubormagan (allocated → picking)
const STATUS_YIGISHDA = ['allocated', 'ready_for_picking', 'picking']
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
  const { t } = useTranslation(['admin', 'common'])
  const navigate = useNavigate()
  const [ordersByStatus, setOrdersByStatus] = useState<{ status: string; count: number }[]>([])
  const [pickerRows, setPickerRows] = useState<PickingStaffStatsRow[]>([])
  const [controllerRows, setControllerRows] = useState<PickingStaffStatsRow[]>([])
  const [activePicks, setActivePicks] = useState<ActivePick[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const counts = useMemo(() => aggregateByFourGroups(ordersByStatus), [ordersByStatus])
  const totalOrders = counts.xom + counts.yigishda + counts.tekshiruvda + counts.yakunlangan

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [ordersByStatusData, staffData, picksData] = await Promise.all([
        getOrdersByStatus().catch(() => []),
        getPickingStaffStats({
          date_from: dateFrom.trim() || undefined,
          date_to: dateTo.trim() || undefined,
        }).catch(() => ({ pickers: [], controllers: [] })),
        getPickDocuments({ limit: 12, offset: 0 }).catch(() => []),
      ])
      setOrdersByStatus(Array.isArray(ordersByStatusData) ? ordersByStatusData : [])
      setPickerRows(Array.isArray(staffData?.pickers) ? staffData.pickers : [])
      setControllerRows(Array.isArray(staffData?.controllers) ? staffData.controllers : [])
      setActivePicks(Array.isArray(picksData) ? picksData : [])
    } catch {
      setError(t('admin:dashboard.load_error'))
    } finally {
      setIsLoading(false)
    }
  }, [t, dateFrom, dateTo])

  useEffect(() => {
    void load()
  }, [load])

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
              href="/admin/order-statuses?group=yigishda"
            />
            <KpiCard
              title={t('admin:dashboard.status_tekshiruvda')}
              value={isLoading ? '—' : counts.tekshiruvda}
              icon={SearchCheck}
              href="/admin/order-statuses?group=tekshiruvda"
            />
            <KpiCard
              title={t('admin:dashboard.status_yakunlangan')}
              value={isLoading ? '—' : counts.yakunlangan}
              icon={PackageCheck}
              href="/admin/order-statuses?group=yakunlangan"
            />
            <KpiCard
              title={t('admin:dashboard.status_barcha')}
              value={isLoading ? '—' : totalOrders}
              icon={LayoutGrid}
            />
          </div>

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
                          : `/admin/order-statuses?group=${row.key}`
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
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t('admin:dashboard.active_pick_documents_title')}
              </div>
              <Link
                to="/admin/picking"
                className="inline-flex shrink-0 items-center justify-center rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                {t('admin:dashboard.view_all_picking')}
              </Link>
            </div>
            {isLoading ? (
              <div className="relative min-h-[6rem]">
                <LoadingOverlay label={t('common:messages.loading')} />
              </div>
            ) : (
              <ActivePickList items={activePicks} onOpen={(id) => navigate(`/picking/mobile-pwa/${id}`)} />
            )}
          </Card>

          <Card className="mt-6">
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t('admin:dashboard.staff_stats_title')}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('admin:dashboard.staff_stats_hint')}</p>
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
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                onClick={() => {
                  setDateFrom('')
                  setDateTo('')
                }}
              >
                {t('admin:dashboard.staff_stats_clear')}
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
