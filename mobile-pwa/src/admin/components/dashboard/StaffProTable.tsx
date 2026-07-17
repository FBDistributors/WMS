import { FileSpreadsheet, Loader2 } from 'lucide-react'

import { LoadingOverlay } from '../../../components/ui/LoadingOverlay'
import { formatDuration } from '../../../lib/formatDuration'

/** Reyting (shahar+region) + unumdorlik + median birlashgan bitta xodim qatori. */
export type StaffProRow = {
  user_id: string
  full_name: string
  shahar_qty: number
  region_qty: number
  total_qty: number
  positions: number
  orders_count: number
  units_per_hour: number
  median_seconds: number
  work_hours: number
}

type StaffProTableProps = {
  role: 'picker' | 'controller'
  title: string
  subtitle: string
  rows: StaffProRow[]
  isLoading: boolean
  onExport: () => void
  exportDisabled: boolean
  isExporting: boolean
  emptyLabel: string
  t: (key: string, opts?: Record<string, unknown>) => string
}

const GRID_COLS = '222px 72px 72px 1fr 100px 84px 52px'

function fmtQty(n: number): string {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')
}

function nameInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** Rank badge ranglari (medallar + qolganlar). */
function rankStyle(rank: number): { bg: string; fg: string } {
  if (rank === 1) return { bg: '#fef9c3', fg: '#a16207' }
  if (rank === 2) return { bg: '#f1f5f9', fg: '#64748b' }
  if (rank === 3) return { bg: '#fff7ed', fg: '#c2410c' }
  return { bg: '#f8fafc', fg: '#94a3b8' }
}

