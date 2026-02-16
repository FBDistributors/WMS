import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Play, CheckCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  getWaves,
  createWave,
  startWave,
  completeWave,
  type WaveOut,
  type WavesQuery,
} from '../../services/wavesApi'
import { getOrders } from '../../services/ordersApi'
import { CreateWaveModal } from '../../admin/components/waves/CreateWaveModal'
import { useAuth } from '../../rbac/AuthProvider'

const PAGE_SIZE = 30
const ELIGIBLE_STATUSES = new Set(['imported', 'B#S', 'ready_for_picking', 'allocated'])

export function WavesPage() {
  const { t } = useTranslation(['admin', 'common'])
  const navigate = useNavigate()
  const { has } = useAuth()

  const [items, setItems] = useState<WaveOut[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [actionWaveId, setActionWaveId] = useState<string | null>(null)

  const canCreate = has('waves:create')
  const canManage = has('waves:manage')

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const query: WavesQuery = { limit: PAGE_SIZE, offset }
      if (statusFilter) query.status = statusFilter
      const data = await getWaves(query)
      setItems(data.items)
      setTotal(data.total)
    } catch {
      setError(t('admin:waves.load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [offset, statusFilter, t])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = useCallback(
    async (orderIds: string[], note?: string) => {
      if (!canCreate || orderIds.length === 0) return
      try {
        const wave = await createWave({ order_ids: orderIds, note: note || undefined })
        setCreateModalOpen(false)
        void load()
        navigate(`/admin/waves/${wave.id}`)
      } catch {
        setError(t('admin:waves.create_failed'))
      }
    },
    [canCreate, load, navigate, t]
  )

  const handleStart = useCallback(
    async (waveId: string) => {
      if (!canManage) return
      setActionWaveId(waveId)
      try {
        await startWave(waveId)
        void load()
      } catch {
        setError(t('admin:waves.start_failed'))
      } finally {
        setActionWaveId(null)
      }
    },
    [canManage, load, t]
  )

  const handleComplete = useCallback(
    async (waveId: string) => {
      if (!canManage) return
      setActionWaveId(waveId)
      try {
        await completeWave(waveId)
        void load()
      } catch {
        setError(t('admin:waves.complete_failed'))
      } finally {
        setActionWaveId(null)
      }
    },
    [canManage, load, t]
  )

  const statusLabel = (s: string) =>
    t(`admin:waves.status.${s.toLowerCase()}`, s)

  const content = () => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
    }
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('admin:waves.empty')}
          description={t('admin:waves.empty_desc')}
          actionLabel={canCreate ? t('admin:waves.create') : undefined}
          onAction={canCreate ? () => setCreateModalOpen(true) : undefined}
        />
      )
    }
    return (
      <div className="space-y-3">
        {items.map((wave) => (
          <Card
            key={wave.id}
            className="cursor-pointer p-4 transition-shadow hover:shadow-md"
            onClick={() => navigate(`/admin/waves/${wave.id}`)}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {wave.wave_number}
                </div>
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  {t('admin:waves.orders_count', { count: wave.orders.length })} ·{' '}
                  {t('admin:waves.lines_count', { count: wave.lines.length })}
                </div>
                <div className="mt-1">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      wave.status === 'COMPLETED'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
                        : wave.status === 'PICKING' || wave.status === 'SORTING'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
                          : wave.status === 'DRAFT'
                            ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-700'
                    }`}
                  >
                    {statusLabel(wave.status)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                {wave.status === 'DRAFT' && canManage && (
                  <Button
                    className="px-3 py-2 text-xs"
                    onClick={() => handleStart(wave.id)}
                    disabled={actionWaveId === wave.id}
                  >
                    <Play size={14} />
                    {actionWaveId === wave.id ? t('admin:waves.starting') : t('admin:waves.start')}
                  </Button>
                )}
                {wave.status === 'SORTING' && canManage && (
                  <Button
                    className="px-3 py-2 text-xs"
                    onClick={() => handleComplete(wave.id)}
                    disabled={actionWaveId === wave.id}
                  >
                    <CheckCircle size={14} />
                    {actionWaveId === wave.id ? t('admin:waves.completing') : t('admin:waves.complete')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="px-3 py-2 text-xs"
                  onClick={() => navigate(`/admin/waves/${wave.id}`)}
                >
                  <FileText size={14} />
                  {t('admin:waves.details')}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <AdminLayout
      title={t('admin:waves.title')}
      actionSlot={
        canCreate ? (
          <Button onClick={() => setCreateModalOpen(true)}>{t('admin:waves.create')}</Button>
        ) : undefined
      }
    >
      <Card className="space-y-4">
        <div>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t('admin:waves.title')}
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {t('admin:waves.subtitle')}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('orders:filters.status')}
            <select
              className="ml-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={statusFilter ?? 'all'}
              onChange={(e) => {
                setStatusFilter(e.target.value === 'all' ? undefined : e.target.value)
                setOffset(0)
              }}
            >
              <option value="all">All</option>
              <option value="DRAFT">Draft</option>
              <option value="PICKING">Picking</option>
              <option value="SORTING">Sorting</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
        </div>

        <div className="min-h-[200px]">{content()}</div>

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset((p) => Math.max(0, p - PAGE_SIZE))}
          >
            {t('common:buttons.back')}
          </Button>
          <Button
            variant="secondary"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((p) => p + PAGE_SIZE)}
          >
            {t('common:buttons.next')}
          </Button>
        </div>
      </Card>

      <CreateWaveModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onCreate={handleCreate}
        loadOrders={async (dateFrom, dateTo) => {
          const data = await getOrders({
            status: 'B#S',
            date_from: dateFrom,
            date_to: dateTo,
            limit: 200,
          })
          return data.items.filter((o) => ELIGIBLE_STATUSES.has(o.status))
        }}
      />
    </AdminLayout>
  )
}
