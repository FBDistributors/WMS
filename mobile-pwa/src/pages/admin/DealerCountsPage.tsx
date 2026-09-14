import { useCallback, useEffect, useState } from 'react'
import { Plus, Store } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../rbac/AuthProvider'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import {
  getDealers,
  listDealerCounts,
  type DealerCountOut,
  type DealerOut,
} from '../../services/dealerCountsApi'

const PAGE = 50

const inputCls =
  'rounded-xl border border-slate-200/90 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100'

function fmtUnits(v: number | string) {
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—'
}

function fmtDate(v: string | null | undefined) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

/** Diller qoldig'i: xodimlar viloyatda skanerlab yuborgan sanovlar ro'yxati. */
export function DealerCountsPage() {
  const { t } = useTranslation(['admin', 'common'])
  const navigate = useNavigate()
  const { has } = useAuth()
  const { showError } = useAppToast()
  const [dealers, setDealers] = useState<DealerOut[]>([])
  const [dealerId, setDealerId] = useState('')
  const [status, setStatus] = useState<string>('submitted')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [items, setItems] = useState<DealerCountOut[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    getDealers()
      .then(setDealers)
      .catch(() => setDealers([]))
  }, [])

  const load = useCallback(async () => {
    setIsLoading(true)
    setHasError(false)
    try {
      const r = await listDealerCounts({
        dealer_org_id: dealerId || undefined,
        status: status || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: PAGE,
        offset,
      })
      setItems(r.items)
      setTotal(r.total)
    } catch (err) {
      showError(err instanceof Error ? err.message : t('admin:dealer_counts.load_failed'))
      setHasError(true)
    } finally {
      setIsLoading(false)
    }
  }, [dealerId, status, dateFrom, dateTo, offset, showError, t])

  useEffect(() => {
    void load()
  }, [load])

  const resetPage = () => setOffset(0)

  return (
    <AdminLayout
      titleSlot={
        <div className="flex items-center gap-2">
          <Store size={18} />
          <span className="text-sm font-semibold">{t('admin:dealer_counts.title')}</span>
        </div>
      }
      actionSlot={
        has('dealer_counts:write') ? (
          <Button onClick={() => navigate('/admin/dealer-counts/new')}>
            <Plus size={16} className="mr-1" />
            {t('admin:dealer_counts.new_button')}
          </Button>
        ) : null
      }
    >
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            {t('admin:dealer_counts.filter_dealer')}
            <select
              className={inputCls}
              value={dealerId}
              onChange={(e) => {
                setDealerId(e.target.value)
                resetPage()
              }}
            >
              <option value="">{t('admin:dealer_counts.all_dealers')}</option>
              {dealers.map((d) => (
                <option key={d.org_id} value={d.org_id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            {t('admin:dealer_counts.filter_status')}
            <select
              className={inputCls}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value)
                resetPage()
              }}
            >
              <option value="">{t('admin:dealer_counts.status_all')}</option>
              <option value="submitted">{t('admin:dealer_counts.status_submitted')}</option>
              <option value="draft,in_progress">{t('admin:dealer_counts.status_open')}</option>
              <option value="draft">{t('admin:dealer_counts.status_draft')}</option>
              <option value="in_progress">{t('admin:dealer_counts.status_in_progress')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            {t('admin:dealer_counts.filter_from')}
            <input
              type="date"
              className={inputCls}
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                resetPage()
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            {t('admin:dealer_counts.filter_to')}
            <input
              type="date"
              className={inputCls}
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value)
                resetPage()
              }}
            />
          </label>
          <span className="ml-auto text-xs text-slate-500">
            {t('admin:dealer_counts.total', { count: total })}
          </span>
        </div>
      </Card>

      <Card className="relative p-0">
        {isLoading ? <LoadingOverlay label={t('common:messages.loading')} /> : null}
        {hasError ? (
          <EmptyState
            title={t('admin:dealer_counts.load_failed')}
            actionLabel={t('common:buttons.retry')}
            onAction={load}
          />
        ) : !isLoading && items.length === 0 ? (
          <EmptyState title={t('admin:dealer_counts.empty')} />
        ) : (
          <TableScrollArea>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('admin:dealer_counts.col_dealer')}</th>
                  <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('admin:dealer_counts.col_date')}</th>
                  <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('admin:dealer_counts.col_by')}</th>
                  <th className="whitespace-nowrap px-3 py-3 text-right sm:px-4">{t('admin:dealer_counts.col_lines')}</th>
                  <th className="whitespace-nowrap px-3 py-3 text-right sm:px-4">{t('admin:dealer_counts.col_units')}</th>
                  <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('admin:dealer_counts.col_status')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                    onClick={() =>
                      navigate(
                        row.status !== 'submitted' && has('dealer_counts:write')
                          ? `/admin/dealer-counts/${row.id}/edit`
                          : `/admin/dealer-counts/${row.id}`,
                      )
                    }
                  >
                    <td className="px-3 py-3 text-slate-900 dark:text-slate-100 sm:px-4">
                      {row.dealer_name ?? row.dealer_org_id}
                      <div className="font-mono text-xs text-slate-400">{row.dealer_org_id}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 sm:px-4">{fmtDate(row.submitted_at ?? row.started_at)}</td>
                    <td className="px-3 py-3 sm:px-4">{row.counted_by_name ?? '—'}</td>
                    <td className="px-3 py-3 text-right tabular-nums sm:px-4">
                      {row.status === 'submitted' ? row.lines_count : `${row.counted_lines}/${row.sheet_lines}`}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums sm:px-4">{fmtUnits(row.total_units)}</td>
                    <td className="px-3 py-3 sm:px-4">
                      <span
                        className={
                          row.status === 'submitted'
                            ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                            : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }
                      >
                        {row.status === 'submitted'
                          ? t('admin:dealer_counts.status_submitted')
                          : row.status === 'in_progress'
                            ? `${t('admin:dealer_counts.status_in_progress')} · ${row.assigned_to_name ?? ''}`
                            : t('admin:dealer_counts.status_draft')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollArea>
        )}
      </Card>

      {total > PAGE ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            ‹
          </Button>
          <span className="text-xs text-slate-500">
            {offset + 1}–{Math.min(offset + PAGE, total)} / {total}
          </span>
          <Button variant="ghost" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
            ›
          </Button>
        </div>
      ) : null}
    </AdminLayout>
  )
}
