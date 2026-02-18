import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ShoppingCart,
  PackageCheck,
  ClipboardList,
  Users,
  Boxes,
} from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { KpiCard } from '../../admin/components/KpiCard'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getDashboardSummary, getOrdersByStatus } from '../../services/dashboardApi'
import type { DashboardSummary } from '../../types/dashboard'

export function DashboardPage() {
  const { t } = useTranslation(['admin', 'common', 'orders'])
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [ordersByStatus, setOrdersByStatus] = useState<{ status: string; count: number }[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <AdminLayout title={t('admin:dashboard.title')}>
      {error ? (
        <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title={t('admin:dashboard.total_orders')}
              value={summary?.totalOrders ?? '—'}
              delta={summary?.deltas?.totalOrders}
              icon={ShoppingCart}
              href="/admin/orders"
            />
            <KpiCard
              title={t('admin:dashboard.completed_today')}
              value={summary?.completedToday ?? '—'}
              delta={summary?.deltas?.completedToday}
              icon={PackageCheck}
              href="/admin/orders?status=shipped"
            />
            <KpiCard
              title={t('admin:dashboard.in_picking')}
              value={summary?.inPicking ?? '—'}
              delta={summary?.deltas?.inPicking}
              icon={ClipboardList}
              href="/admin/orders?status=picking"
            />
            <KpiCard
              title={t('admin:dashboard.active_pickers')}
              value={summary?.activePickers ?? '—'}
              delta={summary?.deltas?.activePickers}
              icon={Users}
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
                    {ordersByStatus
                      .filter((row) => row.status !== 'B#S')
                      .map((row) => (
                        <tr
                          key={row.status}
                          className="border-b border-slate-100 dark:border-slate-800"
                        >
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            {t(`orders:status.${row.status}`, row.status)}
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
