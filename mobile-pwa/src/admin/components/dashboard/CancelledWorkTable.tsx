import { FileSpreadsheet, Loader2 } from 'lucide-react'

import { LoadingOverlay } from '../../../components/ui/LoadingOverlay'
import type { CancelledPickerRow } from '../../../services/dashboardApi'

type CancelledWorkTableProps = {
  rows: CancelledPickerRow[]
  isLoading: boolean
  onExport: () => void
  exportDisabled: boolean
  isExporting: boolean
  t: (key: string, opts?: Record<string, unknown>) => string
}

function fmtQty(n: number): string {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')
}

/**
 * Terilgan, keyin bekor qilingan ish. Asosiy jadvalda ko'rinmaydi, chunki bekor
 * qilinganda qator miqdori nolga tushadi — lekin ish bajarilgan va to'lanadi.
 * Unumdorlik (poz/soat) hisobiga ataylab kiritilmaydi.
 */
export function CancelledWorkTable({
  rows,
  isLoading,
  onExport,
  exportDisabled,
  isExporting,
  t,
}: CancelledWorkTableProps) {
  const totals = rows.reduce(
    (acc, r) => ({
      documents: acc.documents + r.documents_count,
      positions: acc.positions + r.positions,
      qty: acc.qty + r.qty,
      pending: acc.pending + r.pending_returns,
    }),
    { documents: 0, positions: 0, qty: 0, pending: 0 }
  )

  const headCls =
    'text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400'
  const numCls = 'wms-num text-right text-[12.5px] font-bold text-slate-600 dark:text-slate-300'
  const GRID = 'minmax(180px,1fr) 84px 84px 92px 104px'

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-[22px] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-extrabold tracking-[-0.3px] text-slate-900 dark:text-slate-100">
            {t('admin:dashboard.cancelled.title')}
          </div>
          <div className="text-[12.5px] font-medium text-slate-400 dark:text-slate-500">
            {t('admin:dashboard.cancelled.subtitle')}
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

      <div className="relative mt-4 overflow-x-auto">
        {isLoading ? (
          <div className="relative min-h-[120px]">
            <LoadingOverlay />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            {t('admin:dashboard.cancelled.empty')}
          </p>
        ) : (
          <div className="min-w-[560px]">
            <div className="grid items-end gap-3 pb-2" style={{ gridTemplateColumns: GRID }}>
              <div className={headCls}>{t('admin:dashboard.pro.col_staff')}</div>
              <div className={`${headCls} text-right`}>{t('admin:dashboard.pro.kpi_orders')}</div>
              <div className={`${headCls} text-right`}>{t('admin:dashboard.pro.suffix_pos')}</div>
              <div className={`${headCls} text-right`}>{t('admin:dashboard.pro.kpi_qty')}</div>
              <div className={`${headCls} text-right`}>
                {t('admin:dashboard.cancelled.col_pending')}
              </div>
            </div>
            <div className="border-t border-slate-100 dark:border-slate-800">
              {rows.map((row) => (
                <div
                  key={row.user_id}
                  className="grid items-center gap-3 border-b border-slate-100 py-2.5 last:border-0 dark:border-slate-800"
                  style={{ gridTemplateColumns: GRID }}
                >
                  <div className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                    {row.full_name}
                  </div>
                  <div className={numCls}>{row.documents_count || '—'}</div>
                  <div className="wms-num text-right text-[12.5px] font-extrabold text-slate-900 dark:text-slate-100">
                    {row.positions || '—'}
                  </div>
                  <div className={numCls}>{row.qty ? fmtQty(row.qty) : '—'}</div>
                  <div className="text-right">
                    {row.pending_returns > 0 ? (
                      <span className="wms-num inline-block rounded-[7px] bg-orange-100 px-2 py-[3px] text-[11.5px] font-extrabold text-orange-800 dark:bg-orange-900/40 dark:text-orange-200">
                        {row.pending_returns}
                      </span>
                    ) : (
                      <span className="text-[12px] text-slate-400">—</span>
                    )}
                  </div>
                </div>
              ))}
              <div
                className="grid items-center gap-3 border-t border-slate-200 pt-2.5 dark:border-slate-700"
                style={{ gridTemplateColumns: GRID }}
              >
                <div className="text-[12px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t('admin:dashboard.cancelled.total')}
                </div>
                <div className={numCls}>{totals.documents || '—'}</div>
                <div className="wms-num text-right text-[12.5px] font-extrabold text-slate-900 dark:text-slate-100">
                  {totals.positions || '—'}
                </div>
                <div className={numCls}>{totals.qty ? fmtQty(totals.qty) : '—'}</div>
                <div className={numCls}>{totals.pending || '—'}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-slate-400 dark:text-slate-500">
        {t('admin:dashboard.cancelled.note')}
      </p>
    </div>
  )
}
