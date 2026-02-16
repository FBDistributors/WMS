import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Play, CheckCircle, ScanLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  getWave,
  startWave,
  completeWave,
  type WaveOut,
} from '../../services/wavesApi'
import { useAuth } from '../../rbac/AuthProvider'

export function WaveDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation(['admin', 'common'])
  const navigate = useNavigate()
  const { has } = useAuth()

  const [wave, setWave] = useState<WaveOut | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isActioning, setIsActioning] = useState(false)

  const canManage = has('waves:manage')
  const canPick = has('waves:pick')
  const canSort = has('waves:sort')

  const load = useCallback(async () => {
    if (!id) return
    setIsLoading(true)
    setError(null)
    try {
      const w = await getWave(id)
      setWave(w)
    } catch {
      setError(t('admin:waves.load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [id, t])

  useEffect(() => {
    void load()
  }, [load])

  const handleStart = useCallback(async () => {
    if (!id || !canManage) return
    setIsActioning(true)
    try {
      await startWave(id)
      void load()
    } catch {
      setError(t('admin:waves.start_failed'))
    } finally {
      setIsActioning(false)
    }
  }, [id, canManage, load, t])

  const handleComplete = useCallback(async () => {
    if (!id || !canManage) return
    setIsActioning(true)
    try {
      await completeWave(id)
      void load()
    } catch {
      setError(t('admin:waves.complete_failed'))
    } finally {
      setIsActioning(false)
    }
  }, [id, canManage, load, t])

  const statusLabel = (s: string) =>
    t(`admin:waves.status.${s.toLowerCase()}`, s)

  if (isLoading) {
    return (
      <AdminLayout title={t('admin:waves.details')}>
        <div className="h-48 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      </AdminLayout>
    )
  }

  if (error || !wave) {
    return (
      <AdminLayout title={t('admin:waves.details')}>
        <EmptyState
          title={error ?? 'Wave not found'}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      </AdminLayout>
    )
  }

  return (
    <AdminLayout
      title={wave.wave_number}
      actionSlot={
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin/waves')}>
          <ArrowLeft size={18} />
          {t('common:buttons.back')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                  wave.status === 'COMPLETED'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
                    : wave.status === 'PICKING' || wave.status === 'SORTING'
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
                      : wave.status === 'DRAFT'
                        ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        : 'bg-slate-100 text-slate-600'
                }`}
              >
                {statusLabel(wave.status)}
              </span>
              {wave.note && (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{wave.note}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {wave.status === 'DRAFT' && canManage && (
                <Button onClick={handleStart} disabled={isActioning}>
                  <Play size={16} />
                  {isActioning ? t('admin:waves.starting') : t('admin:waves.start')}
                </Button>
              )}
              {wave.status === 'PICKING' && canPick && (
                <Button onClick={() => navigate(`/picker/wave/${wave.id}`)}>
                  <ScanLine size={16} />
                  {t('admin:waves.wave_picking')}
                </Button>
              )}
              {wave.status === 'SORTING' && canSort && (
                <Button onClick={() => navigate(`/picker/wave/${wave.id}/sorting`)}>
                  <ScanLine size={16} />
                  {t('admin:waves.sorting_zone')}
                </Button>
              )}
              {wave.status === 'SORTING' && canManage && (
                <Button variant="secondary" onClick={handleComplete} disabled={isActioning}>
                  <CheckCircle size={16} />
                  {isActioning ? t('admin:waves.completing') : t('admin:waves.complete')}
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">
            {t('admin:waves.orders_count', { count: wave.orders.length })}
          </h3>
          <div className="space-y-1">
            {wave.orders.map((o) => (
              <div
                key={o.id}
                className="flex justify-between rounded-lg px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <span className="font-medium">{o.order_number}</span>
                <span className="text-slate-500">{o.source_external_id}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">
            {t('admin:waves.lines_count', { count: wave.lines.length })}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[400px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-3 py-2 text-left">SKU / Barcode</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Picked</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {wave.lines.map((line) => (
                  <tr key={line.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 font-mono text-xs">{line.barcode}</td>
                    <td className="px-3 py-2">
                      {line.product_name ?? line.product_sku ?? '—'}
                      {line.brand && (
                        <span className="ml-1 text-slate-500">({line.brand})</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{Number(line.total_qty)}</td>
                    <td className="px-3 py-2 text-right">{Number(line.picked_qty)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          line.status === 'PICKED'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/50'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800'
                        }`}
                      >
                        {line.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {wave.lines.some((l) => l.allocations && l.allocations.length > 0) && (
            <div className="mt-4 space-y-2">
              <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">
                FEFO Allocations
              </h4>
              {wave.lines.map((line) =>
                line.allocations && line.allocations.length > 0 ? (
                  <div key={line.id} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                    <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                      {line.barcode}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {line.allocations.map((a) => (
                        <span
                          key={`${a.lot_id}-${a.location_id}`}
                          className="rounded bg-white px-2 py-1 text-xs dark:bg-slate-900"
                        >
                          {a.location_code} · batch {a.batch} · {a.allocated_qty} allocated
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null
              )}
            </div>
          )}
        </Card>

        {wave.bins && wave.bins.length > 0 && (
          <Card className="p-4">
            <h3 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">Bins</h3>
            <div className="flex flex-wrap gap-2">
              {wave.bins.map((b) => (
                <span
                  key={b.id}
                  className={`rounded-full px-3 py-1 text-sm ${
                    b.status === 'DONE'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/50'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800'
                  }`}
                >
                  {b.bin_code}: {b.status}
                </span>
              ))}
            </div>
          </Card>
        )}
      </div>
    </AdminLayout>
  )
}
