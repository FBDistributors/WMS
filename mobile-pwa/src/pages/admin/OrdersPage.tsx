import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Filter, Settings, FileText, X, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { OrdersHubTabs, OrdersSourceSubTabs } from '../../admin/components/orders/OrdersHubTabs'
import { SendToPickingDialog } from '../../admin/components/orders/SendToPickingDialog'
import { OrdersTableSettings } from '../../admin/components/orders/OrdersTableSettings'
import { useDillerTableConfig } from '../../admin/hooks/useMovementsTableConfig'
import { useOrdersTableConfig } from '../../admin/hooks/useOrdersTableConfig'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { DateInput } from '../../components/DateInput'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import {
  formatSourceExternalIdDisplay,
  getOrders,
  syncSmartupOrders,
  type MovementItem,
  type OrderListItem,
  type OrderCheckResponse,
  type SmartupSyncResult,
} from '../../services/ordersApi'
import {
  OrderWmsStatusCell,
  SIMPLE_STATUS_OPTIONS,
  backendStatusToSimple,
} from '../../admin/components/orders/OrderWmsStatusCell'
import { getBrands, type Brand } from '../../services/brandsApi'
import { useAuth } from '../../rbac/AuthProvider'

const PAGE_SIZE = 50
/** Yangi navbat (imported) barchasini yuklashda API dan har safar olinadigan maksimum (backend max 500) */
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

// Buyurtma statuslari sahifasi: faqat ma'lumot, yig'ishga yuborish yo'q; yig'uvchi va kontrolyor ustunlari
const COLUMN_OPTIONS_STATUSES = [
  { id: 'order_number', labelKey: 'orders:columns.order_number' },
  { id: 'external_id', labelKey: 'orders:columns.external_id' },
  { id: 'customer', labelKey: 'orders:columns.customer' },
  { id: 'customer_id', labelKey: 'orders:columns.customer_id' },
  { id: 'agent', labelKey: 'orders:columns.agent' },
  { id: 'total_amount', labelKey: 'orders:columns.total_amount' },
  { id: 'status', labelKey: 'orders:columns.status' },
  { id: 'so_document_status', labelKey: 'orders:columns.so_document_status' },
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
  { id: 'status', labelKey: 'orders:columns_diller.status' },
  { id: 'to_filial', labelKey: 'orders:columns_diller.to_filial' },
  { id: 'movement_note', labelKey: 'orders:columns_diller.movement_note' },
  { id: 'total_amount', labelKey: 'orders:columns_diller.total_amount' },
  { id: 'lines', labelKey: 'orders:columns_diller.lines' },
  { id: 'delivery_date', labelKey: 'orders:columns_diller.delivery_date' },
  { id: 'view_details', labelKey: 'orders:columns_diller.view_details' },
]

const SEARCH_FIELD_OPTIONS = [
  { id: 'order_number', labelKey: 'orders:search_fields.order_number' },
  { id: 'external_id', labelKey: 'orders:search_fields.external_id' },
  { id: 'customer', labelKey: 'orders:search_fields.customer' },
  { id: 'customer_id', labelKey: 'orders:search_fields.customer_id' },
  { id: 'agent', labelKey: 'orders:search_fields.agent' },
]

const SEARCH_FIELD_OPTIONS_DILLER = [
  { id: 'order_number', labelKey: 'orders:columns_diller.order_number' },
  { id: 'external_id', labelKey: 'orders:columns_diller.external_id' },
  { id: 'status', labelKey: 'orders:columns_diller.status' },
  { id: 'to_filial', labelKey: 'orders:columns_diller.to_filial' },
  { id: 'movement_note', labelKey: 'orders:columns_diller.movement_note' },
]

/** Eski bookmark: B#S / B#W / ready_for_picking → imported */
function normalizeOrderListStatusParam(s: string | undefined): string | undefined {
  if (s == null || s === '') return undefined
  const parts = s
    .split(',')
    .map((p) => {
      const t = p.trim()
      if (t === 'B#S' || t === 'B#W' || t === 'ready_for_picking') return 'imported'
      return t
    })
    .filter(Boolean)
  return [...new Set(parts)].join(',')
}

