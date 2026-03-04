import { useCallback, useEffect, useMemo, useState, Fragment } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { DateInput } from '../../components/DateInput'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  getOrikzorMovements,
  syncOrikzorOrders,
  type MovementItem,
  type SmartupSyncResult,
} from '../../services/ordersApi'
import { useAuth } from '../../rbac/AuthProvider'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
function daysAgoISO(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

const PAGE_SIZE = 50

const COLUMNS_DILLER = [
  { id: 'order_number', labelKey: 'orders:columns_diller.order_number' },
  { id: 'external_id', labelKey: 'orders:columns_diller.external_id' },
  { id: 'from_warehouse_code', labelKey: 'orders:columns_diller.from_warehouse_code' },
  { id: 'movement_note', labelKey: 'orders:columns_diller.movement_note' },
  { id: 'total_amount', labelKey: 'orders:columns_diller.total_amount' },
  { id: 'status', labelKey: 'orders:columns_diller.status' },
  { id: 'lines', labelKey: 'orders:columns_diller.lines' },
  { id: 'delivery_date', labelKey: 'orders:columns_diller.delivery_date' },
  { id: 'view_details', labelKey: 'orders:columns_diller.view_details' },
] as const

export function OrikzorHarakatlariPage() {
  const { t } = useTranslation(['orders', 'common', 'admin'])
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { has } = useAuth()
  const canSync = has('orders:write')

  const [movementsData, setMovementsData] = useState<{ movement: MovementItem[]; total?: number } | null>(null)
  const [movementPage, setMovementPage] = useState(0)
  const [dateFrom, setDateFrom] = useState(daysAgoISO(30))
  const [dateTo, setDateTo] = useState(todayISO())
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [syncResult, setSyncResult] = useState<SmartupSyncResult | null>(null)

  const load = useCallback(
    async (background = false, pageOverride?: number) => {
      if (!background) setIsLoading(true)
      else setIsRefreshing(true)
      setError(null)
      const page = pageOverride ?? movementPage
      try {
        const data = await getOrikzorMovements({
          begin_created_on: dateFrom.trim() || undefined,
          end_created_on: dateTo.trim() || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        })
        setMovementsData(data)
        if (pageOverride !== undefined) setMovementPage(pageOverride)
      } catch (err) {
        if (!background) {
          setError(err instanceof Error ? err.message : t('orders:load_failed'))
        }
      } finally {
        if (!background) setIsLoading(false)
        else setIsRefreshing(false)
      }
    },
    [dateFrom, dateTo, movementPage, t]
  )

  useEffect(() => {
    void load()
  }, [load])

  const handleSync = async () => {
    setIsSyncing(true)
    setError(null)
    setSyncResult(null)
    try {
      let begin = dateFrom.trim() || undefined
      let end = dateTo.trim() || undefined
      if (begin && end && begin > end) {
        ;[begin, end] = [end, begin]
      }
      const result = await syncOrikzorOrders({
        begin_deal_date: begin,
        end_deal_date: end,
      })
      setSyncResult(result)
      await load(true)
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string'
          ? (err as { message: string }).message
          : err instanceof Error
            ? err.message
            : t('orders:sync_failed')
      setError(message)
    } finally {
      setIsSyncing(false)
    }
  }

  const movementList = movementsData?.movement ?? []
  const movementTotal = movementsData?.total ?? 0
  const columnLabels = useMemo(
    () => new Map(COLUMNS_DILLER.map((c) => [c.id, t(c.labelKey)])),
    [t]
  )

  const renderCell = (columnId: string, m: MovementItem) => {
    const mid = (m.movement_id as string) ?? '—'
    const barcode = (m.barcode as string) ?? '—'
    const fromWh = (m.from_warehouse_code as string) ?? '—'
    const note = (m.note as string) ?? '—'
    const amount = m.amount != null ? String(m.amount) : '—'
    const status = (m.status as string) ?? '—'
    const items = (m.movement_items as unknown[]) ?? []
    const fromTime = (m.from_time as string) ?? (m.from_movement_date as string) ?? '—'
    switch (columnId) {
      case 'order_number':
        return (
          <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">{mid}</td>
        )
      case 'external_id':
        return (
          <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{barcode}</td>
        )
      case 'from_warehouse_code':
        return (
          <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{fromWh}</td>
        )
      case 'movement_note':
        return (
          <td className="max-w-[200px] truncate px-4 py-3 text-slate-600 dark:text-slate-300" title={note}>
            {note}
          </td>
        )
      case 'total_amount':
        return (
          <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
            {amount === '—' ? '—' : Number(amount).toLocaleString()}
          </td>
        )
      case 'status':
        return (
          <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{status}</td>
        )
      case 'lines':
        return (
          <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{items.length}</td>
        )
      case 'delivery_date':
        return (
          <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{fromTime}</td>
        )
      case 'view_details':
        return (
          <td className="px-4 py-3">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={() =>
                navigate(`/admin/orders-orikzor/${encodeURIComponent(mid)}`, {
                  state: { movement: m, listPath: '/admin/orders-orikzor', listQuery: searchParams.toString() },
                })
              }
              aria-label={t('orders:view_details')}
            >
              <FileText size={18} />
            </button>
          </td>
        )
      default:
        return null
    }
  }

  const content = useMemo(() => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return (
        <EmptyState
          title={error}
          actionLabel={t('common:buttons.retry')}
          onAction={() => load()}
        />
      )
    }
    if (movementList.length === 0 && movementTotal === 0) {
      return (
        <EmptyState
          title={t('orders:empty')}
          description={t('orders:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={() => load()}
        />
      )
    }
    return (
      <TableScrollArea inline>
        <table className="w-max min-w-[600px] text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              {COLUMNS_DILLER.map((col) => (
                <th key={col.id} className="px-4 py-3 text-left">
                  {columnLabels.get(col.id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {movementList.map((m) => (
              <tr
                key={(m.movement_id as string) ?? String(m.barcode ?? '')}
                className="border-b border-slate-100 dark:border-slate-800"
              >
                {COLUMNS_DILLER.map((col) => (
                  <Fragment key={col.id}>{renderCell(col.id, m)}</Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [error, isLoading, movementList, movementTotal, load, columnLabels, navigate, searchParams, t])

  const pageTitle = t('admin:menu.orders_orikzor', "O'rikzor harakatlari")

  return (
    <AdminLayout title={pageTitle}>
      {syncResult ? (
        <Card className="mb-4 border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10">
          {t('orders:sync_result', {
            created: syncResult.created,
            updated: syncResult.updated,
            skipped: syncResult.skipped,
          })}
          {syncResult.detail || syncResult.error ? ` · ${syncResult.error ?? syncResult.detail ?? ''}` : ''}
        </Card>
      ) : null}
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('orders:filters.sync_date_range', "Sana oralig'i")}
          </span>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            {t('orders:filters.date_from', 'Boshlanish')}
            <DateInput value={dateFrom} onChange={setDateFrom} aria-label={t('orders:filters.date_from')} />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            {t('orders:filters.date_to', 'Tugash')}
            <DateInput value={dateTo} onChange={setDateTo} aria-label={t('orders:filters.date_to')} />
          </label>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('orders:sync_date_hint', "Smartup'dagi from_movement_date shu oraliqda bo'lishi kerak.")}
          </span>
          <Button variant="secondary" onClick={() => load()} disabled={isRefreshing} className="shrink-0">
            {t('common:buttons.refresh')}
          </Button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canSync ? (
            <Button onClick={handleSync} disabled={isSyncing} className="w-full md:w-auto">
              {isSyncing ? t('orders:syncing') : t('orders:sync')}
            </Button>
          ) : null}
        </div>
      </div>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <span>{t('orders:subtitle_orikzor')}</span>
          {isRefreshing ? (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
              {t('orders:refreshing')}
            </span>
          ) : null}
          {movementTotal > 0 ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
              {t('orders:movements_loaded', { count: movementTotal })}
            </span>
          ) : null}
        </div>
        {content}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <Button variant="outline" onClick={() => load(true)} disabled={isRefreshing}>
            {t('common:buttons.refresh')}
          </Button>
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <span>
              {movementTotal > 0
                ? `${movementPage * PAGE_SIZE + 1}–${Math.min((movementPage + 1) * PAGE_SIZE, movementTotal)} / ${movementTotal}`
                : '0 / 0'}
            </span>
            <Button
              variant="secondary"
              disabled={movementPage === 0}
              onClick={() => load(false, movementPage - 1)}
            >
              {t('common:buttons.back')}
            </Button>
            <Button
              variant="secondary"
              disabled={(movementPage + 1) * PAGE_SIZE >= movementTotal}
              onClick={() => load(false, movementPage + 1)}
            >
              {t('orders:pagination.next', 'Keyingi')}
            </Button>
          </div>
        </div>
      </Card>
    </AdminLayout>
  )
}
