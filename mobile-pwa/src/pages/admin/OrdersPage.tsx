import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Filter, Settings, FileText, X, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { SendToPickingDialog } from '../../admin/components/orders/SendToPickingDialog'
import { OrdersTableSettings } from '../../admin/components/orders/OrdersTableSettings'
import { useDillerTableConfig } from '../../admin/hooks/useMovementsTableConfig'
import { useOrdersTableConfig } from '../../admin/hooks/useOrdersTableConfig'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { DateInput } from '../../components/DateInput'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { TableSkeleton } from '../../components/ui/TableSkeleton'
import { getMovements, getOrders, getOrdersCheck, syncSmartupOrders, updateOrderStatus, getControllerUsers, type MovementItem, type OrderListItem, type MovementsResponse, type ControllerUser, type OrderCheckResponse } from '../../services/ordersApi'
import { getBrands, type Brand } from '../../services/brandsApi'
import { useAuth } from '../../rbac/AuthProvider'

const PAGE_SIZE = 50
const MOVEMENT_PAGE_SIZE = 50
/** B#S barchasini yuklashda API dan har safar olinadigan maksimum (backend max 500) */
const BULK_PAGE_SIZE = 500
const COLUMN_OPTIONS = [
  { id: 'select', labelKey: 'orders:columns.select' },
  { id: 'order_number', labelKey: 'orders:columns.order_number' },
  { id: 'external_id', labelKey: 'orders:columns.external_id' },
  { id: 'customer', labelKey: 'orders:columns.customer' },
  { id: 'customer_id', labelKey: 'orders:columns.customer_id' },
  { id: 'agent', labelKey: 'orders:columns.agent' },
  { id: 'total_amount', labelKey: 'orders:columns.total_amount' },
  { id: 'status', labelKey: 'orders:columns.status' },
  { id: 'lines', labelKey: 'orders:columns.lines' },
  { id: 'delivery_date', labelKey: 'orders:columns.delivery_date' },
  { id: 'view_details', labelKey: 'orders:columns.view_details' },
  { id: 'send_to_picking', labelKey: 'orders:columns.send_to_picking' },
  { id: 'picker', labelKey: 'orders:columns.picker' },
  { id: 'controller', labelKey: 'orders:columns.controller' },
]

const COLUMN_OPTIONS_DEFAULT = COLUMN_OPTIONS.filter((c) => c.id !== 'status')

// Dropdown da faqat 3 ta status: Yig'ishda, Tekshiruvda, Yakunlangan (backend ga picking / picked / completed yuboriladi)
const SIMPLE_STATUS_OPTIONS = [
  { value: 'picking', labelKey: 'orders:status_simple.yigishda' },
  { value: 'picked', labelKey: 'orders:status_simple.tekshiruvda' },
  { value: 'completed', labelKey: 'orders:status_simple.yakunlash' },
] as const

function backendStatusToSimple(status: string): string {
  if (['imported', 'B#S', 'allocated', 'ready_for_picking', 'picking'].includes(status)) return 'picking'
  if (status === 'picked') return 'picked'
  return 'completed' // completed, packed, shipped, cancelled
}

// Buyurtma statuslari sahifasi: faqat ma'lumot, yig'ishga yuborish yo'q; yig'uvchi va kontrolyor ustunlari
const COLUMN_OPTIONS_STATUSES = [
  { id: 'order_number', labelKey: 'orders:columns.order_number' },
  { id: 'external_id', labelKey: 'orders:columns.external_id' },
  { id: 'customer', labelKey: 'orders:columns.customer' },
  { id: 'customer_id', labelKey: 'orders:columns.customer_id' },
  { id: 'agent', labelKey: 'orders:columns.agent' },
  { id: 'total_amount', labelKey: 'orders:columns.total_amount' },
  { id: 'status', labelKey: 'orders:columns.status' },
  { id: 'change_status', labelKey: 'orders:columns.change_status' },
  { id: 'lines', labelKey: 'orders:columns.lines' },
  { id: 'delivery_date', labelKey: 'orders:columns.delivery_date' },
  { id: 'view_details', labelKey: 'orders:columns.view_details' },
  { id: 'picker', labelKey: 'orders:columns.picker' },
  { id: 'controller', labelKey: 'orders:columns.controller' },
]

// Tashkiliy harakat (cross-organizational movement): mfm movement$export — sklad-sklad, mijoz/agent yo'q
const COLUMN_OPTIONS_DILLER = [
  { id: 'select', labelKey: 'orders:columns.select' },
  { id: 'order_number', labelKey: 'orders:columns_diller.order_number' },
  { id: 'external_id', labelKey: 'orders:columns_diller.external_id' },
  { id: 'from_warehouse_code', labelKey: 'orders:columns_diller.from_warehouse_code' },
  { id: 'to_warehouse_code', labelKey: 'orders:columns_diller.to_warehouse_code' },
  { id: 'movement_note', labelKey: 'orders:columns_diller.movement_note' },
  { id: 'total_amount', labelKey: 'orders:columns_diller.total_amount' },
  { id: 'status', labelKey: 'orders:columns_diller.status' },
  { id: 'lines', labelKey: 'orders:columns_diller.lines' },
  { id: 'delivery_date', labelKey: 'orders:columns_diller.delivery_date' },
  { id: 'view_details', labelKey: 'orders:columns_diller.view_details' },
]

