import { useCallback, useEffect, useMemo, useState, Fragment } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getOrders, syncOrikzorOrders, type OrderListItem } from '../../services/ordersApi'
import { useAuth } from '../../rbac/AuthProvider'

const PAGE_SIZE = 50
const COLUMNS = [
  { id: 'order_number', labelKey: 'orders:columns.order_number' },
  { id: 'external_id', labelKey: 'orders:columns.external_id' },
  { id: 'customer', labelKey: 'orders:columns.customer' },
  { id: 'status', labelKey: 'orders:columns.status' },
  { id: 'lines', labelKey: 'orders:columns.lines' },
  { id: 'created', labelKey: 'orders:columns.created' },
  { id: 'picker', labelKey: 'orders:columns.picker' },
  { id: 'controller', labelKey: 'orders:columns.controller' },
  { id: 'view_details', labelKey: 'orders:columns.view_details' },
] as const

export function OrikzorHarakatlariPage() {
  const { t } = useTranslation(['orders', 'common', 'admin'])
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchQuery = searchParams.get('q') ?? ''
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10))
  const { has } = useAuth()
  const canSync = has('orders:sync')

  const [items, setItems] = useState<OrderListItem[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [syncResult, setSyncResult] = useState<{
    created: number
    updated: number
    skipped: number
    detail?: string | null
    errors_count?: number | null
  } | null>(null)

  const load = useCallback(
    async (background = false) => {
      if (!background) setIsLoading(true)
      else setIsRefreshing(true)
      setError(null)
      try {
        const data = await getOrders({
          order_source: 'orikzor',
          q: searchQuery.trim() || undefined,
          search_fields: 'order_number,external_id,customer,customer_id,agent',
          limit: PAGE_SIZE,
          offset,
        })
        setItems(data.items)
        setTotal(data.total)
      } catch (err) {
        if (!background) {
          setError(err instanceof Error ? err.message : t('orders:load_failed'))
        }
      } finally {
        if (!background) setIsLoading(false)
        else setIsRefreshing(false)
      }
    },
    [offset, searchQuery, t]
  )

  useEffect(() => {
    void load()
  }, [load])

  const handleSync = async () => {
    setIsSyncing(true)
    setError(null)
    setSyncResult(null)
    try {
      const result = await syncOrikzorOrders()
      setSyncResult(result)
      await load()
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

  const columnLabels = useMemo(
    () =>
      new Map(
        COLUMNS.map((col) => [
          col.id,
          t(`orders:columns_orikzor.${col.id}`, t(col.labelKey)),
        ])
      ),
    [t]
  )

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
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('orders:empty')}
          description={t('orders:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={() => load()}
        />
      )
    }
    const renderCell = (columnId: string, order: OrderListItem) => {
      switch (columnId) {
        case 'order_number':
          return (
            <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
              {order.order_number}
            </td>
          )
        case 'external_id':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.source_external_id}
            </td>
          )
        case 'customer':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.customer_name ?? '—'}
            </td>
          )
        case 'status':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {t(
                `orders:status.${order.status === 'B#S' ? 'b#s' : order.status}`,
                order.status
              )}
            </td>
          )
        case 'lines':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.lines_total}
            </td>
          )
        case 'created':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {new Date(order.created_at).toLocaleDateString()}
            </td>
          )
        case 'picker':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.picker_name ?? '—'}
            </td>
          )
        case 'controller':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.controller_name ?? '—'}
            </td>
          )
        case 'view_details':
          return (
            <td className="px-4 py-3">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                onClick={() =>
                  navigate(`/admin/orders/${order.id}`, {
                    state: {
                      listQuery: searchParams.toString(),
                      listPath: '/admin/orders-orikzor',
                    },
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
    return (
      <TableScrollArea inline>
        <table className="w-max min-w-[600px] text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              {COLUMNS.map((col) => (
                <th key={col.id} className="px-4 py-3 text-left">
                  {columnLabels.get(col.id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((order) => (
              <tr
                key={order.id}
                className="border-b border-slate-100 dark:border-slate-800"
              >
                {COLUMNS.map((col) => (
                  <Fragment key={col.id}>{renderCell(col.id, order)}</Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [
    error,
    isLoading,
    items,
    load,
    navigate,
    searchParams,
    t,
    columnLabels,
  ])

  const pageTitle = t('admin:menu.orders_orikzor', "O'rikzor harakatlari")

  return (
    <AdminLayout title={pageTitle}>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {pageTitle}
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <span>{t('orders:subtitle_orikzor')}</span>
              {isRefreshing ? (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                  {t('orders:refreshing')}
                </span>
              ) : null}
              {syncResult ? (
                <span className="flex flex-col gap-1">
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                    {t('orders:sync_result', {
                      created: syncResult.created,
                      updated: syncResult.updated,
                      skipped: syncResult.skipped,
                    })}
                  </span>
                  {syncResult.detail || syncResult.errors_count ? (
                    <span className="max-w-xl rounded bg-amber-100 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 break-words">
                      {syncResult.errors_count ? `${syncResult.errors_count} ta xato. ` : ''}
                      {syncResult.detail ?? ''}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canSync ? (
              <Button onClick={handleSync} disabled={isSyncing}>
                {isSyncing ? t('orders:syncing') : t('orders:sync')}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex-1 min-w-[180px] max-w-md text-sm text-slate-600 dark:text-slate-300">
            <span className="sr-only">{t('orders:filters.search')}</span>
            <input
              type="search"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={searchQuery}
              onChange={(e) => {
                const v = e.target.value
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev)
                  if (v) next.set('q', v)
                  else next.delete('q')
                  next.delete('offset')
                  return next
                })
              }}
              placeholder={t('orders:filters.search_placeholder')}
            />
          </label>
        </div>

        {content}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <Button variant="outline" onClick={() => load(true)} disabled={isRefreshing}>
            {t('common:buttons.refresh')}
          </Button>
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <span>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={offset <= 0}
                onClick={() =>
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev)
                    next.set('offset', String(Math.max(0, offset - PAGE_SIZE)))
                    return next
                  })
                }
              >
                {t('orders:pagination.prev', 'Orqaga')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() =>
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev)
                    next.set('offset', String(offset + PAGE_SIZE))
                    return next
                  })
                }
              >
                {t('orders:pagination.next', 'Keyingi')}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </AdminLayout>
  )
}
</think>
Jadvalda xato bor: `<key>` o'rniga `Fragment` yoki to'g'ri element ishlatamiz.
<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>
StrReplace