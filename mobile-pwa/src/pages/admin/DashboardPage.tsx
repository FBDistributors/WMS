import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Package, ClipboardList, SearchCheck, PackageCheck, Boxes } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { KpiCard } from '../../admin/components/KpiCard'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getDashboardSummary, getOrdersByStatus } from '../../services/dashboardApi'
import type { DashboardSummary } from '../../types/dashboard'

const STATUS_XOM = ['imported', 'B#S', 'allocated', 'ready_for_picking']
const STATUS_YIGISHDA = ['picking']
const STATUS_TEKSHIRUVDA = ['picked']
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
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [ordersByStatus, setOrdersByStatus] = useState<{ status: string; count: number }[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const counts = useMemo(() => aggregateByFourGroups(ordersByStatus), [ordersByStatus])

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [summaryData, ordersByStatusData] = await Promise.all([
        getDashboardSummary(),
        getOrdersByStatus().catch(() => []),
      ])
      setSummary(summaryData)
      setOrdersByStatus(Array.isArray(ordersByStatusData) ? ordersByStatusData : [])
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
  ]

  return (
    <AdminLayout title={t('admin:dashboard.title')}>
      {error ? (
        <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              title={t('admin:dashboard.status_xom')}
              value={isLoading ? '—' : counts.xom}
              icon={Package}
              href="/admin/orders"
            />
            <KpiCard
              title={t('admin:dashboard.status_yigishda')}
              value={isLoading ? '—' : counts.yigishda}
              icon={ClipboardList}
              href="/admin/orders"
            />
            <KpiCard
              title={t('admin:dashboard.status_tekshiruvda')}
              value={isLoading ? '—' : counts.tekshiruvda}
              icon={SearchCheck}
              href="/admin/orders"
            />
            <KpiCard
              title={t('admin:dashboard.status_yakunlangan')}
              value={isLoading ? '—' : counts.yakunlangan}
              icon={PackageCheck}
              href="/admin/orders"
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
                    {statusRows.map((row) => (
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
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <KpiCard
              title={t('admin:dashboard.low_stock')}
              value={summary?.lowStock ?? '—'}
              delta={summary?.deltas?.lowStock}
              icon={Boxes}
              href="/admin/inventory"
            />
          </div>
        </>
      )}
    </AdminLayout>
  )
}
