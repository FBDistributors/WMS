import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Package,
  ClipboardList,
  SearchCheck,
  PackageCheck,
  LayoutGrid,
  FileSpreadsheet,
  Loader2,
  AlertTriangle,
  RefreshCw,
  BarChart3,
  type LucideIcon,
} from 'lucide-react'
import * as XLSX from 'xlsx'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { StaffOrdersDialog, type StaffSelection } from '../../admin/components/dashboard/StaffOrdersDialog'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import {
  getOrdersByStatus,
  getPickingOrderStats,
  getPickingStaffStats,
  type PickingOrderStats,
  type PickingStaffStatsRow,
  type StaffRole,
} from '../../services/dashboardApi'
import { useAppToast } from '../../feedback/useAppToast'
import { getReserveStuckSummary } from '../../services/inventoryApi'
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

function formatQty(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('en-US').replace(/,/g, ' ')
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
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

function nameInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
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

type LeaderTone = 'accent' | 'violet'

function LeaderboardCard({
  title,
  rows,
  tone,
  isLoading,
  onExport,
  exportDisabled,
  isExporting,
  emptyLabel,
  onRowClick,
  t,
}: {
  title: string
  rows: PickingStaffStatsRow[]
  tone: LeaderTone
  isLoading: boolean
  onExport: () => void
  exportDisabled: boolean
  isExporting: boolean
  emptyLabel: string
  onRowClick?: (row: PickingStaffStatsRow) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const maxQty = Math.max(1, ...rows.map((r) => r.total_picked_qty))
  const avatarCls =
    tone === 'accent'
      ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400'
      : 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400'
  const barColor = tone === 'accent' ? '#2563eb' : '#7c3aed'

  const rankCls = (rank: number) => {
    if (rank === 1) return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
    if (rank === 2) return 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
    if (rank === 3) return 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300'
    return 'bg-slate-50 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
  }

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-[22px] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-extrabold tracking-[-0.3px] text-slate-900 dark:text-slate-100">
            {title}
          </div>
          <div className="text-[13px] font-medium text-slate-400">
            {t('admin:dashboard.leaderboard_rating_sub')}
          </div>
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={exportDisabled}
          className="flex shrink-0 items-center gap-1.5 rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-[7px] text-xs font-bold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          {isExporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
          )}
          Excel
        </button>
      </div>

      <div className="relative mt-3 flex flex-col gap-1">
        {isLoading ? (
          <div className="relative min-h-[8rem]">
            <LoadingOverlay label="" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">{emptyLabel}</p>
        ) : (
          rows.map((row, index) => {
            const rank = index + 1
            const pct = Math.round((row.total_picked_qty / maxQty) * 100)
            return (
              <button
                key={row.user_id}
                type="button"
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className="flex w-full items-center gap-3.5 rounded-xl px-2.5 py-[11px] text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <div
                  className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg text-xs font-extrabold ${rankCls(rank)}`}
                >
                  {rank}
                </div>
                <div
                  className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${avatarCls}`}
                >
                  {nameInitials(row.full_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                    {row.full_name}
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: barColor }}
                    />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="wms-num text-[15px] font-extrabold text-slate-900 dark:text-slate-100">
                    {formatQty(row.total_picked_qty)}
                  </div>
                  <div className="text-[11px] font-semibold text-slate-400">
                    {t('admin:dashboard.staff_row_meta', {
                      orders: row.documents_count,
                      lines: row.lines_count,
                    })}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
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

  const openStaffOrders = useCallback(
    (role: StaffRole) => (row: PickingStaffStatsRow) =>
      setSelectedStaff({ userId: row.user_id, name: row.full_name, role }),
    []
  )
  const [stuckOrdersCount, setStuckOrdersCount] = useState(0)
  const [stuckOldestHours, setStuckOldestHours] = useState(0)

  const counts = useMemo(() => aggregateByFourGroups(ordersByStatus), [ordersByStatus])
  const totalOrders = counts.xom + counts.yigishda + counts.tekshiruvda + counts.yakunlangan

  const load = useCallback(async () => {
    setIsLoading(true)
    setHasLoadError(false)
    try {
      const dateFromQ = dateFrom.trim() || undefined
      const dateToQ = dateTo.trim() || undefined
      const today = todayIsoDate()
      const shouldAvgAllTime = dateFrom.trim() === today && dateTo.trim() === today
      const [ordersByStatusData, staffData, pickingStats, stuckMain, stuckShowroom] = await Promise.all([
        getOrdersByStatus().catch(() => []),
        getPickingStaffStats({
          date_from: dateFromQ,
          date_to: dateToQ,
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
      ])
      setOrdersByStatus(Array.isArray(ordersByStatusData) ? ordersByStatusData : [])
      setPickerRows(Array.isArray(staffData?.pickers) ? staffData.pickers : [])
      setControllerRows(Array.isArray(staffData?.controllers) ? staffData.controllers : [])
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

  const staffStatsExportDisabled =
    isLoading || isExporting || (pickerRows.length === 0 && controllerRows.length === 0)

  const handleExportStaffStatsExcel = useCallback(async () => {
    if (pickerRows.length === 0 && controllerRows.length === 0) return
    showInfo(t('receiving:export_fetching'), 4000)
    setIsExporting(true)
    try {
      const headers = [
        t('admin:dashboard.staff_col_rank'),
        t('admin:dashboard.staff_col_name'),
        t('admin:dashboard.staff_col_orders'),
        t('admin:dashboard.staff_col_lines'),
        t('admin:dashboard.staff_col_qty'),
      ]
      const rowsToAoA = (rows: PickingStaffStatsRow[]) =>
        rows.map((row, index) => [
          index + 1,
          row.full_name,
          row.documents_count,
          row.lines_count,
          row.total_picked_qty,
        ])

      const wb = XLSX.utils.book_new()
      if (pickerRows.length > 0) {
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rowsToAoA(pickerRows)])
        XLSX.utils.book_append_sheet(wb, ws, sheetNameSafe(t('admin:dashboard.pickers_table_title')))
      }
      if (controllerRows.length > 0) {
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rowsToAoA(controllerRows)])
        XLSX.utils.book_append_sheet(wb, ws, sheetNameSafe(t('admin:dashboard.controllers_table_title')))
      }

      const day = new Date().toISOString().slice(0, 10)
      const fromPart = dateFrom.trim() ? dateFrom.trim() : 'all'
      const toPart = dateTo.trim() ? dateTo.trim() : 'all'
      const fileName = `picking_staff_stats_${fromPart}_${toPart}_${day}.xlsx`

      await writeExcelFile(wb, fileName)
      showSuccess(t('receiving:export_success'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showError(`${t('admin:dashboard.staff_stats_export_failed')}: ${msg}`)
    } finally {
      setIsExporting(false)
    }
  }, [t, pickerRows, controllerRows, dateFrom, dateTo, showInfo, showSuccess, showError])

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

          {/* Liderbordlar */}
          <div className="grid grid-cols-1 gap-[22px] lg:grid-cols-2">
            <LeaderboardCard
              title={t('admin:dashboard.pickers_table_title')}
              rows={pickerRows}
              tone="accent"
              isLoading={isLoading}
              onExport={() => void handleExportStaffStatsExcel()}
              exportDisabled={staffStatsExportDisabled}
              isExporting={isExporting}
              emptyLabel={t('admin:dashboard.staff_stats_empty')}
              onRowClick={openStaffOrders('picker')}
              t={t}
            />
            <LeaderboardCard
              title={t('admin:dashboard.controllers_table_title')}
              rows={controllerRows}
              tone="violet"
              isLoading={isLoading}
              onExport={() => void handleExportStaffStatsExcel()}
              exportDisabled={staffStatsExportDisabled}
              isExporting={isExporting}
              emptyLabel={t('admin:dashboard.staff_stats_empty')}
              onRowClick={openStaffOrders('controller')}
              t={t}
            />
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