const GROUP_TO_STATUS: Record<string, string | undefined> = {
  xom: 'imported',
  yangi: 'imported',
  yigishda: 'allocated,picking', // Yig'uvchi yig'ishda / controllerga yubormagan
  tekshiruvda: 'picked', // Controllerga yuborilgan, controller yakunlamagan
  yakunlangan: 'completed,packed,shipped,cancelled', // Yakunlangan, jo'natilgan yoki bekor
  all: undefined,
}

/** Asosiy Buyurtmalar: filter panelidagi buyurtma holati (mode=default, orderSource yo'q) */
const ORDER_GROUP_FILTER_OPTIONS = [
  { value: 'yangi', labelKey: 'orders:tabs.yangi_bw' },
  { value: 'all', labelKey: 'orders:tabs.all_statuses' },
  { value: 'yigishda', labelKey: 'orders:tabs.yigishda' },
  { value: 'tekshiruvda', labelKey: 'orders:tabs.tekshiruvda' },
  { value: 'yakunlangan', labelKey: 'orders:tabs.yakunlangan' },
  { value: 'xom', labelKey: 'admin:dashboard.status_xom' },
] as const

const ORDER_GROUP_FILTER_VALUES: Set<string> = new Set(
  ORDER_GROUP_FILTER_OPTIONS.map((o) => o.value)
)

type OrdersPageProps = { mode?: 'default' | 'statuses'; orderSource?: 'diller' }
type MovementWmsFilter = 'new' | 'picking' | 'review' | 'completed' | 'cancelled' | 'all'

