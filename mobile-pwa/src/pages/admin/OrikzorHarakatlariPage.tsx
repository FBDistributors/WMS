import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, Filter, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { SendToPickingDialog } from '../../admin/components/orders/SendToPickingDialog'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { DateInput } from '../../components/DateInput'
import { EmptyState } from '../../components/ui/EmptyState'
import { getOrikzorMovements, type MovementItem } from '../../services/ordersApi'
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

const COLUMNS_ORIKZOR = [
  { id: 'select', labelKey: 'orders:columns.select' },
  { id: 'movement_number', labelKey: 'orders:columns_diller.movement_number' },
  { id: 'movement_note', labelKey: 'orders:columns_diller.movement_note' },
  { id: 'status', labelKey: 'orders:columns_diller.status' },
  { id: 'lines', labelKey: 'orders:columns_diller.lines' },
  { id: 'delivery_date', labelKey: 'orders:columns_diller.delivery_date' },
  { id: 'view_details', labelKey: 'orders:columns_diller.view_details' },
] as const

export function OrikzorHarakatlariPage() {
  const { t } = useTranslation(['orders', 'common', 'admin'])
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const dateFrom = searchParams.get('date_from') ?? daysAgoISO(30)
  const dateTo = searchParams.get('date_to') ?? todayISO()
  const movementPage = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) / PAGE_SIZE)
  const [movementsData, setMovementsData] = useState<{ movement: MovementItem[]; total?: number } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const [filterDateFrom, setFilterDateFrom] = useState(dateFrom)
  const [filterDateTo, setFilterDateTo] = useState(dateTo)
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const { has: hasPermission } = useAuth()
  const canSendToPicking = hasPermission('orders:send_to_picking')
  const [selectedMovementIds, setSelectedMovementIds] = useState<Set<string>>(new Set())
  const [sendDialogOpen, setSendDialogOpen] = useState(false)

  const load = useCallback(
    async (background = false, pageOverride?: number, forceRefresh = false) => {
      if (!background) setIsLoading(true)
      else setIsRefreshing(true)
      setError(null)
      const page = pageOverride ?? movementPage
      const from = dateFrom.trim() || daysAgoISO(30)
      const to = dateTo.trim() || todayISO()
      try {
        const data = await getOrikzorMovements({
          begin_created_on: from,
          end_created_on: to,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          refresh: forceRefresh,
        })
        setMovementsData(data)
        if (pageOverride !== undefined) {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('offset', String(page * PAGE_SIZE))
            return next
          })
        }
      } catch (err) {
        if (!background) {
          setError(err instanceof Error ? err.message : t('orders:load_failed'))
        }
      } finally {
        if (!background) setIsLoading(false)
        else setIsRefreshing(false)
      }
    },
    [dateFrom, dateTo, movementPage, setSearchParams, t]
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (filterPanelOpen) {
      setFilterDateFrom(dateFrom)
      setFilterDateTo(dateTo)
    }
  }, [filterPanelOpen, dateFrom, dateTo])

  const searchQuery = searchParams.get('q') ?? ''
  const movementListRaw = movementsData?.movement ?? []
  const movementList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return movementListRaw
    return movementListRaw.filter((m) => {
      const movementNum = String((m.movement_number as string) ?? (m.movement_id as string) ?? '').toLowerCase()
      const mid = String((m.movement_id as string) ?? '').toLowerCase()
      const note = String((m.note as string) ?? '').toLowerCase()
      const status = String((m.status as string) ?? '').toLowerCase()
      return movementNum.includes(q) || mid.includes(q) || note.includes(q) || status.includes(q)
    })
  }, [movementListRaw, searchQuery])
  const movementTotal = movementsData?.total ?? 0
  const columnLabels = useMemo(
    () => new Map(COLUMNS_ORIKZOR.map((c) => [c.id, t(c.labelKey)])),
    [t]
  )

  const renderCell = (columnId: string, m: MovementItem) => {
    const mid = (m.movement_id as string) ?? '—'
    const movementNum = (m.movement_number as string) ?? mid
    const note = (m.note as string) ?? '—'
    const status = (m.status as string) ?? '—'
    const items = (m.movement_items as unknown[]) ?? []
    const fromTime = (m.from_time as string) ?? (m.from_movement_date as string) ?? '—'
    switch (columnId) {
      case 'select':
        if (!canSendToPicking) return null
        {
          const checked = selectedMovementIds.has(mid)
          return (
            <td className="px-4 py-3">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  setSelectedMovementIds((prev) => {
                    const next = new Set(prev)
                    if (next.has(mid)) next.delete(mid)
                    else next.add(mid)
                    return next
                  })
                }}
                aria-label={t('orders:select_all')}
                className="h-4 w-4 rounded border-slate-300"
              />
            </td>
          )
        }
      case 'movement_number':
        return (
          <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">{movementNum}</td>
        )
      case 'movement_note':
        return (
          <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300" title={note}>
            {note}
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
    if (movementList.length === 0) {
      return (
        <EmptyState
          title={searchQuery.trim() ? t('orders:search_no_results', 'Qidiruv bo\'yicha natija topilmadi') : t('orders:empty')}
          description={searchQuery.trim() ? t('orders:search_no_results_hint', 'Boshqa so\'z yoki filterni sinab ko\'ring.') : t('orders:empty_desc')}
          actionLabel={searchQuery.trim() ? t('common:buttons.refresh') : t('common:buttons.refresh')}
          onAction={() => (searchQuery.trim() ? setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('q'); return n }) : load())}
        />
      )
    }
    return (
      <TableScrollArea inline>
        <table className="w-max min-w-[600px] table-auto text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              {COLUMNS_ORIKZOR.map((col) => (
                <th key={col.id} className="px-4 py-3 text-left">
                  {col.id === 'select' && canSendToPicking ? (
                    <input
                      type="checkbox"
                      checked={movementList.length > 0 && movementList.every((m) => selectedMovementIds.has((m.movement_id as string) ?? ''))}
                      ref={(el) => {
                        if (el) {
                          const some = movementList.some((m) => selectedMovementIds.has((m.movement_id as string) ?? ''))
                          el.indeterminate = some && !movementList.every((m) => selectedMovementIds.has((m.movement_id as string) ?? ''))
                        }
                      }}
                      onChange={() =>
                        setSelectedMovementIds(
                          movementList.every((m) => selectedMovementIds.has((m.movement_id as string) ?? ''))
                            ? new Set()
                            : new Set(movementList.map((m) => (m.movement_id as string) ?? ''))
                        )
                      }
                      aria-label={t('orders:select_all')}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  ) : (
                    columnLabels.get(col.id)
                  )}
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
                {COLUMNS_ORIKZOR.map((col) => (
                  <Fragment key={col.id}>{renderCell(col.id, m)}</Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [canSendToPicking, error, isLoading, movementList, movementTotal, load, columnLabels, navigate, searchParams, selectedMovementIds, setSelectedMovementIds, t])

  const pageTitle = t('admin:menu.orders_orikzor', "O'rikzor harakatlari")

  const handleSmartupSync = useCallback(() => {
    void load(true, 0, true)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('offset')
      return next
    })
  }, [load, setSearchParams])

  return (
    <AdminLayout
      title={pageTitle}
      actionSlot={
        <Button onClick={handleSmartupSync} disabled={isRefreshing}>
          {isRefreshing ? t('orders:syncing') : t('orders:sync')}
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex-1 min-w-[200px] max-w-md text-sm text-slate-600 dark:text-slate-300">
          <span className="sr-only">{t('orders:filters.search')}</span>
          <input
            type="search"
            className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
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
            placeholder={t('orders:filters.search_placeholder_orikzor')}
          />
        </label>
        <div className="relative" ref={filterPanelRef}>
          <Button
            variant="outline"
            onClick={() => setFilterPanelOpen((o) => !o)}
            className="gap-2"
            aria-label={t('orders:filters.filter_btn')}
            aria-expanded={filterPanelOpen}
          >
            <Filter size={18} />
            {t('orders:filters.filter_btn')}
          </Button>
          {filterPanelOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                aria-hidden
                onClick={() => setFilterPanelOpen(false)}
              />
              <div className="absolute left-0 top-full z-50 mt-2 w-full min-w-[280px] max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {t('orders:filters.filter_panel_title')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFilterPanelOpen(false)}
                    className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:text-slate-400 dark:hover:bg-slate-800"
                    aria-label={t('common:close')}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-sm text-slate-600 dark:text-slate-400">
                      {t('orders:filters.date_from')}
                      <DateInput
                        value={filterDateFrom}
                        onChange={setFilterDateFrom}
                        className="mt-1 w-full"
                        aria-label={t('orders:filters.date_from')}
                      />
                    </label>
                    <label className="block text-sm text-slate-600 dark:text-slate-400">
                      {t('orders:filters.date_to')}
                      <DateInput
                        value={filterDateTo}
                        onChange={setFilterDateTo}
                        className="mt-1 w-full"
                        aria-label={t('orders:filters.date_to')}
                      />
                    </label>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('orders:sync_date_hint', "Smartup'dagi from_movement_date shu oraliqda bo'lishi kerak.")}
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearchParams((prev) => {
                        const next = new URLSearchParams(prev)
                        next.delete('date_from')
                        next.delete('date_to')
                        next.delete('offset')
                        return next
                      })
                      setFilterPanelOpen(false)
                    }}
                  >
                    {t('orders:filters.filter_clear')}
                  </Button>
                  <Button
                    onClick={() => {
                      setSearchParams((prev) => {
                        const next = new URLSearchParams(prev)
                        const df = filterDateFrom.trim()
                        const dt = filterDateTo.trim()
                        if (df) next.set('date_from', df)
                        else next.delete('date_from')
                        if (dt) next.set('date_to', dt)
                        else next.delete('date_to')
                        next.delete('offset')
                        return next
                      })
                      setFilterPanelOpen(false)
                    }}
                  >
                    {t('orders:filters.filter_apply')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
        {(dateFrom || dateTo) && (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {dateFrom} – {dateTo}
          </span>
        )}
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
        {canSendToPicking && selectedMovementIds.size > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50">
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {t('orders:send_selected_to_picking', { count: selectedMovementIds.size })}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setSelectedMovementIds(new Set())}>
                {t('common:buttons.cancel')}
              </Button>
              <Button onClick={() => setSendDialogOpen(true)}>
                {t('orders:send_to_picking.button')}
              </Button>
            </div>
          </div>
        ) : null}
        {content}

        <SendToPickingDialog
          open={sendDialogOpen}
          orderIds={[]}
          onOpenChange={setSendDialogOpen}
          onSent={() => {
            setSelectedMovementIds(new Set())
            void load(true)
          }}
          movementPayloads={movementList
            .filter((m) => selectedMovementIds.has((m.movement_id as string) ?? ''))
            .map((m) => ({
              source: 'orikzor' as const,
              movement_id: (m.movement_id as string) ?? '',
              movement: m,
            }))}
        />

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
              onClick={() => {
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev)
                  next.set('offset', String((movementPage - 1) * PAGE_SIZE))
                  return next
                })
              }}
            >
              {t('common:buttons.back')}
            </Button>
            <Button
              variant="secondary"
              disabled={(movementPage + 1) * PAGE_SIZE >= movementTotal}
              onClick={() => {
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev)
                  next.set('offset', String((movementPage + 1) * PAGE_SIZE))
                  return next
                })
              }}
            >
              {t('orders:pagination.next', 'Keyingi')}
            </Button>
          </div>
        </div>
      </Card>
    </AdminLayout>
  )
}
