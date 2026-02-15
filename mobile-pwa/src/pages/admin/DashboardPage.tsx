import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ShoppingCart,
  PackageCheck,
  ClipboardList,
  Users,
  AlertTriangle,
  Boxes,
} from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { KpiCard } from '../../admin/components/KpiCard'
import { ActivePickList } from '../../admin/components/ActivePickList'
import { ExceptionsList } from '../../admin/components/ExceptionsList'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  getActivePicks,
  getDashboardSummary,
  getExceptions,
  getTodayOverview,
} from '../../services/dashboardApi.mock'
import type { ActivePick, DashboardSummary, ExceptionItem, TodayOverviewItem } from '../../types/dashboard'

export function DashboardPage() {
  const { t } = useTranslation(['admin', 'common'])
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [activePicks, setActivePicks] = useState<ActivePick[]>([])
  const [overview, setOverview] = useState<TodayOverviewItem[]>([])
  const [exceptions, setExceptions] = useState<ExceptionItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [summaryData, picksData, overviewData, exceptionsData] = await Promise.all([
        getDashboardSummary(),
        getActivePicks(),
        getTodayOverview(),
        getExceptions(),
      ])
      setSummary(summaryData)
      setActivePicks(picksData)
      setOverview(overviewData)
      setExceptions(exceptionsData)
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
              href="/admin/picking"
            />
            <KpiCard
              title={t('admin:dashboard.in_picking')}
              value={summary?.inPicking ?? '—'}
              delta={summary?.deltas?.inPicking}
              icon={ClipboardList}
              href="/admin/picking"
            />
            <KpiCard
              title={t('admin:dashboard.active_pickers')}
              value={summary?.activePickers ?? '—'}
              delta={summary?.deltas?.activePickers}
              icon={Users}
              href="/admin/picking"
            />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <KpiCard
              title={t('admin:dashboard.exceptions')}
              value={summary?.exceptions ?? '—'}
              delta={summary?.deltas?.exceptions}
              icon={AlertTriangle}
              href="/admin/exceptions"
            />
            <KpiCard
              title={t('admin:dashboard.low_stock')}
              value={summary?.lowStock ?? '—'}
              delta={summary?.deltas?.lowStock}
              icon={Boxes}
              href="/admin/inventory"
            />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Card>
              <div className="text-base font-semibold text-slate-900">
                {t('admin:dashboard.active_picks')}
              </div>
              <div className="mt-3">
                {isLoading ? (
                  <div className="h-28 animate-pulse rounded-2xl bg-slate-200" />
                ) : (
                  <ActivePickList items={activePicks} onOpen={() => {}} />
                )}
              </div>
            </Card>
            <Card>
              <div className="text-base font-semibold text-slate-900">
                {t('admin:dashboard.today_overview')}
              </div>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                {overview.length === 0 && !isLoading ? (
                  <div>{t('common:messages.no_activity')}</div>
                ) : (
                  overview.map((item) => (
                    <div key={item.id} className="flex items-center justify-between">
                      <span>{item.label}</span>
                      <span className="font-semibold text-slate-900">{item.value}</span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>

          <div className="mt-6">
            <div className="text-base font-semibold text-slate-900 mb-3">Exceptions</div>
            {isLoading ? (
              <div className="h-28 animate-pulse rounded-2xl bg-slate-200" />
            ) : (
              <ExceptionsList items={exceptions} onView={() => {}} />
            )}
          </div>
        </>
      )}
    </AdminLayout>
  )
}