export function OrdersPage({ mode = 'default', orderSource }: OrdersPageProps) {
  const { t } = useTranslation(['orders', 'common', 'admin'])
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const isMainOrdersSimple = mode === 'default' && !orderSource
  const rawGroup = searchParams.get('group')
  const group = rawGroup ?? (mode === 'statuses' ? 'all' : 'yangi')
  const syncedFrom = searchParams.get('synced_from') ?? ''
  const searchQuery = searchParams.get('q') ?? ''
  const brandFilter = searchParams.get('brand_id') ?? ''
  const dateFrom = searchParams.get('date_from') ?? ''
  const dateTo = searchParams.get('date_to') ?? ''
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10))
  const movementWmsStatusQuery = useMemo<MovementWmsFilter>(() => {
    const rawWms = searchParams.get('wms_status')
    if (rawWms && rawWms.trim()) {
      const v = rawWms.trim().toLowerCase()
      if (['new', 'picking', 'review', 'completed', 'cancelled', 'all'].includes(v)) {
        return v as MovementWmsFilter
      }
    }
    // Legacy fallback from old smartup_status links.
    const rawSmartup = searchParams.get('smartup_status')
    if (rawSmartup && rawSmartup.trim()) {
      const low = rawSmartup.trim().toLowerCase()
      if (low === 'w') return 'new'
      if (low === 'all' || low === '*') return 'all'
      if (low === 'n') return 'all'
    }
    return 'new'
  }, [searchParams])
  // Asosiy tab (`/admin/orders`) statussiz ishlaydi; qolgan tablarda eski group->status mantiqi saqlanadi.
  const statusParam = normalizeOrderListStatusParam(
    isMainOrdersSimple
      ? 'imported'
      : orderSource === 'diller' && group === 'yangi'
        ? 'W'
        : orderSource
          ? (GROUP_TO_STATUS[group] ?? undefined)
          : mode === 'default' && group === 'all'
            ? undefined
            : mode === 'statuses' && group === 'all'
              ? undefined
              : (GROUP_TO_STATUS[group] ?? GROUP_TO_STATUS.all)
  )
  const mainOrdersSource = isMainOrdersSimple ? 'smartup' : orderSource

  const onlyNotSentToPicking =
    !isMainOrdersSimple && mode === 'default' && !orderSource && (group === 'yangi' || group === 'xom')
  const SENT_TO_PICKING_STATUSES = new Set(['allocated', 'picking'])
  const { has, isWarehouseAdmin } = useAuth()
  const canSync = has('orders:write')
  const canSend = has('orders:write')
  const canEditStatus = isWarehouseAdmin
  const toMovementStatusLabel = useCallback(
    (rawStatus: unknown): string => {
      const raw = String(rawStatus ?? '').trim().toUpperCase()
      if (!raw) return '—'
      if (raw === 'N') return t('orders:movement_status.new')
      if (raw === 'W' || raw === 'B#W') return t('orders:movement_status.new')
      if (raw === 'C') return t('orders:status_simple.yigishda')
      if (raw === 'L') return t('orders:status_simple.tekshiruvda')
      if (raw === 'S') return t('orders:status_simple.yakunlash')
      if (['P', 'PICKED', 'REVIEW', 'CHECK'].includes(raw)) return t('orders:status_simple.tekshiruvda')
      return raw
    },
    [t]
  )

  /** Tashkiliy harakat: WMS buyurtma holati bo'lsa buyurtmalar jadvali bilan bir xil yorliq */
  const getMovementRowStatusLabel = useCallback(
    (m: MovementItem): string => {
      const wms = m.wms_order_status
      if (wms != null && String(wms).trim() !== '') {
        const simple = backendStatusToSimple(String(wms).trim())
        const opt = SIMPLE_STATUS_OPTIONS.find((o) => o.value === simple)
        return opt ? t(opt.labelKey) : String(wms)
      }
      return toMovementStatusLabel(m.status)
    },
    [t, toMovementStatusLabel]
  )

  const { config, updateConfig, resetConfig } = useOrdersTableConfig()
  const dillerTableConfig = useDillerTableConfig()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const [brands, setBrands] = useState<Brand[]>([])
  const [filterBrandId, setFilterBrandId] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterOrderGroup, setFilterOrderGroup] = useState('yangi')
  const [items, setItems] = useState<OrderListItem[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())
  const [sendDialogOrderIds, setSendDialogOrderIds] = useState<string[] | null>(null)
  const [reassignDialogOrderIds, setReassignDialogOrderIds] = useState<string[] | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<{
    created: number
    updated: number
    skipped: number
    detail?: string | null
    errors_count?: number | null
    debug?: SmartupSyncResult['debug']
  } | null>(null)
  const [selectedMovementIds] = useState<Set<string>>(new Set())
  const [, setCheckResult] = useState<OrderCheckResponse | null>(null)

  const ordersLoadAbortRef = useRef<AbortController | null>(null)
  const ordersLoadGenRef = useRef(0)

  const ELIGIBLE_PICKING_STATUSES = new Set(['imported', 'W', 'allocated'])
  const canBeSentToPicking = (order: OrderListItem) =>
    canSend && ELIGIBLE_PICKING_STATUSES.has(order.status)
  const eligibleItems = useMemo(
    () => items.filter((o) => ELIGIBLE_PICKING_STATUSES.has(o.status)),
    [items]
  )

  const canReassignPicker = useCallback(
    (order: OrderListItem) => canSend && order.has_so && order.status === 'allocated',
    [canSend]
  )

  const load = useCallback(async (background = false, _forceRefresh?: boolean) => {
    ordersLoadAbortRef.current?.abort()
    const ac = new AbortController()
    ordersLoadAbortRef.current = ac
    const signal = ac.signal
    const gen = ++ordersLoadGenRef.current

    if (!background) {
      setIsLoading(true)
      setError(null)
    } else {
      setIsRefreshing(true)
    }
    try {
      if (orderSource === 'diller') {
        const query: Record<string, string | number | undefined> = {
          order_source: 'diller',
          q: searchQuery.trim() || undefined,
          brand_ids: brandFilter.trim() ? brandFilter.trim() : undefined,
          date_from: dateFrom.trim() || undefined,
          date_to: dateTo.trim() || undefined,
          search_fields:
            dillerTableConfig.config.searchFields.length > 0
              ? dillerTableConfig.config.searchFields.join(',')
              : undefined,
          limit: PAGE_SIZE,
          offset,
          filial_id: 'all',
        }
        // DB: GET /orders?order_source=diller&status=W — faqat yangi tashkiliy harakatlar
        query.status = group === 'yangi' ? 'W' : statusParam || 'W'
        const data = await getOrders(query, { signal })
        if (gen !== ordersLoadGenRef.current) return
        setItems(data.items)
        setTotal(data.total)
        return
      }
      const loadAllBS =
        !isMainOrdersSimple &&
        !orderSource &&
        mode === 'default' &&
        (group === 'yangi' || group === 'xom') &&
        statusParam === 'imported'

      if (loadAllBS) {
        const allItems: OrderListItem[] = []
        let off = 0
        let hasMore = true
        while (hasMore) {
          const data = await getOrders(
            {
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
              ...(mainOrdersSource ? { order_source: mainOrdersSource } : {}),
            },
            { signal }
          )
          if (gen !== ordersLoadGenRef.current || signal.aborted) return
          allItems.push(...data.items)
          hasMore = data.items.length >= BULK_PAGE_SIZE && allItems.length < data.total
          off += BULK_PAGE_SIZE
        }
        const list = onlyNotSentToPicking
          ? allItems.filter((o) => !SENT_TO_PICKING_STATUSES.has(o.status))
          : allItems
        if (gen !== ordersLoadGenRef.current) return
        setItems(list)
        setTotal(list.length)
      } else {
        const query: Record<string, string | number | undefined> = {
          q: searchQuery.trim() || undefined,
          created_from: isMainOrdersSimple && syncedFrom.trim() ? syncedFrom.trim() : undefined,
          brand_ids: brandFilter.trim() ? brandFilter.trim() : undefined,
          date_from: dateFrom.trim() || undefined,
          date_to: dateTo.trim() || undefined,
          search_fields:
            config.searchFields.length > 0 ? config.searchFields.join(',') : undefined,
          limit: PAGE_SIZE,
          offset,
          filial_id: 'all',
          ...(mainOrdersSource ? { order_source: mainOrdersSource } : {}),
        }
        if (statusParam) query.status = statusParam
        const data = await getOrders(query, { signal })
        if (gen !== ordersLoadGenRef.current) return
        const list = onlyNotSentToPicking
          ? data.items.filter((o) => !SENT_TO_PICKING_STATUSES.has(o.status))
          : data.items
        setItems(list)
        setTotal(data.total)
      }
    } catch (err) {
      if (signal.aborted || gen !== ordersLoadGenRef.current) return
      if (!background) {
        const message =
          err &&
          typeof err === 'object' &&
          'message' in err &&
          typeof (err as { message: unknown }).message === 'string'
            ? String((err as { message: string }).message)
            : err instanceof Error
              ? err.message
              : t('orders:load_failed')
        setError(message)
      }
    } finally {
      if (gen === ordersLoadGenRef.current) {
        if (!background) setIsLoading(false)
        else setIsRefreshing(false)
      }
    }
  }, [
    config.searchFields,
    dillerTableConfig.config.searchFields,
    group,
    mode,
    mainOrdersSource,
    offset,
    orderSource,
    searchQuery,
    syncedFrom,
    brandFilter,
    dateFrom,
    dateTo,
    statusParam,
    onlyNotSentToPicking,
    movementWmsStatusQuery,
    t,
  ])

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
    if (isMainOrdersSimple && rawGroup === 'all') {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('group', 'yangi')
        next.delete('offset')
        return next
      }, { replace: true })
    }
  }, [isMainOrdersSimple, rawGroup, setSearchParams])

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
      if (!isMainOrdersSimple && mode === 'default' && (!orderSource || orderSource === 'diller')) {
        setFilterOrderGroup(ORDER_GROUP_FILTER_VALUES.has(group) ? group : 'yangi')
      }
      
    }
  }, [
    filterPanelOpen,
    brandFilter,
    dateFrom,
    dateTo,
    group,
    isMainOrdersSimple,
    mode,
    orderSource,
    movementWmsStatusQuery,
  ])

  useEffect(() => {
    setCheckResult(null)
  }, [searchQuery])

  const handleSync = async () => {
    setIsSyncing(true)
    setSyncError(null)
    setSyncResult(null)
    try {
      if (orderSource === 'diller') {
        try {
          // Postman: status=W + modified_on. Filter sanalari bo'lsa ular, aks holda 30 kun.
          const today = new Date()
          const endDealStr = dateTo.trim() || today.toISOString().slice(0, 10)
          const beginDeal = dateFrom.trim()
            ? new Date(`${dateFrom.trim()}T12:00:00`)
            : (() => {
                const d = new Date(today)
                d.setDate(d.getDate() - 30)
                return d
              })()
          const beginDealStr = dateFrom.trim() || beginDeal.toISOString().slice(0, 10)
          const result = await syncSmartupOrders({
            order_source: 'diller',
            begin_deal_date: beginDealStr,
            end_deal_date: endDealStr,
          })
          setSyncResult(result)
        } catch (syncErr) {
          const errStatus = syncErr && typeof syncErr === 'object' && 'status' in syncErr ? (syncErr as { status: number }).status : 0
          if (errStatus === 409) {
            setSyncError(t('orders:sync_busy'))
          } else {
            const message =
              (syncErr && typeof syncErr === 'object' && 'message' in syncErr && typeof (syncErr as { message: unknown }).message === 'string')
                ? (syncErr as { message: string }).message
                : syncErr instanceof Error
                  ? syncErr.message
                  : t('orders:sync_failed')
            setSyncError(message)
          }
        }
        await load(false)
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
      const syncStartedAt = new Date().toISOString()
      try {
        const result = await syncSmartupOrders(payload)
        setSyncResult(result)
        if (isMainOrdersSimple && result.created > 0) {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('synced_from', syncStartedAt)
            next.delete('offset')
            return next
          })
        }
      } catch (syncErr) {
        const status = syncErr && typeof syncErr === 'object' && 'status' in syncErr ? (syncErr as { status: number }).status : 0
        if (status === 409) {
          setSyncError(t('orders:sync_busy'))
        } else {
          const message =
            (syncErr && typeof syncErr === 'object' && 'message' in syncErr && typeof (syncErr as { message: unknown }).message === 'string')
              ? (syncErr as { message: string }).message
              : syncErr instanceof Error
                ? syncErr.message
                : t('orders:sync_failed')
          setSyncError(message)
        }
      }
      await load(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('orders:sync_failed')
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
    const defaultWithStatusTab =
      mode === 'default' &&
      !isMainOrdersSimple &&
      !orderSource &&
      (group === 'yigishda' || group === 'tekshiruvda' || group === 'yakunlangan' || group === 'all')
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
      if (status === 'allocated' || status === 'picking')
        return 'bg-blue-50 dark:bg-blue-950/30'
      if (status === 'picked') return 'bg-amber-50 dark:bg-amber-950/30'
      if (status === 'completed' || status === 'packed' || status === 'shipped')
        return 'bg-emerald-50 dark:bg-emerald-950/30'
      if (status === 'cancelled') return 'bg-slate-100 dark:bg-slate-800/40'
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
              {formatSourceExternalIdDisplay(order.source_external_id) || '—'}
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
        case 'to_filial':
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
        case 'so_document_status':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              {order.so_document_status
                ? t(`orders:doc_status.${order.so_document_status}`, order.so_document_status)
                : '—'}
            </td>
          )
        case 'status':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {t(`orders:status.${order.status}`, order.status)}
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
          return (
            <OrderWmsStatusCell
              key={`wms-${order.id}`}
              orderId={order.id}
              orderNumber={order.order_number}
              status={order.status}
              canEdit={canEditStatus}
              onAfterSave={() => load()}
            />
          )
        case 'picker':
          return (
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
              <div className="flex flex-col gap-1">
                <span>{order.picker_name ?? '—'}</span>
                {canReassignPicker(order) && !visibleColumns.has('send_to_picking') ? (
                  <button
                    type="button"
                    className="text-left text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                    onClick={() => {
                      setSendDialogOrderIds(null)
                      setReassignDialogOrderIds([order.id])
                    }}
                  >
                    {t('orders:reassign_picker.button')}
                  </button>
                ) : null}
              </div>
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
              {canReassignPicker(order) ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSendDialogOrderIds(null)
                    setReassignDialogOrderIds([order.id])
                  }}
                >
                  {t('orders:reassign_picker.button')}
                </Button>
              ) : canSend && canBeSentToPicking(order) ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setReassignDialogOrderIds(null)
                    setSendDialogOrderIds([order.id])
                  }}
                >
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
  }, [
    canEditStatus,
    canReassignPicker,
    canSend,
    config.columnOrder,
    config.visibleColumns,
    dillerTableConfig.config,
    eligibleItems,
    error,
    getMovementRowStatusLabel,
    isLoading,
    items,
    load,
    location.pathname,
    location.search,
    mode,
    navigate,
    orderSource,
    searchQuery,
    selectedMovementIds,
    selectedOrderIds,
    t,
  ])

  return (
    <AdminLayout titleSlot={<OrdersHubTabs />} backTo={mode === 'statuses' ? '/admin' : undefined}>
      <Card className="space-y-4">
        <OrdersSourceSubTabs />
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
                    {!isMainOrdersSimple && mode === 'default' && (!orderSource || orderSource === 'diller') ? (
                      <label className="block text-sm text-slate-600 dark:text-slate-400">
                        {t('orders:filters.order_status_group')}
                        <select
                          value={filterOrderGroup}
                          onChange={(e) => setFilterOrderGroup(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          {ORDER_GROUP_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {t(o.labelKey)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
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
                        if (!isMainOrdersSimple && mode === 'default' && (!orderSource || orderSource === 'diller')) setFilterOrderGroup('yangi')
                        setSearchParams((prev) => {
                          const next = new URLSearchParams(prev)
                          next.delete('brand_id')
                          next.delete('date_from')
                          next.delete('date_to')
                          next.delete('offset')
                          if (!isMainOrdersSimple && mode === 'default' && (!orderSource || orderSource === 'diller')) {
                            next.delete('group')
                          }
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
                          if (!isMainOrdersSimple && mode === 'default' && (!orderSource || orderSource === 'diller')) {
                            if (filterOrderGroup === 'yangi') next.delete('group')
                            else next.set('group', filterOrderGroup)
                          }
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
        {((!isMainOrdersSimple && group && group !== 'all') || isRefreshing || syncResult) ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            {!isMainOrdersSimple && group && group !== 'all' ? (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                {group === 'yangi'
                  ? t('orders:tabs.yangi_bw')
                  : group === 'xom'
                    ? t('admin:dashboard.status_xom')
                    : t(`admin:dashboard.status_${group}`)}
              </span>
            ) : null}
            {isRefreshing ? (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                {t('orders:refreshing')}
              </span>
            ) : null}
            {syncResult ? (
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

        {mode !== 'statuses' && canSend && selectedOrderIds.size > 0 ? (
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
                onClick={() => {
                  setReassignDialogOrderIds(null)
                  setSendDialogOrderIds(Array.from(selectedOrderIds))
                }}
              >
                {t('orders:send_to_picking.button')}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="relative min-h-[calc(100vh-320px)] overflow-auto">
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
            <>
                {(() => {
                const isAllBSLoaded =
                  !isMainOrdersSimple &&
                  !orderSource &&
                  mode === 'default' &&
                  (group === 'yangi' || group === 'xom') &&
                  statusParam === 'imported'
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
        </div>
      </Card>

      {mode !== 'statuses' ? (
        <>
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
          <SendToPickingDialog
            mode="reassign"
            open={reassignDialogOrderIds !== null}
            orderIds={reassignDialogOrderIds ?? []}
            onOpenChange={(open) => !open && setReassignDialogOrderIds(null)}
            onSent={() => {
              setReassignDialogOrderIds(null)
              void load(true)
            }}
          />
        </>
      ) : null}
      
      <OrdersTableSettings
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        config={orderSource === 'diller' ? dillerTableConfig.config : config}
        columns={
          (orderSource === 'diller'
            ? COLUMN_OPTIONS_DILLER
            : mode === 'statuses'
              ? COLUMN_OPTIONS_STATUSES
              : mode === 'default'
                ? COLUMN_OPTIONS_DEFAULT
                : COLUMN_OPTIONS
          ).map((column) => ({
            id: column.id,
            label: t(column.labelKey),
          }))
        }
        searchFields={(orderSource === 'diller' ? SEARCH_FIELD_OPTIONS_DILLER : SEARCH_FIELD_OPTIONS).map(
          (field) => ({
            id: field.id,
            label: t(field.labelKey),
          })
        )}
        onSave={orderSource === 'diller' ? dillerTableConfig.updateConfig : updateConfig}
        onReset={orderSource === 'diller' ? dillerTableConfig.resetConfig : resetConfig}
      />
    </AdminLayout>
  )
}
