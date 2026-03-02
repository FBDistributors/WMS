import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Package, ClipboardList, SearchCheck, PackageCheck, LayoutGrid } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { KpiCard } from '../../admin/components/KpiCard'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getOrdersByStatus, getPickerPerformance, type PickerPerformanceRow } from '../../services/dashboardApi'

// Yangi = Smartupdan kelgan, admin yig'uvchiga yubormagan
const STATUS_XOM = ['imported', 'B#S']
// Yig'ishda = admin yuborgan, yig'uvchi yig'ib controllerga yubormagan (allocated → picking)
const STATUS_YIGISHDA = ['allocated', 'ready_for_picking', 'picking']
// Tekshiruvda = yig'uvchi controllerga yuborgan, controller yakunlamagan
const STATUS_TEKSHIRUVDA = ['picked']
// Yakunlangan = controller tekshirib yakunlagan
const STATUS_YAKUNLANGAN = ['packed', 'shipped']

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

export function DashboardPage() {
  const { t } = useTranslation(['admin', 'common'])
  const navigate = useNavigate()
  const [ordersByStatus, setOrdersByStatus] = useState<{ status: string; count: number }[]>([])
  const [pickerPerformance, setPickerPerformance] = useState<PickerPerformanceRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const counts = useMemo(() => aggregateByFourGroups(ordersByStatus), [ordersByStatus])
  const totalOrders = counts.xom + counts.yigishda + counts.tekshiruvda + counts.yakunlangan

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [ordersByStatusData, pickerData] = await Promise.all([
        getOrdersByStatus().catch(() => []),
        getPickerPerformance().catch(() => []),
      ])
      setOrdersByStatus(Array.isArray(ordersByStatusData) ? ordersByStatusData : [])
      const sorted = Array.isArray(pickerData)
        ? [...pickerData].sort((a, b) => b.documents_count - a.documents_count)
        : []
      setPickerPerformance(sorted)
    } catch {
      setError(t('admin:dashboard.load_error'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

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
                <div className="h-24 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700" />
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
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t('admin:dashboard.pickers_orders_title')}
            </div>
            <div className="mt-3 overflow-x-auto">
              {isLoading ? (
                <div className="h-24 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700" />
              ) : pickerPerformance.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('admin:dashboard.pickers_empty')}
                </p>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                        #
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                        {t('admin:dashboard.worker_column')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
                        {t('admin:dashboard.orders_picked_column')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pickerPerformance.map((row, index) => (
                      <tr
                        key={row.picker_id}
                        className="border-b border-slate-100 dark:border-slate-800"
                      >
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                          {index + 1}
                        </td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                          {row.picker_name}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-slate-900 dark:text-slate-100">
                          {row.documents_count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </>
      )}
    </AdminLayout>
  )
}