const DILLER_SEARCH_FIELD_OPTIONS = [
  { id: 'order_number', labelKey: 'orders:columns_diller.order_number' },
  { id: 'external_id', labelKey: 'orders:columns_diller.external_id' },
  { id: 'from_warehouse_code', labelKey: 'orders:columns_diller.from_warehouse_code' },
  { id: 'to_warehouse_code', labelKey: 'orders:columns_diller.to_warehouse_code' },
  { id: 'movement_note', labelKey: 'orders:columns_diller.movement_note' },
  { id: 'status', labelKey: 'orders:columns_diller.status' },
]

const SEARCH_FIELD_OPTIONS = [
  { id: 'order_number', labelKey: 'orders:search_fields.order_number' },
  { id: 'external_id', labelKey: 'orders:search_fields.external_id' },
  { id: 'customer', labelKey: 'orders:search_fields.customer' },
  { id: 'customer_id', labelKey: 'orders:search_fields.customer_id' },
  { id: 'agent', labelKey: 'orders:search_fields.agent' },
]

const GROUP_TO_STATUS: Record<string, string | undefined> = {
  xom: 'imported,B#S', // Yangi: Smartupdan kelgan, admin yig'uvchiga yubormagan
  yigishda: 'allocated,ready_for_picking,picking', // Yig'uvchi yig'ishda / controllerga yubormagan
  tekshiruvda: 'picked', // Controllerga yuborilgan, controller yakunlamagan
  yakunlangan: 'completed,packed,shipped', // Controller yakunlagan yoki qadoqlangan
  all: undefined,
}

/** Asosiy Buyurtmalar sahifasidagi status tablari (faqat mode=default, orderSource yo'q) */
const ORDER_TABS = [
  { value: 'all', labelKey: 'orders:tabs.buyurtmalar' },
  { value: 'yigishda', labelKey: 'orders:tabs.yigishda' },
  { value: 'tekshiruvda', labelKey: 'orders:tabs.tekshiruvda' },
  { value: 'yakunlangan', labelKey: 'orders:tabs.yakunlangan' },
] as const

type OrdersPageProps = { mode?: 'default' | 'statuses'; orderSource?: 'diller' }