export function StaffProTable({
  role,
  title,
  subtitle,
  rows,
  isLoading,
  onExport,
  exportDisabled,
  isExporting,
  emptyLabel,
  t,
}: StaffProTableProps) {
  const durUnits = {
    h: t('admin:dashboard.timing.h'),
    m: t('admin:dashboard.timing.m'),
    s: t('admin:dashboard.timing.s'),
  }

  const maxQty = Math.max(1, ...rows.map((r) => r.total_qty))

  // Unumdorlik chipi uchun o'rtacha (faqat uph>0 bo'lganlar).
  const speeds = rows.map((r) => r.units_per_hour).filter((v) => v > 0)
  const avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0

  // KPI agregatsiya — jadval qatorlaridan.
  const kpiOrders = rows.reduce((s, r) => s + r.orders_count, 0)
  const kpiPositions = rows.reduce((s, r) => s + r.positions, 0)
  const kpiQty = rows.reduce((s, r) => s + r.total_qty, 0)
  const totalHours = rows.reduce((s, r) => s + r.work_hours, 0)
  const kpiSpeed = totalHours > 0 ? kpiQty / totalHours : 0

  const avatarLight =
    role === 'picker'
      ? { bg: '#eff6ff', fg: '#2563eb' }
      : { bg: '#f5f3ff', fg: '#7c3aed' }
  const barGradient =
    role === 'picker'
      ? 'linear-gradient(90deg, #93c5fd, #2563eb)'
      : 'linear-gradient(90deg, #c4b5fd, #7c3aed)'

  const chipStyle = (uph: number): { bg: string; fg: string } => {
    if (avgSpeed <= 0 || uph <= 0) return { bg: '#f1f5f9', fg: '#64748b' }
    if (uph > avgSpeed * 1.15) return { bg: '#dcfce7', fg: '#15803d' }
    if (uph < avgSpeed * 0.55) return { bg: '#fee2e2', fg: '#b91c1c' }
    return { bg: '#f1f5f9', fg: '#64748b' }
  }

  const headCls =
    'text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500'

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-[22px] dark:border-slate-800 dark:bg-slate-900">
      {/* 1. Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-extrabold tracking-[-0.3px] text-slate-900 dark:text-slate-100">
            {title}
          </div>
          <div className="whitespace-nowrap text-[12.5px] font-medium text-slate-400 dark:text-slate-500">
            {subtitle}
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

      {/* 2. KPI qatori */}
      <div className="mb-4 mt-4 grid grid-cols-4 gap-2.5">
        <div
          className="rounded-[13px] px-3.5 py-[11px] text-white"
          style={{ background: 'linear-gradient(135deg, #2563eb, #1e40af)' }}
        >
          <div className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-white/75">
            {t('admin:dashboard.pro.kpi_orders')}
          </div>
          <div className="wms-num text-[20px] font-extrabold text-white">
            {isLoading ? '—' : fmtQty(kpiOrders)}
          </div>
        </div>
        <KpiCell
          label={t('admin:dashboard.pro.kpi_positions')}
          value={isLoading ? '—' : fmtQty(kpiPositions)}
          suffix={t('admin:dashboard.pro.suffix_pos')}
        />
        <KpiCell
          label={t('admin:dashboard.pro.kpi_qty')}
          value={isLoading ? '—' : fmtQty(kpiQty)}
        />
        <KpiCell
          label={t('admin:dashboard.pro.kpi_speed')}
          value={isLoading ? '—' : fmtQty(kpiSpeed)}
          suffix={t('admin:dashboard.pro.suffix_speed')}
        />
      </div>

      {/* 3. Jadval */}
      <div className="overflow-x-auto">
        <div className="min-w-[780px]">
          {/* Header qatori */}
          <div
            className="grid items-center gap-3 border-b border-slate-100 pb-2 dark:border-slate-800"
            style={{ gridTemplateColumns: GRID_COLS }}
          >
            <div className={headCls}>{t('admin:dashboard.pro.col_staff')}</div>
            <div className={`${headCls} text-right`}>{t('admin:dashboard.pro.col_shahar')}</div>
            <div className={`${headCls} text-right`}>{t('admin:dashboard.pro.col_region')}</div>
            <div className={headCls}>{t('admin:dashboard.pro.col_qty')}</div>
            <div className={`${headCls} text-right`}>{t('admin:dashboard.pro.col_productivity')}</div>
            <div className={`${headCls} text-right`}>{t('admin:dashboard.pro.col_median')}</div>
            <div className={`${headCls} text-right`}>{t('admin:dashboard.pro.col_orders')}</div>
          </div>

          {isLoading ? (
            <div className="relative min-h-[8rem]">
              <LoadingOverlay label="" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">{emptyLabel}</p>
          ) : (
            rows.map((row, index) => {
              const rank = index + 1
              const rs = rankStyle(rank)
              const pct = Math.max(2, Math.round((row.total_qty / maxQty) * 100))
              const chip = chipStyle(row.units_per_hour)
              return (
                <div
                  key={row.user_id}
                  className="group grid items-center gap-3 rounded-[10px] px-2 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  style={{ gridTemplateColumns: GRID_COLS }}
                >
                  {/* XODIM */}
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-md text-[10px] font-extrabold"
                      style={{ backgroundColor: rs.bg, color: rs.fg }}
                    >
                      {rank}
                    </span>
                    <span
                      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                      style={{ backgroundColor: avatarLight.bg, color: avatarLight.fg }}
                    >
                      {nameInitials(row.full_name)}
                    </span>
                    <span className="truncate text-[13px] font-bold text-slate-900 dark:text-slate-100">
                      {row.full_name}
                    </span>
                  </div>
                  {/* SHAHAR */}
                  <div className="wms-num text-right text-[12.5px] font-bold text-slate-600 dark:text-slate-300">
                    {row.shahar_qty > 0 ? fmtQty(row.shahar_qty) : '—'}
                  </div>
                  {/* REGION */}
                  <div className="wms-num text-right text-[12.5px] font-bold text-slate-600 dark:text-slate-300">
                    {row.region_qty > 0 ? fmtQty(row.region_qty) : '—'}
                  </div>
                  {/* JAMI DONA — progress + qiymat */}
                  <div className="flex items-center gap-2.5">
                    <div className="h-[7px] min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: barGradient }}
                      />
                    </div>
                    <span className="wms-num shrink-0 text-[13px] font-extrabold text-slate-900 dark:text-slate-100">
                      {fmtQty(row.total_qty)}
                    </span>
                  </div>
                  {/* UNUMDORLIK — chip */}
                  <div className="text-right">
                    {row.units_per_hour > 0 ? (
                      <span
                        className="wms-num inline-block rounded-[7px] px-2 py-[3px] text-[11.5px] font-extrabold"
                        style={{ backgroundColor: chip.bg, color: chip.fg }}
                      >
                        {fmtQty(row.units_per_hour)} {t('admin:dashboard.pro.chip_speed')}
                      </span>
                    ) : (
                      <span className="text-[12px] text-slate-400">—</span>
                    )}
                  </div>
                  {/* MEDIAN */}
                  <div className="whitespace-nowrap text-right text-[12px] font-bold text-slate-500 dark:text-slate-400">
                    {formatDuration(row.median_seconds, durUnits)}
                  </div>
                  {/* BUY */}
                  <div className="wms-num text-right text-[12.5px] font-bold text-slate-600 dark:text-slate-300">
                    {row.orders_count}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Jadval osti izohi */}
      {!isLoading && rows.length > 0 ? (
        <div className="mt-3 text-[12px] text-slate-400 dark:text-slate-500">
          {t('admin:dashboard.pro.legend')}
        </div>
      ) : null}
    </div>
  )
}

function KpiCell({
  label,
  value,
  suffix,
}: {
  label: string
  value: string
  suffix?: string
}) {
  return (
    <div className="rounded-[13px] border border-slate-100 bg-slate-50 px-3.5 py-[11px] dark:border-slate-800 dark:bg-slate-800/50">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className="wms-num text-[20px] font-extrabold text-slate-900 dark:text-slate-100">
        {value}
        {suffix ? (
          <span className="ml-1 text-[11px] font-semibold text-slate-400">{suffix}</span>
        ) : null}
      </div>
    </div>
  )
}
