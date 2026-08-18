import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Package,
  ClipboardList,
  SearchCheck,
  PackageCheck,
  LayoutGrid,
  AlertTriangle,
  RefreshCw,
  BarChart3,
  type LucideIcon,
} from 'lucide-react'
import * as XLSX from 'xlsx'

import { AdminLayout } from '../../admin/components/AdminLayout'
import {
  StaffOrdersDialog,
  type StaffSelection,
} from '../../admin/components/dashboard/StaffOrdersDialog'
import { StaffPayrollSection } from '../../admin/components/dashboard/StaffPayrollSection'
import { StaffProTable, type StaffProRow } from '../../admin/components/dashboard/StaffProTable'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import {
  getOrdersByStatus,
  getPickingOrderStats,
  getPickingStaffStats,
  getStaffCancelledStats,
  getStaffTiming,
  type PickingOrderStats,
  type PickingStaffStatsRow,
  type StaffTimingControllerRow,
  type StaffTimingPickerRow,
  type CancelledPickerRow,
} from '../../services/dashboardApi'
import { useAppToast } from '../../feedback/useAppToast'
import { getReserveStuckSummary } from '../../services/inventoryApi'
import { formatDuration } from '../../lib/formatDuration'
import { writeExcelFile } from '../../utils/exportExcel'
import { useAuth } from '../../rbac/AuthProvider'

// Haftalik faollik diagrammasi accent rangi (dashboard asosiy ko'k rangi)
const ACCENT = '#2563eb'

// Yangi = Smartupdan kelgan, admin yig'uvchiga yubormagan
const STATUS_XOM = ['imported']
// Yig'ishda = admin yuborgan, yig'uvchi yig'ib controllerga yubormagan (allocated → picking)
const STATUS_YIGISHDA = ['allocated', 'picking']
// Tekshiruvda = yig'uvchi controllerga yuborgan, controller yakunlamagan
const STATUS_TEKSHIRUVDA = ['picked']
// Yakunlangan = controller tekshirib yakunlagan (completed) yoki packed/shipped
const STATUS_YAKUNLANGAN = ['completed', 'packed', 'shipped']