export function OrdersPage({ mode = 'default', orderSource }: OrdersPageProps) {
  const { t } = useTranslation(['orders', 'common', 'admin'])
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const group = searchParams.get('group') ?? 'all'
  const searchQuery = searchParams.get('q') ?? ''
  const brandFilter = searchParams.get('brand_id') ?? ''
  const dateFrom = searchParams.get('date_from') ?? ''
  const dateTo = searchParams.get('date_to') ?? ''
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10))
  const pageTitle = orderSource
    ? t('admin:menu.orders_diller', 'Tashkiliy harakatlar')
    : mode === 'statuses'
      ? t('admin:dashboard.order_statuses_title')
      : t('orders:title')
  // Asosiy Buyurtmalar sahifasida faqat yig'ishga yuborilmagan (B#S); yig'ishga yuborilganlar bu ro'yxatda ko'rinmasin
  // Buyurtma statuslari sahifasida group=all bo'lsa — yig'ishda + tekshiruvda + yakunlangan barcha statuslar
  const statusParam = orderSource
    ? (GROUP_TO_STATUS[group] ?? undefined)
    : mode === 'default' && (group === 'all' || !searchParams.get('group'))
      ? 'B#S'
      : mode === 'statuses' && (group === 'all' || !searchParams.get('group'))
        ? 'allocated,ready_for_picking,picking,picked,completed,packed,shipped'
        : (GROUP_TO_STATUS[group] ?? GROUP_TO_STATUS.all)

  const onlyNotSentToPicking = mode === 'default' && !orderSource && (statusParam === 'B#S' || statusParam === 'imported,B#S')
  const SENT_TO_PICKING_STATUSES = new Set(['allocated', 'ready_for_picking', 'picking'])
  const { has } = useAuth()
  const canSync = has('orders:write')
  const canSend = has('orders:write')
  const canEditStatus = has('documents:edit_status')
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null)

  const { config, updateConfig, resetConfig } = useOrdersTableConfig()
  const dillerTableConfig = useDillerTableConfig()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const [brands, setBrands] = useState<Brand[]>([])
  const [filterBrandId, setFilterBrandId] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')

  const [items, setItems] = useState<OrderListItem[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())
  const [sendDialogOrderIds, setSendDialogOrderIds] = useState<string[] | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<{
    created: number
    updated: number
    skipped: number
    detail?: string | null
    errors_count?: number | null
  } | null>(null)
  const [movementsData, setMovementsData] = useState<MovementsResponse | null>(null)
  const [movementPage, setMovementPage] = useState(0)
  const [selectedMovementIds, setSelectedMovementIds] = useState<Set<string>>(new Set())
  const [sendMovementDialogOpen, setSendMovementDialogOpen] = useState(false)
  const [controllerModalOrder, setControllerModalOrder] = useState<OrderListItem | null>(null)
  const [controllers, setControllers] = useState<ControllerUser[]>([])
  const [checkResult, setCheckResult] = useState<OrderCheckResponse | null>(null)
  const [checkLoading, setCheckLoading] = useState(false)
  const [controllerModalLoading, setControllerModalLoading] = useState(false)
  const [selectedControllerId, setSelectedControllerId] = useState('')
  const [controllerModalSubmitting, setControllerModalSubmitting] = useState(false)

  const ELIGIBLE_PICKING_STATUSES = new Set(['imported', 'B#S', 'ready_for_picking', 'allocated'])
  const canBeSentToPicking = (order: OrderListItem) =>
    canSend && ELIGIBLE_PICKING_STATUSES.has(order.status)
  const eligibleItems = useMemo(
    () => items.filter((o) => ELIGIBLE_PICKING_STATUSES.has(o.status)),
    [items]
  )

  const load = useCallback(async (background = false, pageOverride?: number, forceRefresh?: boolean) => {
    if (!background) {
      setIsLoading(true)
      setError(null)
    } else {
      setIsRefreshing(true)
    }
    try {
      if (orderSource === 'diller') {
        const end = new Date()
        const begin = new Date()
        begin.setDate(begin.getDate() - 30)
        const defaultBegin = begin.toISOString().slice(0, 10)
        const defaultEnd = end.toISOString().slice(0, 10)
        const beginStr = dateFrom.trim() || defaultBegin
        const endStr = dateTo.trim() || defaultEnd
        const page = pageOverride ?? movementPage
        const query: Record<string, string | number | boolean> = {
          begin_created_on: beginStr,
          end_created_on: endStr,
          begin_modified_on: beginStr,
          end_modified_on: endStr,
          limit: MOVEMENT_PAGE_SIZE,
          offset: page * MOVEMENT_PAGE_SIZE,
        }
        const filialId = (import.meta.env.VITE_DEFAULT_FILIAL_ID as string)?.trim()
        if (filialId) query.filial_id = filialId
        if (forceRefresh) query.refresh = true
        const data = await getMovements(query)
        setMovementsData(data)
        if (pageOverride !== undefined) setMovementPage(pageOverride)
        setItems([])
        setTotal(0)
        return
      }
      const loadAllBS =
        !orderSource &&
        (statusParam === 'B#S' || statusParam === 'imported,B#S') &&
        mode === 'default'

      if (loadAllBS) {
        const allItems: OrderListItem[] = []
        let off = 0
        let hasMore = true
        while (hasMore) {
          const data = await getOrders({
            status: statusParam,
            q: searchQuery.trim() || undefined,
            brand_ids: brandFilter.trim() ? brandFilter.trim() : undefined,
            date_from: dateFrom.trim() || undefined,
            date_to: dateTo.trim() || undefined,
            search_fields:
              config.searchFields.length > 0 ? config.searchFields.join(',') : undefined,
            limit: BULK_PAGE_SIZE,
            offset: off,
            filial_id: 'all',
          })
          allItems.push(...data.items)
          hasMore = data.items.length >= BULK_PAGE_SIZE && allItems.length < data.total
          off += BULK_PAGE_SIZE
        }
        const list = onlyNotSentToPicking
          ? allItems.filter((o) => !SENT_TO_PICKING_STATUSES.has(o.status))
          : allItems
        setItems(list)
        setTotal(list.length)
      } else {
        const query: Record<string, string | number | undefined> = {
          status: statusParam,
          q: searchQuery.trim() || undefined,
          brand_ids: brandFilter.trim() ? brandFilter.trim() : undefined,
          date_from: dateFrom.trim() || undefined,
          date_to: dateTo.trim() || undefined,
          search_fields:
            config.searchFields.length > 0 ? config.searchFields.join(',') : undefined,
          limit: PAGE_SIZE,
          offset,
          ...(orderSource ? { order_source: orderSource } : {}),
        // Buyurtma statuslari sahifasida filial filtrini qo‘llamaymiz (dashboard bilan bir xil)
        ...(mode === 'statuses' ? { filial_id: 'all' } : {}),
        }
        const data = await getOrders(query)
        const list = onlyNotSentToPicking
          ? data.items.filter((o) => !SENT_TO_PICKING_STATUSES.has(o.status))
          : data.items
        setItems(list)
        setTotal(data.total)
      }
    } catch (err) {
      if (!background) {
        const message = err instanceof Error ? err.message : t('orders:load_failed')
        setError(message)
      }
    } finally {
      if (!background) setIsLoading(false)
      else setIsRefreshing(false)
    }
  }, [config.searchFields, movementPage, offset, orderSource, searchQuery, brandFilter, dateFrom, dateTo, statusParam, onlyNotSentToPicking, t])

  const loadBrands = useCallback(async () => {
    try {
      const list = await getBrands(undefined, true)
      setBrands(list)
    } catch {
      setBrands([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadBrands()
  }, [loadBrands])

  const prevGroupRef = useRef(group)
  useEffect(() => {
    if (prevGroupRef.current !== group) {
      prevGroupRef.current = group
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('offset')
        return next
      })
    }
  }, [group, setSearchParams])

  useEffect(() => {
    if (filterPanelOpen) {
      setFilterBrandId(brandFilter)
      setFilterDateFrom(dateFrom)
      setFilterDateTo(dateTo)
    }
  }, [filterPanelOpen, brandFilter, dateFrom, dateTo])

  useEffect(() => {
    setCheckResult(null)
  }, [searchQuery])

  // Avto sync: har 5 daqiqada, sahifa aktiv — diller: load(..., true); buyurtmalar: sync 7 kun + load
  useEffect(() => {
    if (typeof document === 'undefined') return
    const runAutoSync = () => {
      if (document.visibilityState !== 'visible') return
      if (orderSource === 'diller') {
        void load(true, undefined, true)
        return
      }
      if (orderSource && orderSource !== 'diller') {
        const today = new Date()
        const endDeal = today.toISOString().slice(0, 10)
        const beginDeal = new Date(today)
        beginDeal.setDate(beginDeal.getDate() - 7)
        const beginDealStr = beginDeal.toISOString().slice(0, 10)
        syncSmartupOrders({ order_source: orderSource, begin_deal_date: beginDealStr, end_deal_date: endDeal })
          .then(() => void load(true))
          .catch(() => {})
        return
      }
      void load(true)
    }
    const handleVisibility = () => {
      runAutoSync()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    const interval = setInterval(runAutoSync, 300_000)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      clearInterval(interval)
    }
  }, [load, orderSource])


  const handleSync = async () => {
    setIsSyncing(true)
    setSyncError(null)
    setSyncResult(null)
    try {
      if (orderSource === 'diller') {
        await load(false, undefined, true)
        return
      }
      const today = new Date()
      const endDeal = today.toISOString().slice(0, 10)
      const beginDeal = new Date(today)
      beginDeal.setDate(beginDeal.getDate() - 7)
      const beginDealStr = beginDeal.toISOString().slice(0, 10)
      const payload: { order_source?: string; begin_deal_date?: string; end_deal_date?: string } = orderSource
        ? { order_source: orderSource, begin_deal_date: beginDealStr, end_deal_date: endDeal }
        : { begin_deal_date: beginDealStr, end_deal_date: endDeal }
      const result = await syncSmartupOrders(payload)
      setSyncResult(result)
      await load(true)
    } catch (err) {
      const message =
        (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string')
          ? (err as { message: string }).message
          : err instanceof Error
            ? err.message
            : t('orders:sync_failed')
      setSyncError(message)
    } finally {
      setIsSyncing(false)
    }
  }

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="relative flex-1 min-h-[200px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      )
    }
    if (error) {
      return (
        <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
      )
    }
    if (orderSource === 'diller') {
      const movementListRaw = movementsData?.movement ?? []
      const q = searchQuery.trim().toLowerCase()
      const movementList = q
        ? movementListRaw.filter((m: MovementItem) => {
            const mid = String((m.movement_id as string) ?? '').toLowerCase()
            const barcode = String((m.barcode as string) ?? '').toLowerCase()
            const fromWh = String((m.from_warehouse_code as string) ?? '').toLowerCase()
            const toWh = String((m.to_warehouse_code as string) ?? '').toLowerCase()
            const note = String((m.note as string) ?? '').toLowerCase()
            const status = String((m.status as string) ?? '').toLowerCase()
            return mid.includes(q) || barcode.includes(q) || fromWh.includes(q) || toWh.includes(q) || note.includes(q) || status.includes(q)
          })
        : movementListRaw
      const columnLabelsDiller = new Map(
        COLUMN_OPTIONS_DILLER.map((c) => [c.id, t(c.labelKey)])
      )
      const renderMovementCell = (columnId: string, m: MovementItem) => {
        const mid = (m.movement_id as string) ?? '—'
        const barcode = (m.barcode as string) ?? '—'
        const fromWh = (m.from_warehouse_code as string) ?? '—'
        const toWh = (m.to_warehouse_code as string) ?? '—'
        const note = (m.note as string) ?? '—'
        const amount = m.amount != null ? String(m.amount) : '—'
        const status = (m.status as string) ?? '—'
        const items = (m.movement_items as unknown[]) ?? []
        const fromTime = (m.from_time as string) ?? '—'
        switch (columnId) {
          case 'select':
            if (!canSend) return null
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
          case 'order_number':
            return (
              <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                {mid}
              </td>
            )
          case 'external_id':
            return (
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                {barcode}
              </td>
            )
          case 'from_warehouse_code':
            return (
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                {fromWh}
              </td>
            )
          case 'to_warehouse_code':
            return (
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                {toWh}
              </td>
            )
          case 'movement_note':
            return (
              <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300" title={note}>
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
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                {status}
              </td>
            )
          case 'lines':
            return (
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                {items.length}
              </td>
            )
          case 'delivery_date':
            return (
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                {fromTime}
              </td>
            )
          case 'view_details':
            return (
              <td className="px-4 py-3">
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  onClick={() =>
                    navigate(`/admin/orders-diller/${encodeURIComponent(mid)}`, {
                      state: { movement: m, listPath: location.pathname, listQuery: location.search },
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
      if (movementList.length === 0) {
        const isSearch = searchQuery.trim().length > 0
        const runCheck = async () => {
          if (!searchQuery.trim()) return
          setCheckLoading(true)
          setCheckResult(null)
          try {
            const res = await getOrdersCheck({ q: searchQuery.trim() })
            setCheckResult(res)
          } catch {
            setCheckResult(null)
          } finally {
            setCheckLoading(false)
          }
        }
        return (
          <div className="space-y-3">
            <EmptyState
              title={isSearch ? t('orders:search_no_results', "Qidiruv bo'yicha natija topilmadi") : t('orders:empty')}
              description={
                isSearch
                  ? t('orders:search_no_results_hint', "Boshqa so'z yoki filterni sinab ko'ring.") +
                    ' ' +
                    t('orders:search_try_deal_id', "Agar buyurtma SmartUp da delivery_number bo'lsa, deal_id (masalan 233898517) orqali ham qidirib ko'ring.")
                  : t('orders:empty_desc')
              }
              actionLabel={t('common:buttons.refresh')}
              onAction={load}
            />
            {isSearch && (
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={checkLoading}
                  onClick={runCheck}
                  className="self-center"
                >
                  {checkLoading ? t('orders:check_loading', 'Tekshirilmoqda...') : t('orders:check_db_button', 'Bazani tekshirish')}
                </Button>
                {checkResult && (
                  <Card className="p-4 text-sm">
                    <p className="font-medium text-slate-700 dark:text-slate-200 mb-2">
                      {t('orders:check_result_title', 'Baza natijasi')}
                    </p>
                    <p className="text-slate-600 dark:text-slate-300">
                      {t('orders:check_total_b_s', 'B#S bazada (filial bo\'yicha): {{count}} ta', { count: checkResult.total_b_s })}
                      {' · '}
                      {t('orders:check_total_all', 'Barcha filial: {{count}} ta', { count: checkResult.total_b_s_all_filial })}
                    </p>
                    {(checkResult.match_by_order_number.length > 0 ||
                      checkResult.match_by_source_external_id.length > 0 ||
                      checkResult.match_by_so_doc_no.length > 0) ? (
                      <p className="mt-2 text-green-600 dark:text-green-400">
                        {t('orders:check_found', "«{{q}}» topildi:", { q: searchQuery.trim() })}
                        {checkResult.match_by_order_number.length > 0 &&
                          ` order_number: ${checkResult.match_by_order_number.map((m) => m.order_number).join(', ')}`}
                        {checkResult.match_by_source_external_id.length > 0 &&
                          ` source_external_id: ${checkResult.match_by_source_external_id.map((m) => m.source_external_id || m.order_number).join(', ')}`}
                        {checkResult.match_by_so_doc_no.length > 0 &&
                          ` SO doc_no: ${checkResult.match_by_so_doc_no.map((m) => m.doc_no).join(', ')}`}
                      </p>
                    ) : (
                      <p className="mt-2 text-amber-600 dark:text-amber-400">
                        {t('orders:check_not_found', "«{{q}}» bazada B#S buyurtmalar orasida topilmadi.", { q: searchQuery.trim() })}
                      </p>
                    )}
                  </Card>
                )}
              </div>
            )}
          </div>
        )
      }
      const dillerVisible = new Set(dillerTableConfig.config.visibleColumns.filter((id) => COLUMN_OPTIONS_DILLER.some((c) => c.id === id)))
      const dillerOrdered = dillerTableConfig.config.columnOrder.filter((id) => COLUMN_OPTIONS_DILLER.some((c) => c.id === id))
      return (
        <div className="space-y-3">
          {canSend && selectedMovementIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('orders:send_selected_to_picking', { count: selectedMovementIds.size })}
              </span>
              <Button variant="outline" onClick={() => setSelectedMovementIds(new Set())}>
                {t('common:buttons.cancel')}
              </Button>
              <Button onClick={() => setSendMovementDialogOpen(true)}>
                {t('orders:send_to_picking.button')}
              </Button>
            </div>
          )}
          <TableScrollArea inline>
            <table className="w-max min-w-[600px] table-auto text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  {dillerOrdered.map((colId) =>
                    dillerVisible.has(colId) ? (
                      <th key={colId} className="px-4 py-3 text-left">
                        {colId === 'select' && canSend ? (
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
                          columnLabelsDiller.get(colId)
                        )}
                      </th>
                    ) : null
                  )}
                </tr>
              </thead>
              <tbody>
                {movementList.map((m) => (
                  <tr
                    key={(m.movement_id as string) ?? String(m.barcode ?? '')}
                    className="border-b border-slate-100 dark:border-slate-800"
                  >
                    {dillerOrdered.map((colId) =>
                      dillerVisible.has(colId) ? (
                        <React.Fragment key={colId}>
                          {renderMovementCell(colId, m)}
                        </React.Fragment>
                      ) : null
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollArea>
        </div>
      )
    }
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('orders:empty')}
          description={t('orders:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    const defaultWithStatusTab = mode === 'default' && !orderSource && (group === 'yigishda' || group === 'tekshiruvda' || group === 'yakunlangan')
    const columnOptionsForMode =
      orderSource === 'diller'
        ? COLUMN_OPTIONS_DILLER
        : mode === 'statuses' || defaultWithStatusTab
          ? COLUMN_OPTIONS_STATUSES
          : mode === 'default'
            ? COLUMN_OPTIONS_DEFAULT
            : COLUMN_OPTIONS
    const visibleColumns =
      orderSource === 'diller'
        ? new Set(dillerTableConfig.config.visibleColumns.filter((id) => COLUMN_OPTIONS_DILLER.some((c) => c.id === id)))
        : mode === 'statuses' || defaultWithStatusTab
          ? new Set(COLUMN_OPTIONS_STATUSES.map((c) => c.id))
          : new Set(
              mode === 'default'
                ? config.visibleColumns.filter((id) => id !== 'status')
                : config.visibleColumns
            )
    const orderedColumns =
      orderSource === 'diller'
        ? dillerTableConfig.config.columnOrder.filter((id) => COLUMN_OPTIONS_DILLER.some((c) => c.id === id))
        : mode === 'statuses' || defaultWithStatusTab
          ? COLUMN_OPTIONS_STATUSES.map((c) => c.id)
          : config.columnOrder.filter((id) =>
              columnOptionsForMode.some((column) => column.id === id)
            )
    const getStatusRowClass = (order: OrderListItem) => {
      if (mode !== 'statuses' && !defaultWithStatusTab) return ''
      if (order.is_incomplete) return 'bg-red-50 dark:bg-red-950/30'
      const status = order.status
      if (status === 'allocated' || status === 'ready_for_picking' || status === 'picking')
        return 'bg-blue-50 dark:bg-blue-950/30'
      if (status === 'picked') return 'bg-amber-50 dark:bg-amber-950/30'
      if (status === 'completed' || status === 'packed' || status === 'shipped')
        return 'bg-emerald-50 dark:bg-emerald-950/30'
      return ''
    }
    const columnLabels = new Map(
      columnOptionsForMode.map((column) => [
        column.id,
        t(column.labelKey),
      ])
    )
    const renderCell = (columnId: string, order: OrderListItem) => {
      switch (columnId) {
        case 'select':
          if (!canSend) return null
          {
            const eligible = canBeSentToPicking(order)
            const checked = selectedOrderIds.has(order.id)
            return (
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!eligible}
                  onChange={() => {
                    if (!eligible) return
                    setSelectedOrderIds((prev) => {
                      const next = new Set(prev)
                      if (next.has(order.id)) next.delete(order.id)
                      else next.add(order.id)
                      return next
                    })
                  }}
                  aria-label={t('orders:select_all')}
                  className="h-4 w-4 rounded border-slate-300"
                />
              </td>
            )
          }
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
        case 'customer_id':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.customer_id ?? '—'}
            </td>
          )
        case 'agent':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.agent_name ?? '—'}
            </td>
          )
        case 'from_warehouse_code':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.from_warehouse_code ?? '—'}
            </td>
          )
        case 'to_warehouse_code':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.to_warehouse_code ?? '—'}
            </td>
          )
        case 'movement_note':
          return (
            <td className="px-4 py-3 max-w-[200px] truncate text-slate-600 dark:text-slate-300" title={order.movement_note ?? undefined}>
              {order.movement_note ?? '—'}
            </td>
          )
        case 'total_amount':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.total_amount == null ? '—' : Number(order.total_amount).toLocaleString()}
            </td>
          )
        case 'status':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {t(`orders:status.${order.status === 'B#S' ? 'b#s' : order.status}`, order.status)}
                {order.has_so && (
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-600 dark:text-slate-200">
                    {t('orders:so_order_badge', 'SO buyurtma')}
                  </span>
                )}
                {order.is_incomplete && (
                  <span className="rounded bg-red-200 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/60 dark:text-red-200">
                    {t('orders:incomplete_badge', 'To\'liq emas')}
                  </span>
                )}
              </span>
            </td>
          )
        case 'change_status':
          if (!canEditStatus)
            return (
              <td className="px-4 py-3 text-slate-400 dark:text-slate-600">—</td>
            )
          {
            const isUpdating = updatingOrderId === order.id
            const simpleValue = backendStatusToSimple(order.status)
            return (
              <td className="px-4 py-3">
                <select
                  value={simpleValue}
                  disabled={isUpdating}
                  onChange={async (e) => {
                    const newSimple = e.target.value as 'picking' | 'picked' | 'completed'
                    const backendStatus = newSimple
                    if (backendStatus === order.status) return
                    if (backendStatus === 'picked') {
                      setControllerModalOrder(order)
                      setSelectedControllerId('')
                      setControllerModalLoading(true)
                      try {
                        const list = await getControllerUsers()
                        setControllers(list)
                      } catch {
                        setControllers([])
                      } finally {
                        setControllerModalLoading(false)
                      }
                      return
                    }
                    setUpdatingOrderId(order.id)
                    try {
                      await updateOrderStatus(order.id, backendStatus)
                      await load()
                    } finally {
                      setUpdatingOrderId(null)
                    }
                  }}
                  className="min-w-[140px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 disabled:opacity-60"
                  aria-label={t('orders:columns.change_status')}
                >
                  {SIMPLE_STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {t(s.labelKey)}
                    </option>
                  ))}
                </select>
              </td>
            )
          }
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
        case 'lines':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.lines_total}
            </td>
          )
        case 'delivery_date':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.delivery_date
                ? new Date(order.delivery_date).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  })
                : '—'}
            </td>
          )
        case 'view_details':
          return (
            <td className="px-4 py-3">
              <button
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                onClick={() =>
                  navigate(`/admin/orders/${order.id}`, {
                    state: { listQuery: location.search, listPath: location.pathname },
                  })
                }
                aria-label={t('orders:view_details')}
              >
                <FileText size={18} />
              </button>
            </td>
          )
        case 'send_to_picking':
          return (
            <td className="px-4 py-3">
              {canSend ? (
                <Button variant="secondary" onClick={() => setSendDialogOrderIds([order.id])}>
                  {t('orders:send_to_picking.button')}
                </Button>
              ) : (
                <span className="text-slate-400 dark:text-slate-600">—</span>
              )}
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
              {orderedColumns.map((columnId) =>
                visibleColumns.has(columnId) ? (
                  <th key={columnId} className="px-4 py-3 text-left">
                    {columnId === 'select' && canSend ? (
                      (() => {
                        const allSelected =
                          eligibleItems.length > 0 &&
                          eligibleItems.every((o) => selectedOrderIds.has(o.id))
                        const someSelected = eligibleItems.some((o) => selectedOrderIds.has(o.id))
                        return (
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = someSelected && !allSelected
                            }}
                            onChange={() =>
                              setSelectedOrderIds(
                                allSelected ? new Set() : new Set(eligibleItems.map((o) => o.id))
                              )
                            }
                            aria-label={t('orders:select_all')}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        )
                      })()
                    ) : (
                      columnLabels.get(columnId)
                    )}
                  </th>
                ) : null
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((order) => (
              <tr
                key={order.id}
                className={`border-b border-slate-100 dark:border-slate-800 ${getStatusRowClass(order)}`}
              >
                {orderedColumns.map((columnId) =>
                  visibleColumns.has(columnId) ? renderCell(columnId, order) : null
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [canEditStatus, canSend, config.columnOrder, config.visibleColumns, dillerTableConfig.config, eligibleItems, error, isLoading, items, load, location.pathname, location.search, mode, movementPage, movementsData, navigate, orderSource, searchQuery, selectedMovementIds, selectedOrderIds, t, updatingOrderId])

  const showOrderTabs = mode === 'default' && !orderSource

  return (
    <AdminLayout title={pageTitle} backTo={mode === 'statuses' ? '/admin' : undefined}>
      <Card className="space-y-4">
        {showOrderTabs ? (
          <div className="flex border-b border-slate-200 dark:border-slate-700 gap-0 overflow-x-auto">
            {ORDER_TABS.map((tab) => {
              const isActive = group === tab.value
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => {
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev)
                      next.set('group', tab.value)
                      next.delete('offset')
                      return next
                    })
                  }}
                  className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-sky-500 text-sky-600 dark:text-sky-400 dark:border-sky-400'
                      : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {t(tab.labelKey)}
                </button>
              )
            })}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
                <div className="absolute right-0 top-full z-50 mt-2 w-full min-w-[280px] max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
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
                    <label className="block text-sm text-slate-600 dark:text-slate-400">
                      {t('orders:filters.filter_by_brand')}
                      <select
                        value={filterBrandId}
                        onChange={(e) => setFilterBrandId(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <option value="">{t('orders:filters.filter_all_brands')}</option>
                        {brands.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.display_name || b.name || b.code}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-sm text-slate-600 dark:text-slate-400">
                        {t('orders:filters.delivery_date_from')}
                        <DateInput
                          value={filterDateFrom}
                          onChange={setFilterDateFrom}
                          className="mt-1 w-full"
                          aria-label={t('orders:filters.delivery_date_from')}
                        />
                      </label>
                      <label className="block text-sm text-slate-600 dark:text-slate-400">
                        {t('orders:filters.delivery_date_to')}
                        <DateInput
                          value={filterDateTo}
                          onChange={setFilterDateTo}
                          className="mt-1 w-full"
                          aria-label={t('orders:filters.delivery_date_to')}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSearchParams((prev) => {
                          const next = new URLSearchParams(prev)
                          next.delete('brand_id')
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
                          const bid = filterBrandId.trim()
                          const df = filterDateFrom.trim()
                          const dt = filterDateTo.trim()
                          if (bid) next.set('brand_id', bid)
                          else next.delete('brand_id')
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
          <div className="flex flex-1 items-center justify-end gap-2 min-w-0">
            {mode !== 'statuses' ? (
              <Button
                variant="ghost"
                className="rounded-full px-3 py-3 shrink-0"
                onClick={() => setIsSettingsOpen(true)}
                aria-label={t('orders:table.settings_title')}
              >
                <Settings size={18} />
              </Button>
            ) : null}
            {canSync && mode !== 'statuses' ? (
              <Button onClick={handleSync} disabled={isSyncing} className="shrink-0">
                {isSyncing ? t('orders:syncing') : t('orders:sync')}
              </Button>
            ) : null}
          </div>
        </div>

        {syncError ? (
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/30">
            <span className="text-sm text-amber-800 dark:text-amber-200 break-words flex-1">{syncError}</span>
            <Button variant="ghost" className="shrink-0 p-2" onClick={() => setSyncError(null)} aria-label={t('common:buttons.close')}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        {(group && group !== 'all') || isRefreshing || (orderSource === 'diller' && movementsData != null) || syncResult ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            {group && group !== 'all' ? (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                {t(`admin:dashboard.status_${group}`)}
              </span>
            ) : null}
            {isRefreshing ? (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                {t('orders:refreshing')}
              </span>
            ) : null}
            {orderSource === 'diller' && movementsData != null ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                {t('orders:movements_loaded', { count: movementsData.movement?.length ?? 0 })}
              </span>
            ) : syncResult ? (
              <span className="flex flex-col gap-1">
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                  {t('orders:sync_result', { created: syncResult.created, updated: syncResult.updated, skipped: syncResult.skipped })}
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
        ) : null}

        {mode !== 'statuses' && canSend && selectedOrderIds.size > 0 && onlyNotSentToPicking ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50">
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {t('orders:send_selected_to_picking', { count: selectedOrderIds.size })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => setSelectedOrderIds(new Set())}
              >
                {t('common:buttons.cancel')}
              </Button>
              <Button
                onClick={() => setSendDialogOrderIds(Array.from(selectedOrderIds))}
              >
                {t('orders:send_to_picking.button')}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="relative max-h-[calc(100vh-320px)] min-h-0 overflow-auto">
          {content}
          {isSyncing && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 dark:bg-slate-900/60 backdrop-blur-[2px]">
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-4 py-2.5 text-sm font-medium text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                <Loader2 size={20} className="animate-spin shrink-0" />
                {t('orders:syncing')}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          {orderSource === 'diller' ? (
            <>
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {(movementsData?.total ?? 0) > 0
                  ? `${movementPage * MOVEMENT_PAGE_SIZE + 1}–${Math.min((movementPage + 1) * MOVEMENT_PAGE_SIZE, movementsData?.total ?? 0)} / ${movementsData?.total ?? 0}`
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
                disabled={(movementPage + 1) * MOVEMENT_PAGE_SIZE >= (movementsData?.total ?? 0)}
                onClick={() => load(false, movementPage + 1)}
              >
                {t('common:buttons.next')}
              </Button>
            </>
          ) : (
            <>
              {(() => {
                const isAllBSLoaded =
                  !orderSource &&
                  mode === 'default' &&
                  (statusParam === 'B#S' || statusParam === 'imported,B#S')
                if (isAllBSLoaded) {
                  return (
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {total > 0 ? `1–${total} / ${total}` : '0 / 0'}
                    </span>
                  )
                }
                return (
                  <>
                    <Button
                      variant="secondary"
                      disabled={offset === 0}
                      onClick={() => {
                        const newOffset = Math.max(0, offset - PAGE_SIZE)
                        setSearchParams((prev) => {
                          const next = new URLSearchParams(prev)
                          next.set('offset', String(newOffset))
                          return next
                        })
                      }}
                    >
                      {t('common:buttons.back')}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={offset + PAGE_SIZE >= total}
                      onClick={() => {
                        setSearchParams((prev) => {
                          const next = new URLSearchParams(prev)
                          next.set('offset', String(offset + PAGE_SIZE))
                          return next
                        })
                      }}
                    >
                      {t('common:buttons.next')}
                    </Button>
                  </>
                )
              })()}
            </>
          )}
        </div>
      </Card>

      {mode !== 'statuses' ? (
        <SendToPickingDialog
          open={sendDialogOrderIds !== null}
          orderIds={sendDialogOrderIds ?? []}
          onOpenChange={(open) => !open && setSendDialogOrderIds(null)}
          onSent={() => {
            const sentIds = sendDialogOrderIds ?? []
            setSendDialogOrderIds(null)
            setSelectedOrderIds(new Set())
            setItems((prev) => prev.filter((o) => !sentIds.includes(o.id)))
            setTotal((prev) => Math.max(0, prev - sentIds.length))
            void load()
          }}
        />
      ) : null}
      {orderSource === 'diller' && (
        <SendToPickingDialog
          open={sendMovementDialogOpen}
          orderIds={[]}
          movementPayloads={sendMovementDialogOpen
            ? (movementsData?.movement ?? [])
                .filter((m: MovementItem) => selectedMovementIds.has((m.movement_id as string) ?? ''))
                .map((m) => ({ source: 'diller' as const, movement_id: (m.movement_id as string) ?? '', movement: m }))
            : null}
          onOpenChange={(open) => !open && setSendMovementDialogOpen(false)}
          onSent={() => {
            setSendMovementDialogOpen(false)
            setSelectedMovementIds(new Set())
            void load(true)
          }}
        />
      )}
      {controllerModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            onClick={() => setControllerModalOrder(null)}
            aria-label={t('common:buttons.close')}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {t('orders:controller_modal.title')}
              </div>
              <Button variant="ghost" className="rounded-full px-3 py-3" onClick={() => setControllerModalOrder(null)}>
                <X size={18} />
              </Button>
            </div>
            <div className="space-y-4 px-6 py-5">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {controllerModalOrder.order_number}
              </p>
              <label className="block text-sm text-slate-600 dark:text-slate-300">
                {t('orders:controller_modal.controller_label')}
                <select
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                  value={selectedControllerId}
                  onChange={(e) => setSelectedControllerId(e.target.value)}
                  disabled={controllerModalLoading}
                >
                  <option value="">
                    {controllerModalLoading
                      ? t('orders:controller_modal.loading')
                      : t('orders:controller_modal.controller_skip')}
                  </option>
                  {controllers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={() => setControllerModalOrder(null)} disabled={controllerModalSubmitting}>
                  {t('common:buttons.cancel')}
                </Button>
                <Button
                  disabled={controllerModalSubmitting}
                  onClick={async () => {
                    if (!controllerModalOrder) return
                    setControllerModalSubmitting(true)
                    try {
                      await updateOrderStatus(
                        controllerModalOrder.id,
                        'picked',
                        selectedControllerId.trim() || undefined
                      )
                      setControllerModalOrder(null)
                      void load()
                    } finally {
                      setControllerModalSubmitting(false)
                    }
                  }}
                >
                  {controllerModalSubmitting ? t('common:loading') : t('orders:controller_modal.confirm')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      <OrdersTableSettings
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        config={orderSource === 'diller' ? dillerTableConfig.config : config}
        columns={(orderSource === 'diller' ? COLUMN_OPTIONS_DILLER : mode === 'statuses' ? COLUMN_OPTIONS_STATUSES : mode === 'default' ? COLUMN_OPTIONS_DEFAULT : COLUMN_OPTIONS).map((column) => ({
          id: column.id,
          label: t(column.labelKey),
        }))}
        searchFields={(orderSource === 'diller' ? DILLER_SEARCH_FIELD_OPTIONS : SEARCH_FIELD_OPTIONS).map((field) => ({
          id: field.id,
          label: t(field.labelKey),
        }))}
        onSave={orderSource === 'diller' ? dillerTableConfig.updateConfig : updateConfig}
        onReset={orderSource === 'diller' ? dillerTableConfig.resetConfig : resetConfig}
      />
    </AdminLayout>
  )
}
