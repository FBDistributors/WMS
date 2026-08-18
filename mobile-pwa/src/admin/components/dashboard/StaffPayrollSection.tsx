import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, Wallet } from 'lucide-react'
import * as XLSX from 'xlsx'

import { getStaffPayroll, type StaffPayrollResponse, type StaffPayrollRow } from '../../../services/dashboardApi'
import { writeExcelFile } from '../../../utils/exportExcel'

/** Ish haqi davri (26→25) bo'yicha ball jadvali — xodim ilovasidagi hisob bilan
 * bitta manba (backend: /dashboard/staff-payroll → payroll_stats servisi). */

type Props = {
  t: (key: string, opts?: Record<string, unknown>) => string
  showError: (msg: string) => void
}

function fmtMoney(n: number): string {
  // 1,000,000 ko'rinishida — mijoz talabi.
  return Math.round(n).toLocaleString('en-US')
}

function fmtPeriodDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

const numCls = 'wms-num text-right text-[12.5px] font-bold text-slate-600 dark:text-slate-300'
const headCls =
  'text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400'

function PayrollTable({
  title,
  rows,
  total,
  accent,
  t,
}: {
  title: string
  rows: StaffPayrollRow[]
  total: number
  accent: 'blue' | 'violet'
  t: Props['t']
}) {
  const accentCls =
    accent === 'blue'
      ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
      : 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
  return (
    <div>
      <div
        className={`mb-2 inline-block rounded-md px-2 py-[3px] text-[10.5px] font-extrabold uppercase tracking-[0.05em] ${accentCls}`}
      >
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className={`py-2 text-left ${headCls}`}>{t('admin:payroll_table.employee')}</th>
              <th className={`py-2 text-right ${headCls}`}>{t('admin:payroll_table.orders')}</th>
              <th className={`py-2 text-right ${headCls}`}>{t('admin:payroll_table.pos_shahar')}</th>
              <th className={`py-2 text-right ${headCls}`}>{t('admin:payroll_table.pos_region')}</th>
              <th className={`py-2 text-right ${headCls}`}>{t('admin:payroll_table.amount_shahar')}</th>
              <th className={`py-2 text-right ${headCls}`}>{t('admin:payroll_table.amount_region')}</th>
              <th className={`py-2 text-right ${headCls}`}>{t('admin:payroll_table.total')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-4 text-center text-[12.5px] text-slate-400">
                  {t('admin:payroll_table.empty')}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.user_id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                >
                  <td className="py-2 pr-3 font-semibold text-slate-800 dark:text-slate-100">
                    {row.full_name}
                  </td>
                  <td className={`py-2 ${numCls}`}>{fmtMoney(row.orders)}</td>
                  <td className={`py-2 ${numCls}`}>{row.positions_shahar ? fmtMoney(row.positions_shahar) : '—'}</td>
                  <td className={`py-2 ${numCls}`}>{row.positions_region ? fmtMoney(row.positions_region) : '—'}</td>
                  <td className={`py-2 ${numCls}`}>
                    {row.amount_shahar ? fmtMoney(row.amount_shahar) : '—'}
                  </td>
                  <td className={`py-2 ${numCls}`}>
                    {row.amount_region ? fmtMoney(row.amount_region) : '—'}
                  </td>
                  <td className="wms-num py-2 text-right text-[13px] font-extrabold text-slate-900 dark:text-slate-50">
                    {fmtMoney(row.total_amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 ? (
            <tfoot>
              <tr className="border-t border-slate-300 dark:border-slate-600">
                <td className={`py-2 ${headCls}`}>{t('admin:payroll_table.footer_total')}</td>
                <td colSpan={5} />
                <td className="wms-num py-2 text-right text-[14px] font-extrabold text-slate-900 dark:text-slate-50">
                  {fmtMoney(total)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  )
}

export function StaffPayrollSection({ t, showError }: Props) {
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<StaffPayrollResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      setData(await getStaffPayroll(offset))
    } catch {
      showError(t('admin:payroll_table.load_failed'))
      setData(null)
    } finally {
      setIsLoading(false)
    }
  }, [offset, showError, t])

  useEffect(() => {
    void load()
  }, [load])

  const handleExport = useCallback(async () => {
    if (!data) return
    setIsExporting(true)
    try {
      const header = [
        t('admin:payroll_table.employee'),
        t('admin:payroll_table.orders'),
        t('admin:payroll_table.pos_shahar'),
        t('admin:payroll_table.pos_region'),
        t('admin:payroll_table.amount_shahar'),
        t('admin:payroll_table.amount_region'),
        t('admin:payroll_table.total'),
      ]
      const buildSheet = (rows: StaffPayrollRow[], total: number) => {
        const aoa: (string | number)[][] = [
          [`${t('admin:payroll_table.title')}: ${fmtPeriodDate(data.period_from)} — ${fmtPeriodDate(data.period_to)}`],
          header,
          ...rows.map((r) => [
            r.full_name,
            r.orders,
            r.positions_shahar,
            r.positions_region,
            r.amount_shahar,
            r.amount_region,
            r.total_amount,
          ]),
          [t('admin:payroll_table.footer_total'), '', '', '', '', '', total],
        ]
        const ws = XLSX.utils.aoa_to_sheet(aoa)
        ws['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
        // Raqam kataklariga 1,000,000 formati — Excel'da ham jadvaldagidek ko'rinsin.
        const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
        for (let r = 2; r <= range.e.r; r++) {
          for (let c = 1; c <= 6; c++) {
            const cell = ws[XLSX.utils.encode_cell({ r, c })]
            if (cell && typeof cell.v === 'number') cell.z = '#,##0'
          }
        }
        return ws
      }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, buildSheet(data.pickers, data.totals.pickers_total), t('admin:payroll_table.pickers').slice(0, 31))
      XLSX.utils.book_append_sheet(wb, buildSheet(data.controllers, data.totals.controllers_total), t('admin:payroll_table.controllers').slice(0, 31))
      await writeExcelFile(wb, `ball_${data.period_from}_${data.period_to}.xlsx`)
    } catch {
      showError(t('admin:payroll_table.export_failed'))
    } finally {
      setIsExporting(false)
    }
  }, [data, showError, t])

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-[22px] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-extrabold tracking-[-0.3px] text-slate-900 dark:text-slate-100">
            <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            {t('admin:payroll_table.title')}
          </div>
          <div className="text-[12.5px] font-medium text-slate-400 dark:text-slate-500">
            {t('admin:payroll_table.subtitle')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={isLoading || isExporting || !data}
            className="flex shrink-0 items-center gap-1.5 rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-[7px] text-xs font-bold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {isExporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
            )}
            Excel
          </button>
          <button
            type="button"
            aria-label={t('admin:payroll_table.prev_period')}
            onClick={() => setOffset((o) => Math.max(-24, o - 1))}
            disabled={isLoading || offset <= -24}
            className="rounded-[10px] border border-slate-200 bg-slate-50 p-[7px] text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <div className="wms-num min-w-[168px] text-center text-[13px] font-bold text-slate-700 dark:text-slate-200">
            {isLoading && !data ? (
              <Loader2 className="mx-auto h-4 w-4 animate-spin" aria-hidden />
            ) : data ? (
              `${fmtPeriodDate(data.period_from)} — ${fmtPeriodDate(data.period_to)}`
            ) : (
              '—'
            )}
          </div>
          <button
            type="button"
            aria-label={t('admin:payroll_table.next_period')}
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            disabled={isLoading || offset >= 0}
            className="rounded-[10px] border border-slate-200 bg-slate-50 p-[7px] text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {data ? (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
          <span className="rounded-full bg-blue-50 px-2.5 py-1 dark:bg-blue-500/15">
            {t('admin:payroll_table.rate_picker', {
              shahar: fmtMoney(data.rates.picker_shahar),
              region: fmtMoney(data.rates.picker_region),
            })}
          </span>
          <span className="rounded-full bg-violet-50 px-2.5 py-1 dark:bg-violet-500/15">
            {t('admin:payroll_table.rate_controller', {
              shahar: fmtMoney(data.rates.controller_shahar),
              region: fmtMoney(data.rates.controller_region),
            })}
          </span>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-6">
        <PayrollTable
          title={t('admin:payroll_table.pickers')}
          rows={data?.pickers ?? []}
          total={data?.totals.pickers_total ?? 0}
          accent="blue"
          t={t}
        />
        <PayrollTable
          title={t('admin:payroll_table.controllers')}
          rows={data?.controllers ?? []}
          total={data?.totals.controllers_total ?? 0}
          accent="violet"
          t={t}
        />
      </div>
    </div>
  )
}