function aggregateByFourGroups(
  rows: { status: string; count: number }[]
): { xom: number; yigishda: number; tekshiruvda: number; yakunlangan: number } {
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]))
  const sum = (statuses: string[]) => statuses.reduce((acc, s) => acc + (byStatus[s] ?? 0), 0)
  return {
    xom: sum(STATUS_XOM),
    yigishda: sum(STATUS_YIGISHDA),
    tekshiruvda: sum(STATUS_TEKSHIRUVDA),
    yakunlangan: sum(STATUS_YAKUNLANGAN),
  }
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatAvgPerDay(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

/** Excel worksheet name: max 31 chars, no \\ / ? * [ ] : */
function sheetNameSafe(label: string): string {
  const cleaned = label.replace(/[:\\/?*[\]]/g, ' ').trim()
  return (cleaned.slice(0, 31) || 'Sheet').trim()
}

const WEEKDAY_SHORT: Record<string, string[]> = {
  // 0 = Yakshanba (Sunday)
  uz: ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'],
  ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

function weekdayShort(isoDate: string, lang: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return ''
  const idx = new Date(y, m - 1, d).getDay()
  const table = WEEKDAY_SHORT[lang] ?? WEEKDAY_SHORT.en
  return table[idx] ?? ''
}

type KpiTone = 'amber' | 'blue' | 'violet' | 'emerald'

const KPI_TONE: Record<KpiTone, string> = {
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
}

function KpiTile({
  label,
  value,
  icon: Icon,
  tone,
  onClick,
}: {
  label: string
  value: string | number
  icon: LucideIcon
  tone: KpiTone
  onClick?: () => void
}) {
  const interactive = typeof onClick === 'function'
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      className={[
        'rounded-[18px] border border-slate-200 bg-white p-[18px] transition dark:border-slate-800 dark:bg-slate-900',
        interactive
          ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-12px_rgba(15,23,42,0.18)]'
          : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-[11px] ${KPI_TONE[tone]}`}
        >
          <Icon size={20} />
        </div>
      </div>
      <div className="wms-num mt-3.5 text-[30px] font-extrabold leading-none tracking-[-1px] text-slate-900 dark:text-slate-100">
        {value}
      </div>
      <div className="mt-0.5 text-[13px] font-semibold text-slate-500 dark:text-slate-400">
        {label}
      </div>
    </div>
  )
}

function AccentKpiTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      className="rounded-[18px] p-[18px] text-white shadow-sm"
      style={{ background: 'linear-gradient(160deg, #2563eb, #1e40af)' }}
    >
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-white/20">
          <LayoutGrid size={20} />
        </div>
      </div>
      <div className="wms-num mt-3.5 text-[30px] font-extrabold leading-none tracking-[-1px]">
        {value}
      </div>
      <div className="mt-0.5 text-[13px] font-semibold text-white/80">{label}</div>
    </div>
  )
}

function WeeklyActivityCard({
  daily,
  todayCompleted,
  periodTotal,
  avgPerDay,
  isLoading,
  lang,
  t,
}: {
  daily: PickingOrderStats['daily']
  todayCompleted: number
  periodTotal: number
  avgPerDay: number
  isLoading: boolean
  lang: string
  t: (key: string) => string
}) {
  const points = daily ?? []
  const maxValue = Math.max(1, ...points.map((p) => p.count))
  const dash = '—'
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-[22px] dark:border-slate-800 dark:bg-slate-900">
      <div className="text-base font-extrabold tracking-[-0.3px] text-slate-900 dark:text-slate-100">
        {t('admin:dashboard.weekly_activity_title')}
      </div>
      <div className="text-[13px] font-medium text-slate-400">
        {t('admin:dashboard.weekly_activity_sub')}
      </div>
      <div className="my-[18px] grid grid-cols-3 gap-3">
        {[
          { label: t('admin:dashboard.weekly_today'), value: todayCompleted },
          { label: t('admin:dashboard.weekly_period_total'), value: periodTotal },
          { label: t('admin:dashboard.weekly_avg'), value: avgPerDay },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-[14px] border border-slate-100 px-3.5 py-3 dark:border-slate-800"
          >
            <div className="text-xs font-semibold text-slate-400">{s.label}</div>
            <div className="wms-num mt-1 text-[22px] font-extrabold text-slate-900 dark:text-slate-100">
              {isLoading ? dash : formatAvgPerDay(s.value)}
            </div>
          </div>
        ))}
      </div>
      {isLoading ? (
        <div className="relative h-[210px]">
          <LoadingOverlay label="" />
        </div>
      ) : points.length === 0 ? (
        <div className="flex h-[210px] flex-col items-center justify-center gap-2 text-slate-400">
          <BarChart3 size={28} className="opacity-50" aria-hidden />
          <span className="text-sm font-medium">{t('admin:dashboard.weekly_no_data')}</span>
        </div>
      ) : (
        <div className="flex h-[210px] items-end justify-between gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
          {points.map((p, i) => {
            const isToday = i === points.length - 1
            const h = Math.max(6, Math.round((p.count / maxValue) * 130))
            const barStyle: CSSProperties = isToday
              ? {
                  height: `${h}px`,
                  borderRadius: '9px 9px 4px 4px',
                  background: `linear-gradient(180deg, ${ACCENT}, color-mix(in srgb, ${ACCENT} 78%, #1e1b4b))`,
                  boxShadow: `0 10px 20px -8px color-mix(in srgb, ${ACCENT} 50%, transparent)`,
                }
              : {
                  height: `${h}px`,
                  borderRadius: '9px 9px 4px 4px',
                  background: `linear-gradient(180deg, color-mix(in srgb, ${ACCENT} 55%, #fff), color-mix(in srgb, ${ACCENT} 34%, #fff))`,
                }
            return (
              <div
                key={p.date}
                className="flex h-full flex-1 flex-col items-center justify-end gap-2"
              >
                <div
                  className={`text-xs tabular-nums ${isToday ? 'font-extrabold text-blue-600 dark:text-blue-400' : 'font-bold text-slate-500 dark:text-slate-400'}`}
                >
                  {p.count}
                </div>
                <div
                  className="w-full max-w-[52px] shrink-0 transition-[filter] duration-[180ms] ease-out hover:brightness-[1.08]"
                  style={barStyle}
                />
                <div
                  className={`text-xs ${isToday ? 'font-extrabold text-blue-600 dark:text-blue-400' : 'font-semibold text-slate-400'}`}
                >
                  {weekdayShort(p.date, lang)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

type PipelineRow = { label: string; count: number; color: string }

function PipelineCard({
  rows,
  total,
  t,
}: {
  rows: PipelineRow[]
  total: number
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-[22px] dark:border-slate-800 dark:bg-slate-900">
      <div className="text-base font-extrabold tracking-[-0.3px] text-slate-900 dark:text-slate-100">
        {t('admin:dashboard.pipeline_title')}
      </div>
      <div className="text-[13px] font-medium text-slate-400">
        {t('admin:dashboard.pipeline_sub', { count: total })}
      </div>
      <div className="mt-5 flex flex-col gap-4">
        {rows.map((r) => {
          const pct = total > 0 ? Math.round((r.count / total) * 100) : 0
          return (
            <div key={r.label}>
              <div className="mb-[7px] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="h-[9px] w-[9px] rounded-[3px]"
                    style={{ backgroundColor: r.color }}
                  />
                  <span className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">
                    {r.label}
                  </span>
                </div>
                <span className="wms-num text-sm font-extrabold text-slate-900 dark:text-slate-100">
                  {r.count} · {pct}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: r.color }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type TimingLite = {
  user_id: string
  full_name: string
  /** Unumdorlik pozitsiya bo'yicha o'lchanadi — dona xodim mehnatini aks ettirmaydi. */
  positions_per_hour: number
  median_seconds: number
  total_positions: number
}

/** Reyting (shahar+region) + unumdorlik/median ni xodim bo'yicha birlashtiradi. */
function buildProRows(
  shaharRows: PickingStaffStatsRow[],
  regionRows: PickingStaffStatsRow[],
  timing: TimingLite[],
  cancelled: CancelledPickerRow[] = []
): StaffProRow[] {
  const map = new Map<string, StaffProRow>()
  const ensure = (user_id: string, full_name: string): StaffProRow => {
    let r = map.get(user_id)
    if (!r) {
      r = {
        user_id,
        full_name,
        shahar_orders: 0,
        shahar_positions: 0,
        shahar_qty: 0,
        region_orders: 0,
        region_positions: 0,
        region_qty: 0,
        cancelled_orders: 0,
        cancelled_positions: 0,
        cancelled_qty: 0,
        pending_returns: 0,
        total_qty: 0,
        positions_per_hour: 0,
        median_seconds: 0,
        work_hours: 0,
      }
      map.set(user_id, r)
    }
    if (!r.full_name && full_name) r.full_name = full_name
    return r
  }
  for (const row of shaharRows) {
    const r = ensure(row.user_id, row.full_name)
    r.shahar_orders += row.documents_count
    r.shahar_positions += row.lines_count
    r.shahar_qty += row.total_picked_qty
  }
  for (const row of regionRows) {
    const r = ensure(row.user_id, row.full_name)
    r.region_orders += row.documents_count
    r.region_positions += row.lines_count
    r.region_qty += row.total_picked_qty
  }
  for (const row of cancelled) {
    const r = ensure(row.user_id, row.full_name)
    r.cancelled_orders += row.documents_count
    r.cancelled_positions += row.positions
    r.cancelled_qty += row.qty
    r.pending_returns = row.pending_returns
  }
  for (const tr of timing) {
    const r = ensure(tr.user_id, tr.full_name)
    r.positions_per_hour = tr.positions_per_hour
    r.median_seconds = tr.median_seconds
    r.work_hours = tr.positions_per_hour > 0 ? tr.total_positions / tr.positions_per_hour : 0
  }
  for (const r of map.values()) {
    r.total_qty = r.shahar_qty + r.region_qty + r.cancelled_qty
  }
  return [...map.values()].sort(
    (a, b) => b.total_qty - a.total_qty || a.full_name.localeCompare(b.full_name)
  )
}

/** KPI kartalari — faqat to'liq yakunlangan hujjatlar jamidan (guruhsiz). */
function computeStaffKpi(
  completedRows: PickingStaffStatsRow[],
  timing: TimingLite[],
  cancelled: CancelledPickerRow[] = []
): { orders: number; positions: number; qty: number; speed: number } {
  const orders =
    completedRows.reduce((s, r) => s + r.documents_count, 0) +
    cancelled.reduce((s, r) => s + r.documents_count, 0)
  const positions =
    completedRows.reduce((s, r) => s + r.lines_count, 0) +
    cancelled.reduce((s, r) => s + r.positions, 0)
  const qty =
    completedRows.reduce((s, r) => s + r.total_picked_qty, 0) +
    cancelled.reduce((s, r) => s + r.qty, 0)
  const hours = timing.reduce(
    (s, tr) => s + (tr.positions_per_hour > 0 ? tr.total_positions / tr.positions_per_hour : 0),
    0
  )
  return { orders, positions, qty, speed: hours > 0 ? positions / hours : 0 }
}

export function DashboardPage() {
  const { t, i18n } = useTranslation(['admin', 'common', 'inventory', 'receiving'])
  const navigate = useNavigate()
  const { user } = useAuth()
  const [ordersByStatus, setOrdersByStatus] = useState<{ status: string; count: number }[]>([])
  const [pickerRows, setPickerRows] = useState<PickingStaffStatsRow[]>([])
  const [controllerRows, setControllerRows] = useState<PickingStaffStatsRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { showError, showSuccess, showInfo } = useAppToast()
  const [hasLoadError, setHasLoadError] = useState(false)
  const [dateFrom, setDateFrom] = useState(todayIsoDate)
  const [dateTo, setDateTo] = useState(todayIsoDate)
  const [pickingOrderStats, setPickingOrderStats] = useState<PickingOrderStats | null>(null)
  const [pickingStatsUnavailable, setPickingStatsUnavailable] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [stuckRowsCount, setStuckRowsCount] = useState(0)
  const [selectedStaff, setSelectedStaff] = useState<StaffSelection | null>(null)
  const [regionPickerRows, setRegionPickerRows] = useState<PickingStaffStatsRow[]>([])
  const [regionControllerRows, setRegionControllerRows] = useState<PickingStaffStatsRow[]>([])
  const [timingPickers, setTimingPickers] = useState<StaffTimingPickerRow[]>([])
  const [cancelledRows, setCancelledRows] = useState<CancelledPickerRow[]>([])
  const [timingControllers, setTimingControllers] = useState<StaffTimingControllerRow[]>([])
  // KPI kartalari uchun — faqat to'liq yakunlangan (completed) hujjatlar (guruhsiz jami).
  const [completedPickers, setCompletedPickers] = useState<PickingStaffStatsRow[]>([])
  const [completedControllers, setCompletedControllers] = useState<PickingStaffStatsRow[]>([])
  const [stuckOrdersCount, setStuckOrdersCount] = useState(0)
  const [stuckOldestHours, setStuckOldestHours] = useState(0)

  const counts = useMemo(() => aggregateByFourGroups(ordersByStatus), [ordersByStatus])
  const totalOrders = counts.xom + counts.yigishda + counts.tekshiruvda + counts.yakunlangan

  const pickerProRows = useMemo(
    () =>
      buildProRows(
        pickerRows,
        regionPickerRows,
        timingPickers.map((tp) => ({
          user_id: tp.user_id,
          full_name: tp.full_name,
          positions_per_hour: tp.positions_per_hour,
          median_seconds: tp.median_seconds,
          total_positions: tp.total_positions,
        })),
        cancelledRows
      ),
    [pickerRows, regionPickerRows, timingPickers, cancelledRows]
  )
  const controllerProRows = useMemo(
    () =>
      buildProRows(
        controllerRows,
        regionControllerRows,
        timingControllers.map((tc) => ({
          user_id: tc.user_id,
          full_name: tc.full_name,
          positions_per_hour: tc.positions_per_hour,
          median_seconds: tc.median_check_seconds || tc.median_total_seconds,
          total_positions: tc.total_positions,
        }))
      ),
    [controllerRows, regionControllerRows, timingControllers]
  )

  const pickerKpi = useMemo(
    () =>
      computeStaffKpi(
        completedPickers,
        timingPickers.map((tp) => ({
          user_id: tp.user_id,
          full_name: tp.full_name,
          positions_per_hour: tp.positions_per_hour,
          median_seconds: tp.median_seconds,
          total_positions: tp.total_positions,
        })),
        cancelledRows
      ),
    [completedPickers, timingPickers, cancelledRows]
  )
  const controllerKpi = useMemo(
    () =>
      computeStaffKpi(
        completedControllers,
        timingControllers.map((tc) => ({
          user_id: tc.user_id,
          full_name: tc.full_name,
          positions_per_hour: tc.positions_per_hour,
          median_seconds: tc.median_check_seconds || tc.median_total_seconds,
          total_positions: tc.total_positions,
        }))
      ),
    [completedControllers, timingControllers]
  )

  const load = useCallback(async () => {
    setIsLoading(true)
    setHasLoadError(false)
    try {
      const dateFromQ = dateFrom.trim() || undefined
      const dateToQ = dateTo.trim() || undefined
      const today = todayIsoDate()
      const shouldAvgAllTime = dateFrom.trim() === today && dateTo.trim() === today
      const [
        ordersByStatusData,
        staffData,
        regionStaffData,
        timingData,
        completedStaffData,
        pickingStats,
        stuckMain,
        stuckShowroom,
        cancelledData,
      ] = await Promise.all([
        getOrdersByStatus().catch(() => []),
        getPickingStaffStats({
          date_from: dateFromQ,
          date_to: dateToQ,
          group: 'shahar',
        }).catch(() => ({ pickers: [], controllers: [] })),
        getPickingStaffStats({
          date_from: dateFromQ,
          date_to: dateToQ,
          group: 'region',
        }).catch(() => ({ pickers: [], controllers: [] })),
        getStaffTiming({ date_from: dateFromQ, date_to: dateToQ }).catch(() => ({
          pickers: [],
          controllers: [],
        })),
        getPickingStaffStats({
          date_from: dateFromQ,
          date_to: dateToQ,
          completed_only: true,
        }).catch(() => ({ pickers: [], controllers: [] })),
        getPickingOrderStats({
          date_from: dateFromQ,
          date_to: dateToQ,
          avg_all_time: shouldAvgAllTime,
        }).catch(() => null),
        getReserveStuckSummary({ warehouse: 'main', age_hours: 48, sample_limit: 3 }).catch(
          () => null,
        ),
        getReserveStuckSummary({ warehouse: 'showroom', age_hours: 48, sample_limit: 3 }).catch(
          () => null,
        ),
        getStaffCancelledStats({ date_from: dateFromQ, date_to: dateToQ }).catch(() => []),
      ])
      setOrdersByStatus(Array.isArray(ordersByStatusData) ? ordersByStatusData : [])
      setPickerRows(Array.isArray(staffData?.pickers) ? staffData.pickers : [])
      setControllerRows(Array.isArray(staffData?.controllers) ? staffData.controllers : [])
      setRegionPickerRows(Array.isArray(regionStaffData?.pickers) ? regionStaffData.pickers : [])
      setRegionControllerRows(
        Array.isArray(regionStaffData?.controllers) ? regionStaffData.controllers : []
      )
      setTimingPickers(Array.isArray(timingData?.pickers) ? timingData.pickers : [])
      setTimingControllers(Array.isArray(timingData?.controllers) ? timingData.controllers : [])
      setCompletedPickers(Array.isArray(completedStaffData?.pickers) ? completedStaffData.pickers : [])
      setCompletedControllers(
        Array.isArray(completedStaffData?.controllers) ? completedStaffData.controllers : []
      )
      setCancelledRows(Array.isArray(cancelledData) ? cancelledData : [])
      setPickingOrderStats(pickingStats)
      setPickingStatsUnavailable(pickingStats == null)
      const stuckTotal = (stuckMain?.stuck_rows_count ?? 0) + (stuckShowroom?.stuck_rows_count ?? 0)
      const stuckOrders =
        (stuckMain?.stuck_orders_count ?? 0) + (stuckShowroom?.stuck_orders_count ?? 0)
      const oldest = Math.max(stuckMain?.oldest_hours ?? 0, stuckShowroom?.oldest_hours ?? 0)
      setStuckRowsCount(stuckTotal)
      setStuckOrdersCount(stuckOrders)
      setStuckOldestHours(oldest)
    } catch {
      showError(t('admin:dashboard.load_error'))
      setHasLoadError(true)
      setStuckRowsCount(0)
      setStuckOrdersCount(0)
      setStuckOldestHours(0)
      setCompletedPickers([])
      setCompletedControllers([])
      setPickingOrderStats(null)
      setPickingStatsUnavailable(false)
    } finally {
      setIsLoading(false)
    }
  }, [t, dateFrom, dateTo, showError])

  const resetStatsDatesToToday = () => {
    const today = todayIsoDate()
    setDateFrom(today)
    setDateTo(today)
  }

  useEffect(() => {
    void load()
  }, [load])

  const handleExportProExcel = useCallback(
    async (rows: StaffProRow[], sheetTitle: string, tag: string) => {
      if (rows.length === 0) return
      showInfo(t('receiving:export_fetching'), 4000)
      setIsExporting(true)
      try {
        const durUnits = {
          h: t('admin:dashboard.timing.h'),
          m: t('admin:dashboard.timing.m'),
          s: t('admin:dashboard.timing.s'),
        }
        const sh = t('admin:dashboard.pro.col_shahar')
        const rg = t('admin:dashboard.pro.col_region')
        const oc = t('admin:dashboard.pro.hdr_orders')
        const ps = t('admin:dashboard.pro.hdr_positions')
        const un = t('admin:dashboard.pro.hdr_units')
        const headers = [
          '#',
          t('admin:dashboard.pro.col_staff'),
          `${sh} · ${oc}`,
          `${sh} · ${ps}`,
          `${sh} · ${un}`,
          `${rg} · ${oc}`,
          `${rg} · ${ps}`,
          `${rg} · ${un}`,
          `${t('admin:dashboard.pro.col_cancelled')} · ${oc}`,
          `${t('admin:dashboard.pro.col_cancelled')} · ${ps}`,
          `${t('admin:dashboard.pro.col_cancelled')} · ${un}`,
          `${t('admin:dashboard.pro.col_total')} · ${oc}`,
          `${t('admin:dashboard.pro.col_total')} · ${ps}`,
          t('admin:dashboard.pro.col_qty'),
          `${t('admin:dashboard.pro.col_productivity')} (${t('admin:dashboard.pro.suffix_speed')})`,
          t('admin:dashboard.pro.col_median'),
        ]
        const aoa = rows.map((row, index) => [
          index + 1,
          row.full_name,
          row.shahar_orders,
          row.shahar_positions,
          row.shahar_qty,
          row.region_orders,
          row.region_positions,
          row.region_qty,
          row.cancelled_orders,
          row.cancelled_positions,
          Math.round(row.cancelled_qty),
          row.shahar_orders + row.region_orders + row.cancelled_orders,
          row.shahar_positions + row.region_positions + row.cancelled_positions,
          row.total_qty,
          Math.round(row.positions_per_hour),
          formatDuration(row.median_seconds, durUnits),
        ])
        const wb = XLSX.utils.book_new()
        const ws = XLSX.utils.aoa_to_sheet([headers, ...aoa])
        XLSX.utils.book_append_sheet(wb, ws, sheetNameSafe(sheetTitle))

        const day = new Date().toISOString().slice(0, 10)
        const fromPart = dateFrom.trim() ? dateFrom.trim() : 'all'
        const toPart = dateTo.trim() ? dateTo.trim() : 'all'
        const fileName = `${tag}_stats_${fromPart}_${toPart}_${day}.xlsx`

        await writeExcelFile(wb, fileName)
        showSuccess(t('receiving:export_success'))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        showError(`${t('admin:dashboard.staff_stats_export_failed')}: ${msg}`)
      } finally {
        setIsExporting(false)
      }
    },
    [t, dateFrom, dateTo, showInfo, showSuccess, showError]
  )

  const greetingName = (user?.name || '').trim().split(/\s+/)[0] || (user?.name ?? '')
  const greetingDate = useMemo(() => {
    try {
      return new Date().toLocaleDateString(i18n.language, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        weekday: 'long',
      })
    } catch {
      return todayIsoDate()
    }
  }, [i18n.language])

  const pipelineRows: PipelineRow[] = [
    { label: t('admin:dashboard.status_xom'), count: counts.xom, color: '#d97706' },
    { label: t('admin:dashboard.status_yigishda'), count: counts.yigishda, color: '#2563eb' },
    { label: t('admin:dashboard.status_tekshiruvda'), count: counts.tekshiruvda, color: '#7c3aed' },
    { label: t('admin:dashboard.status_yakunlangan'), count: counts.yakunlangan, color: '#059669' },
  ]

  return (
    <AdminLayout title={t('admin:dashboard.title')}>
      {hasLoadError ? (
        <EmptyState
          title={t('admin:dashboard.load_error')}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      ) : (
        <div className="flex flex-col gap-[22px]">
          {/* Salomlashuv qatori */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[22px] font-extrabold tracking-[-0.5px] text-slate-900 dark:text-slate-100">
                {t('admin:dashboard.greeting', { name: greetingName })}
              </h1>
              <p className="mt-0.5 text-sm font-medium text-slate-500 dark:text-slate-400">
                {t('admin:dashboard.greeting_sub', { date: greetingDate })}
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-[7px] dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]" />
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                {t('admin:dashboard.system_active')}
              </span>
            </div>
          </div>

          {/* KPI qatori */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <KpiTile
              label={t('admin:dashboard.status_xom')}
              value={isLoading ? '—' : counts.xom}
              icon={Package}
              tone="amber"
              onClick={() => navigate('/admin/orders?group=xom')}
            />
            <KpiTile
              label={t('admin:dashboard.status_yigishda')}
              value={isLoading ? '—' : counts.yigishda}
              icon={ClipboardList}
              tone="blue"
              onClick={() => navigate('/admin/picking?group=yigishda')}
            />
            <KpiTile
              label={t('admin:dashboard.status_tekshiruvda')}
              value={isLoading ? '—' : counts.tekshiruvda}
              icon={SearchCheck}
              tone="violet"
              onClick={() => navigate('/admin/picking?group=tekshiruvda')}
            />
            <KpiTile
              label={t('admin:dashboard.status_yakunlangan')}
              value={isLoading ? '—' : counts.yakunlangan}
              icon={PackageCheck}
              tone="emerald"
              onClick={() => navigate('/admin/picking/archive?group=yakunlangan')}
            />
            <AccentKpiTile
              label={t('admin:dashboard.status_barcha')}
              value={isLoading ? '—' : totalOrders}
            />
          </div>

          {/* Sana oralig'i / yangilash toolbar */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              <span>{t('admin:dashboard.staff_stats_date_from')}</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              <span>{t('admin:dashboard.staff_stats_date_to')}</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <Button type="button" variant="secondary" className="shrink-0" onClick={resetStatsDatesToToday}>
              {t('admin:dashboard.staff_stats_clear')}
            </Button>
            <Button type="button" variant="secondary" className="shrink-0" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4 shrink-0" aria-hidden />
              {t('common:buttons.retry')}
            </Button>
            {pickingStatsUnavailable ? (
              <p className="w-full text-xs text-amber-700 dark:text-amber-300">
                {t('admin:dashboard.picking_stats_unavailable')}
              </p>
            ) : null}
          </div>

          {/* O'rta qator: grafik + pipeline/alert */}
          <div className="grid grid-cols-1 items-start gap-[22px] lg:grid-cols-[1.55fr_1fr]">
            <WeeklyActivityCard
              daily={pickingOrderStats?.daily}
              todayCompleted={pickingOrderStats?.completed_today ?? 0}
              periodTotal={pickingOrderStats?.completed_in_period ?? 0}
              avgPerDay={pickingOrderStats?.avg_completed_per_day ?? 0}
              isLoading={isLoading}
              lang={i18n.language}
              t={t}
            />
            <div className="flex flex-col gap-[22px]">
              <PipelineCard rows={pipelineRows} total={totalOrders} t={t} />
              {stuckRowsCount > 0 ? (
                <button
                  type="button"
                  onClick={() => navigate('/admin/inventory/reserve-health?warehouse=main')}
                  className="flex items-start gap-3.5 rounded-[20px] border border-rose-200 bg-rose-50 px-5 py-[18px] text-left transition hover:brightness-[0.99] dark:border-rose-500/30 dark:bg-rose-500/10"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400">
                    <AlertTriangle size={20} />
                  </div>
                  <div>
                    <div className="text-sm font-extrabold text-rose-900 dark:text-rose-200">
                      {t('inventory:reserve_health.stuck_alert_title', { hours: 48 })}
                    </div>
                    <div className="mt-1 text-[13px] font-medium leading-relaxed text-rose-700 dark:text-rose-300">
                      {t('inventory:reserve_health.stuck_alert_desc', {
                        rows: stuckRowsCount,
                        orders: stuckOrdersCount,
                        oldest: stuckOldestHours,
                      })}
                    </div>
                  </div>
                </button>
              ) : null}
            </div>
          </div>

          {/* Xodimlar statistikasi — pro-jadval (Yig'uvchilar / Controllerlar) */}
          <div className="flex flex-col gap-[22px]">
            <StaffProTable
              role="picker"
              title={t('admin:dashboard.pro.pickers_title')}
              subtitle={t('admin:dashboard.pro.subtitle')}
              rows={pickerProRows}
              kpi={pickerKpi}
              isLoading={isLoading}
              onExport={() =>
                void handleExportProExcel(
                  pickerProRows,
                  t('admin:dashboard.pro.pickers_title'),
                  'pickers'
                )
              }
              exportDisabled={isLoading || isExporting || pickerProRows.length === 0}
              isExporting={isExporting}
              emptyLabel={t('admin:dashboard.staff_stats_empty')}
              onRowClick={(row) =>
                setSelectedStaff({ userId: row.user_id, name: row.full_name, role: 'picker' })
              }
              t={t}
            />
            <StaffProTable
              role="controller"
              title={t('admin:dashboard.pro.controllers_title')}
              subtitle={t('admin:dashboard.pro.subtitle')}
              rows={controllerProRows}
              kpi={controllerKpi}
              isLoading={isLoading}
              onExport={() =>
                void handleExportProExcel(
                  controllerProRows,
                  t('admin:dashboard.pro.controllers_title'),
                  'controllers'
                )
              }
              exportDisabled={isLoading || isExporting || controllerProRows.length === 0}
              isExporting={isExporting}
              emptyLabel={t('admin:dashboard.staff_stats_empty')}
              onRowClick={(row) =>
                setSelectedStaff({ userId: row.user_id, name: row.full_name, role: 'controller' })
              }
              t={t}
            />

            {/* Ball (ish haqi davri) — xodim ilovasidagi hisob bilan bitta manba */}
            <StaffPayrollSection t={t} showError={showError} />
          </div>
        </div>
      )}

      <StaffOrdersDialog
        staff={selectedStaff}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onClose={() => setSelectedStaff(null)}
      />
    </AdminLayout>
  )
}
