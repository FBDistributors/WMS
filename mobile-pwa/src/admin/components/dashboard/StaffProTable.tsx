import { FileSpreadsheet, Loader2 } from 'lucide-react'

import { LoadingOverlay } from '../../../components/ui/LoadingOverlay'
import { formatDuration } from '../../../lib/formatDuration'

/** Reyting (shahar/region: buyurtma+pozitsiya+dona) + unumdorlik + median birlashgan qator. */
export type StaffProRow = {
  user_id: string
  full_name: string
  shahar_orders: number
  shahar_positions: number
  shahar_qty: number
  region_orders: number
  region_positions: number
  region_qty: number
  cancelled_orders: number
  cancelled_positions: number
  cancelled_qty: number
  /** Bajarilmagan qaytarish topshiriqlari — to'lov emas, kuzatuv uchun. */
  pending_returns: number
  total_qty: number
  /** Unumdorlik — pozitsiya/soat (dona emas: qator soni mehnatni to'g'riroq o'lchaydi). */
  positions_per_hour: number
  median_seconds: number
  work_hours: number
}

/** KPI kartalari — faqat to'liq yakunlangan buyurtmalar bo'yicha (jadval yig'indisidan farq qilishi mumkin). */
export type StaffProKpi = {
  orders: number
  positions: number
  qty: number
  speed: number
}

type StaffProTableProps = {
  role: 'picker' | 'controller'
  title: string
  subtitle: string
  rows: StaffProRow[]
  kpi: StaffProKpi
  isLoading: boolean
  onExport: () => void
  exportDisabled: boolean
  isExporting: boolean
  emptyLabel: string
  /** Xodim ismiga bosilganda — uning buyurtmalari ro'yxati. */
  onRowClick?: (row: StaffProRow) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}

// XODIM cho'ziladi (ism to'liq ko'rinsin). Uch guruh: Shahar / Region / Jami —
// har biri Buy · Poz · Dona (faqat sonlar, diagramma yo'q).
// XODIM · SHAHAR(3) · REGION(3) · BEKOR(2) · JAMI(3) · UNUMDORLIK · MEDIAN
const GRID_COLS =
  'minmax(168px,1fr) 42px 44px 58px 42px 44px 58px 42px 44px 42px 46px 66px 88px 78px'

/** Guruhlar (Shahar / Region / Jami) orasidagi vertikal ajratuvchi. */
const SEP = 'border-l border-slate-200 pl-3 dark:border-slate-700'

function fmtQty(n: number): string {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')
}

function cell(n: number): string {
  return n > 0 ? fmtQty(n) : '—'
}

function nameInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

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
  kpi,
  isLoading,
  onExport,
  exportDisabled,
  isExporting,
  emptyLabel,
  onRowClick,
  t,
}: StaffProTableProps) {
  const durUnits = {
    h: t('admin:dashboard.timing.h'),
    m: t('admin:dashboard.timing.m'),
    s: t('admin:dashboard.timing.s'),
  }

  const speeds = rows.map((r) => r.positions_per_hour).filter((v) => v > 0)
  const avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0

  const avatar =
    role === 'picker'
      ? { bg: '#eff6ff', fg: '#2563eb' }
      : { bg: '#f5f3ff', fg: '#7c3aed' }

  const chipStyle = (pph: number): { bg: string; fg: string } => {
    if (avgSpeed <= 0 || pph <= 0) return { bg: '#f1f5f9', fg: '#64748b' }
    if (pph > avgSpeed * 1.15) return { bg: '#dcfce7', fg: '#15803d' }
    if (pph < avgSpeed * 0.55) return { bg: '#fee2e2', fg: '#b91c1c' }
    return { bg: '#f1f5f9', fg: '#64748b' }
  }

  const headCls =
    'text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400'
  const subCls =
    'text-[9.5px] font-bold uppercase tracking-[0.04em] text-slate-400 dark:text-slate-500 text-right'
  const numCls = 'wms-num text-right text-[12.5px] font-bold text-slate-600 dark:text-slate-300'
  // Guruh sarlavhasi (SHAHAR / REGION) — rol rangida, aniq ko'rinadigan.
  // headCls bilan qo'shilmaydi: ikkovi ham text-* bersa Tailwind'da ustunlik noaniq.
  const groupBase =
    'rounded-md py-[3px] text-center text-[10.5px] font-extrabold uppercase tracking-[0.05em] '
  const groupHeadCls =
    groupBase +
    (role === 'picker'
      ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
      : 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300')
  // BEKOR — JAMI ga kiradi, lekin terilgani bekor bo'lgani ko'rinib tursin.
  const cancelledHeadCls =
    groupBase + 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  const cancelledNumCls =
    'wms-num text-right text-[12.5px] font-bold text-rose-700 dark:text-rose-300'
  // JAMI — yig'indi bo'lgani uchun neytral, quyuqroq urg'u.
  const totalHeadCls = groupBase + 'bg-slate-200/70 text-slate-700 dark:bg-slate-700 dark:text-slate-200'

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
            {isLoading ? '—' : fmtQty(kpi.orders)}
          </div>
        </div>
        <KpiCell
          label={t('admin:dashboard.pro.kpi_positions')}
          value={isLoading ? '—' : fmtQty(kpi.positions)}
          suffix={t('admin:dashboard.pro.suffix_pos')}
        />
        <KpiCell
          label={t('admin:dashboard.pro.kpi_qty')}
          value={isLoading ? '—' : fmtQty(kpi.qty)}
        />
        <KpiCell
          label={t('admin:dashboard.pro.kpi_speed')}
          value={isLoading ? '—' : fmtQty(kpi.speed)}
          suffix={t('admin:dashboard.pro.suffix_speed')}
        />
      </div>

      {/* 3. Jadval */}
      <div className="overflow-x-auto">
        <div className="min-w-[1100px]">
          {/* Header — guruh qatori (SHAHAR / REGION 3 tadan ustun) */}
          <div className="grid items-end gap-3" style={{ gridTemplateColumns: GRID_COLS }}>
            <div className={headCls}>{t('admin:dashboard.pro.col_staff')}</div>
            <div className={groupHeadCls} style={{ gridColumn: 'span 3' }}>
              {t('admin:dashboard.pro.col_shahar')}
            </div>
            <div className={groupHeadCls} style={{ gridColumn: 'span 3' }}>
              {t('admin:dashboard.pro.col_region')}
            </div>
            <div className={cancelledHeadCls} style={{ gridColumn: 'span 2' }}>
              {t('admin:dashboard.pro.col_cancelled')}
            </div>
            <div className={totalHeadCls} style={{ gridColumn: 'span 3' }}>
              {t('admin:dashboard.pro.col_total')}
            </div>
            <div className={`${headCls} text-right`}>{t('admin:dashboard.pro.col_productivity')}</div>
            <div className={`${headCls} text-right`}>{t('admin:dashboard.pro.col_median')}</div>
          </div>
          {/* Header — kichik qator (Buy / Poz / Dona) */}
          <div
            className="mt-1 grid gap-3 border-b border-slate-100 pb-2 dark:border-slate-800"
            style={{ gridTemplateColumns: GRID_COLS }}
          >
            <div />
            <div className={`${subCls} ${SEP}`}>{t('admin:dashboard.pro.hdr_orders')}</div>
            <div className={subCls}>{t('admin:dashboard.pro.hdr_positions')}</div>
            <div className={subCls}>{t('admin:dashboard.pro.hdr_units')}</div>
            <div className={`${subCls} ${SEP}`}>{t('admin:dashboard.pro.hdr_orders')}</div>
            <div className={subCls}>{t('admin:dashboard.pro.hdr_positions')}</div>
            <div className={subCls}>{t('admin:dashboard.pro.hdr_units')}</div>
            <div className={`${subCls} ${SEP}`}>{t('admin:dashboard.pro.hdr_orders')}</div>
            <div className={subCls}>{t('admin:dashboard.pro.hdr_positions')}</div>
            <div className={`${subCls} ${SEP}`}>{t('admin:dashboard.pro.hdr_orders')}</div>
            <div className={subCls}>{t('admin:dashboard.pro.hdr_positions')}</div>
            <div className={subCls}>{t('admin:dashboard.pro.hdr_units')}</div>
            <div />
            <div />
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
              const chip = chipStyle(row.positions_per_hour)
              return (
                <div
                  key={row.user_id}
                  className="grid items-center gap-3 rounded-[10px] px-2 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50"
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
                      style={{ backgroundColor: avatar.bg, color: avatar.fg }}
                    >
                      {nameInitials(row.full_name)}
                    </span>
                    {onRowClick ? (
                      <button
                        type="button"
                        onClick={() => onRowClick(row)}
                        title={row.full_name}
                        className="truncate text-left text-[13px] font-bold text-slate-900 underline-offset-2 hover:text-blue-700 hover:underline dark:text-slate-100 dark:hover:text-blue-300"
                      >
                        {row.full_name}
                      </button>
                    ) : (
                      <span className="truncate text-[13px] font-bold text-slate-900 dark:text-slate-100">
                        {row.full_name}
                      </span>
                    )}
                    {row.pending_returns > 0 ? (
                      <span
                        className="wms-num ml-1 shrink-0 rounded-[6px] bg-orange-100 px-1.5 py-[1px] text-[10.5px] font-extrabold text-orange-800 dark:bg-orange-900/40 dark:text-orange-200"
                        title={t('admin:dashboard.cancelled.col_pending')}
                      >
                        {row.pending_returns}
                      </span>
                    ) : null}
                  </div>
                  {/* SHAHAR: buy / poz / dona */}
                  <div className={`${numCls} ${SEP}`}>{cell(row.shahar_orders)}</div>
                  <div className={numCls}>{cell(row.shahar_positions)}</div>
                  <div className={`${numCls} !text-slate-900 dark:!text-slate-100`}>
                    {cell(row.shahar_qty)}
                  </div>
                  {/* REGION: buy / poz / dona */}
                  <div className={`${numCls} ${SEP}`}>{cell(row.region_orders)}</div>
                  <div className={numCls}>{cell(row.region_positions)}</div>
                  <div className={`${numCls} !text-slate-900 dark:!text-slate-100`}>
                    {cell(row.region_qty)}
                  </div>
                  {/* BEKOR: buy / poz — terilgan, keyin bekor qilingan ish */}
                  <div className={`${cancelledNumCls} ${SEP}`}>{cell(row.cancelled_orders)}</div>
                  <div className={cancelledNumCls}>{cell(row.cancelled_positions)}</div>
                  {/* JAMI: uchala guruh yig'indisi */}
                  <div className={`${numCls} ${SEP} !text-slate-900 dark:!text-slate-100`}>
                    {cell(row.shahar_orders + row.region_orders + row.cancelled_orders)}
                  </div>
                  <div className={`${numCls} !text-slate-900 dark:!text-slate-100`}>
                    {cell(row.shahar_positions + row.region_positions + row.cancelled_positions)}
                  </div>
                  <div className="wms-num text-right text-[13px] font-extrabold text-slate-900 dark:text-slate-100">
                    {fmtQty(row.total_qty)}
                  </div>
                  {/* UNUMDORLIK — chip */}
                  <div className="text-right">
                    {row.positions_per_hour > 0 ? (
                      <span
                        className="wms-num inline-block rounded-[7px] px-2 py-[3px] text-[11.5px] font-extrabold"
                        style={{ backgroundColor: chip.bg, color: chip.fg }}
                      >
                        {fmtQty(row.positions_per_hour)} {t('admin:dashboard.pro.chip_speed')}
                      </span>
                    ) : (
                      <span className="text-[12px] text-slate-400">—</span>
                    )}
                  </div>
                  {/* MEDIAN */}
                  <div className="whitespace-nowrap text-right text-[12px] font-bold text-slate-500 dark:text-slate-400">
                    {formatDuration(row.median_seconds, durUnits)}
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
