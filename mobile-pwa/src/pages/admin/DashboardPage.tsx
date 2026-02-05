import { useCallback, useEffect, useState } from 'react'
import {
  ClipboardList,
  CheckCircle2,
  AlertTriangle,
  Boxes,
  PackageCheck,
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
      setError('Dashboard yuklanmadi. Qayta urinib ko‘ring.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <AdminLayout title="Dashboard">
      {error ? (
        <EmptyState title={error} actionLabel="Qayta urinib ko‘rish" onAction={load} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="Open pick lists"
              value={summary?.openPickLists ?? '—'}
              delta={summary?.deltas?.openPickLists}
              icon={ClipboardList}
              href="/admin/picking"
            />
            <KpiCard
              title="Completed today"
              value={summary?.completedToday ?? '—'}
              delta={summary?.deltas?.completedToday}
              icon={PackageCheck}
              href="/admin/picking"
            />
            <KpiCard
              title="Exceptions"
              value={summary?.exceptions ?? '—'}
              delta={summary?.deltas?.exceptions}
              icon={AlertTriangle}
              href="/admin/exceptions"
            />
            <KpiCard
              title="Low stock alerts"
              value={summary?.lowStock ?? '—'}
              delta={summary?.deltas?.lowStock}
              icon={Boxes}
              href="/admin/inventory"
            />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Card>
              <div className="text-base font-semibold text-slate-900">Active picks</div>
              <div className="mt-3">
                {isLoading ? (
                  <div className="h-28 animate-pulse rounded-2xl bg-slate-200" />
                ) : (
                  <ActivePickList items={activePicks} onOpen={() => {}} />
                )}
              </div>
            </Card>
            <Card>
              <div className="text-base font-semibold text-slate-900">Today overview</div>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                {overview.length === 0 && !isLoading ? (
                  <div>No activity yet.</div>
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
