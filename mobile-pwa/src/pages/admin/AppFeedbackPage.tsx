import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Filter, RefreshCw, Star, X } from 'lucide-react'

import { AdminDataTable, type AdminDataTableColumn } from '../../admin/components/AdminDataTable'
import { AdminLayout } from '../../admin/components/AdminLayout'
import { AdminTablePagination } from '../../admin/components/AdminTablePagination'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { DateInput } from '../../components/DateInput'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import { formatUnknownError } from '../../lib/formatUnknownError'
import { listAppFeedback, type AppFeedbackRecord, type AppFeedbackStats } from '../../services/appFeedbackApi'

const PAGE_SIZE = 50

const ROLE_VALUES = ['picker', 'controller', 'warehouse_admin', 'supervisor', 'inventory_controller'] as const
const MODULE_VALUES = ['picking', 'returns', 'inventory', 'receiving', 'general'] as const

function formatRating(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toFixed(2)
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function renderStars(rating: number): ReactNode {
  return (
    <span className="inline-flex items-center gap-0.5 tabular-nums">
      <Star size={14} className="fill-amber-400 text-amber-400" />
      {rating}
    </span>
  )
}

export function AppFeedbackPage() {
  const { t } = useTranslation(['admin', 'common', 'receiving'])
  const [searchParams, setSearchParams] = useSearchParams()
  const { showError } = useAppToast()

  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadError, setHasLoadError] = useState(false)
  const [rows, setRows] = useState<AppFeedbackRecord[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<AppFeedbackStats>({
    average_rating: null,
    picker_average: null,
    controller_average: null,
    total_count: 0,
  })
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)

  const role = searchParams.get('role') ?? ''
  const module = searchParams.get('module') ?? ''
  const rating = searchParams.get('rating') ?? ''
  const dateFrom = searchParams.get('date_from') ?? ''
  const dateTo = searchParams.get('date_to') ?? ''
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10))

  const [filterRole, setFilterRole] = useState(role)
  const [filterModule, setFilterModule] = useState(module)
  const [filterRating, setFilterRating] = useState(rating)
  const [filterDateFrom, setFilterDateFrom] = useState(dateFrom)
  const [filterDateTo, setFilterDateTo] = useState(dateTo)

  useEffect(() => {
    setFilterRole(role)
    setFilterModule(module)
    setFilterRating(rating)
    setFilterDateFrom(dateFrom)
    setFilterDateTo(dateTo)
  }, [role, module, rating, dateFrom, dateTo])

  const load = useCallback(async () => {
    setIsLoading(true)
    setHasLoadError(false)
    try {
      const data = await listAppFeedback({
        role: role || undefined,
        module: module || undefined,
        rating: rating ? parseInt(rating, 10) : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setRows(data.items)
      setTotal(data.total)
      setStats(data.stats)
    } catch (err) {
      showError(`${t('admin:app_feedback.load_error')}: ${formatUnknownError(err)}`)
      setHasLoadError(true)
    } finally {
      setIsLoading(false)
    }
  }, [role, module, rating, dateFrom, dateTo, offset, showError, t])

  useEffect(() => {
    void load()
  }, [load])

  const applyFilters = () => {
    const next = new URLSearchParams()
    if (filterRole) next.set('role', filterRole)
    if (filterModule) next.set('module', filterModule)
    if (filterRating) next.set('rating', filterRating)
    if (filterDateFrom) next.set('date_from', filterDateFrom)
    if (filterDateTo) next.set('date_to', filterDateTo)
    next.set('offset', '0')
    setSearchParams(next)
  }

  const clearFilters = () => {
    setFilterRole('')
    setFilterModule('')
    setFilterRating('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setSearchParams(new URLSearchParams())
  }

  const tableColumns = useMemo((): AdminDataTableColumn<AppFeedbackRecord>[] => {
    return [
      {
        id: 'created_at',
        header: t('admin:app_feedback.columns.created_at'),
        cell: (row) => formatDateTime(row.created_at),
      },
      {
        id: 'user',
        header: t('admin:app_feedback.columns.user'),
        cell: (row) => row.full_name?.trim() || row.username || row.user_id,
      },
      {
        id: 'rating',
        header: t('admin:app_feedback.columns.rating'),
        cell: (row) => renderStars(row.rating),
      },
      {
        id: 'role',
        header: t('admin:app_feedback.columns.role'),
        cell: (row) => t(`admin:app_feedback.roles.${row.role}`, row.role),
      },
      {
        id: 'module',
        header: t('admin:app_feedback.columns.module'),
        cell: (row) => t(`admin:app_feedback.modules.${row.module}`, row.module),
      },
      {
        id: 'comment',
        header: t('admin:app_feedback.columns.comment'),
        cell: (row) => (
          <span className="block max-w-[20rem] truncate" title={row.comment ?? undefined}>
            {row.comment?.trim() || '—'}
          </span>
        ),
      },
      {
        id: 'platform',
        header: t('admin:app_feedback.columns.platform'),
        cell: (row) => row.platform ?? '—',
      },
      {
        id: 'app_version',
        header: t('admin:app_feedback.columns.app_version'),
        cell: (row) => row.app_version ?? '—',
      },
    ]
  }, [t])

  const hasActiveFilters = Boolean(role || module || rating || dateFrom || dateTo)

  return (
    <AdminLayout title={t('admin:app_feedback.title')}>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">{t('admin:app_feedback.stats.average')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatRating(stats.average_rating)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">{t('admin:app_feedback.stats.picker')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatRating(stats.picker_average)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">{t('admin:app_feedback.stats.controller')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatRating(stats.controller_average)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">{t('admin:app_feedback.stats.total')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{stats.total_count}</p>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant={hasActiveFilters ? 'default' : 'outline'}
          onClick={() => setFilterPanelOpen((v) => !v)}
        >
          <Filter size={16} className="mr-1.5" />
          {t('admin:app_feedback.filter_btn')}
        </Button>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={isLoading}>
          <RefreshCw size={16} className={`mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
          {t('common:buttons.refresh')}
        </Button>
      </div>

      {filterPanelOpen && (
        <Card className="mb-4 space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">{t('admin:app_feedback.filter_panel_title')}</h3>
            <Button type="button" variant="ghost" onClick={() => setFilterPanelOpen(false)}>
              <X size={18} />
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">{t('admin:app_feedback.filter_role')}</span>
              <select
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
              >
                <option value="">{t('admin:app_feedback.filter_all')}</option>
                {ROLE_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {t(`admin:app_feedback.roles.${v}`, v)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">{t('admin:app_feedback.filter_module')}</span>
              <select
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={filterModule}
                onChange={(e) => setFilterModule(e.target.value)}
              >
                <option value="">{t('admin:app_feedback.filter_all')}</option>
                {MODULE_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {t(`admin:app_feedback.modules.${v}`, v)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">{t('admin:app_feedback.filter_rating')}</span>
              <select
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={filterRating}
                onChange={(e) => setFilterRating(e.target.value)}
              >
                <option value="">{t('admin:app_feedback.filter_all')}</option>
                {[5, 4, 3, 2, 1].map((v) => (
                  <option key={v} value={String(v)}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">{t('admin:app_feedback.filter_date_from')}</span>
              <DateInput value={filterDateFrom} onChange={setFilterDateFrom} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">{t('admin:app_feedback.filter_date_to')}</span>
              <DateInput value={filterDateTo} onChange={setFilterDateTo} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={applyFilters}>
              {t('receiving:filter_apply')}
            </Button>
            <Button type="button" variant="outline" onClick={clearFilters}>
              {t('common:buttons.clear')}
            </Button>
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="relative min-h-[240px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      ) : hasLoadError ? (
        <EmptyState
          title={t('admin:app_feedback.load_error')}
          actionLabel={t('common:buttons.retry')}
          onAction={() => void load()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Star size={32} />}
          title={t('admin:app_feedback.empty_title')}
          description={t('admin:app_feedback.empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={() => void load()}
        />
      ) : (
        <>
          <AdminDataTable
            columns={tableColumns}
            rows={rows}
            getRowKey={(row) => row.id}
            minWidth="min-w-[64rem]"
          />
          <AdminTablePagination
            total={total}
            pageSize={PAGE_SIZE}
            offset={offset}
            onPrev={() =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev)
                next.set('offset', String(Math.max(0, offset - PAGE_SIZE)))
                return next
              })
            }
            onNext={() =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev)
                next.set('offset', String(offset + PAGE_SIZE))
                return next
              })
            }
            nextDisabled={offset + PAGE_SIZE >= total}
          />
        </>
      )}
    </AdminLayout>
  )
}
