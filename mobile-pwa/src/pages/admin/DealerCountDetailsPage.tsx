import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Download, GitCompareArrows, RefreshCw, Store } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import * as XLSX from 'xlsx'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import {
  compareDealerCount,
  getDealerCount,
  type DealerCountCompareOut,
  type DealerCountOut,
} from '../../services/dealerCountsApi'
import { writeExcelFile } from '../../utils/exportExcel'

function fmtUnits(v: number | string) {
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—'
}

function fmtDate(v: string | null | undefined) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

function fmtExpiry(v: string | null) {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

/** Bitta diller sanovi: sarlavha ma'lumotlari + qatorlar + Excel. */
export function DealerCountDetailsPage() {
  const { t } = useTranslation(['admin', 'common'])
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showError } = useAppToast()
  const [item, setItem] = useState<DealerCountOut | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Smartup bilan solishtirish — tugma bosilganda yuklanadi (Smartup API'ga
  // avtomatik so'rov yo'q); bugungi javob serverda keshlanadi.
  const [compare, setCompare] = useState<DealerCountCompareOut | null>(null)
  const [compareBusy, setCompareBusy] = useState(false)
  const [showCompare, setShowCompare] = useState(false)

  const runCompare = async (refresh: boolean) => {
    if (!id) return
    setCompareBusy(true)
    try {
      setCompare(await compareDealerCount(id, refresh))
      setShowCompare(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('admin:dealer_counts.compare_failed')
      showError(msg.includes('ombor kodi') ? `${msg}. ${t('admin:dealer_counts.compare_hint_wh')}` : msg)
    } finally {
      setCompareBusy(false)
    }
  }

  const load = useCallback(async () => {
    if (!id) {
      setLoadError(t('admin:dealer_counts.not_found'))
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setLoadError(null)
    try {
      setItem(await getDealerCount(id))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('admin:dealer_counts.load_failed'))
      setItem(null)
    } finally {
      setIsLoading(false)
    }
  }, [id, t])

  useEffect(() => {
    void load()
  }, [load])

  const exportExcel = async () => {
    if (!item) return
    if (showCompare && compare) {
      const cmpRows = compare.rows.map((r) => ({
        SKU: r.sku,
        [t('admin:dealer_counts.col_product')]: r.product_name ?? '',
        [t('admin:dealer_counts.col_counted')]: r.counted,
        [t('admin:dealer_counts.col_smartup')]: r.smartup,
        [t('admin:dealer_counts.col_diff')]: r.diff,
      }))
      const wsC = XLSX.utils.json_to_sheet(cmpRows)
      const wbC = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wbC, wsC, 'Smartup')
      await writeExcelFile(wbC, `diller_sanov_smartup_${item.dealer_org_id}_${compare.balance_date}.xlsx`)
      return
    }
    const rows = item.lines.map((ln) => ({
      [t('admin:dealer_counts.col_seq')]: ln.seq,
      SKU: ln.sku ?? '',
      [t('admin:dealer_counts.col_product')]: ln.product_name ?? t('admin:dealer_counts.unknown_barcode'),
      [t('admin:dealer_counts.col_barcode')]: ln.scanned_barcode,
      [t('admin:dealer_counts.col_qty')]: Number(ln.qty),
      [t('admin:dealer_counts.col_expiry')]: ln.expiry_date ? ln.expiry_date.slice(0, 7) : '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sanov')
    const day = (item.submitted_at ?? item.started_at).slice(0, 10)
    await writeExcelFile(wb, `diller_sanov_${item.dealer_org_id}_${day}.xlsx`)
  }

  if (isLoading) {
    return (
      <AdminLayout title={t('admin:dealer_counts.details_title')}>
        <div className="relative min-h-[260px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      </AdminLayout>
    )
  }
  if (!item || loadError) {
    return (
      <AdminLayout title={t('admin:dealer_counts.details_title')}>
        <EmptyState
          title={loadError ?? t('admin:dealer_counts.not_found')}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      </AdminLayout>
    )
  }

  const unknownCount = item.lines.filter((ln) => !ln.product_id).length

  return (
    <AdminLayout
      titleSlot={
        <div className="flex items-center gap-2">
          <Store size={18} />
          <span className="text-sm font-semibold">{item.dealer_name ?? item.dealer_org_id}</span>
        </div>
      }
      actionSlot={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => navigate('/admin/dealer-counts')}>
            <ArrowLeft size={16} className="mr-1" />
            {t('common:buttons.back')}
          </Button>
          {showCompare ? (
            <>
              <Button variant="ghost" onClick={() => setShowCompare(false)}>
                {t('admin:dealer_counts.compare_back')}
              </Button>
              <Button variant="ghost" disabled={compareBusy} onClick={() => runCompare(true)}>
                <RefreshCw size={16} className="mr-1" />
                {t('admin:dealer_counts.compare_refresh')}
              </Button>
            </>
          ) : (
            <Button variant="ghost" disabled={compareBusy} onClick={() => (compare ? setShowCompare(true) : runCompare(false))}>
              <GitCompareArrows size={16} className="mr-1" />
              {t('admin:dealer_counts.compare_button')}
            </Button>
          )}
          <Button onClick={exportExcel}>
            <Download size={16} className="mr-1" />
            Excel
          </Button>
        </div>
      }
    >
      <Card className="mb-4 p-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500">{t('admin:dealer_counts.col_dealer')}</dt>
            <dd className="font-medium">
              {item.dealer_name ?? '—'} <span className="font-mono text-xs text-slate-400">{item.dealer_org_id}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('admin:dealer_counts.col_by')}</dt>
            <dd className="font-medium">{item.counted_by_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('admin:dealer_counts.col_status')}</dt>
            <dd className="font-medium">
              {item.status === 'submitted'
                ? t('admin:dealer_counts.status_submitted')
                : t('admin:dealer_counts.status_draft')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('admin:dealer_counts.started_at')}</dt>
            <dd>{fmtDate(item.started_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('admin:dealer_counts.submitted_at')}</dt>
            <dd>{fmtDate(item.submitted_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('admin:dealer_counts.col_lines')} / {t('admin:dealer_counts.col_units')}</dt>
            <dd className="tabular-nums">
              {item.lines_count} / {fmtUnits(item.total_units)}
            </dd>
          </div>
          {item.note ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs text-slate-500">{t('admin:dealer_counts.note')}</dt>
              <dd>{item.note}</dd>
            </div>
          ) : null}
        </dl>
        {unknownCount > 0 ? (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
            {t('admin:dealer_counts.unknown_hint', { count: unknownCount })}
          </p>
        ) : null}
      </Card>

      {showCompare && compare ? (
        <Card className="relative p-0">
          {compareBusy ? <LoadingOverlay label={t('common:messages.loading')} /> : null}
          <div className="border-b border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
            <div className="font-semibold">{t('admin:dealer_counts.compare_title')}</div>
            <div className="mt-1 text-xs text-slate-500">
              {compare.warehouse_code} · {compare.balance_date} ·{' '}
              {compare.source === 'live'
                ? t('admin:dealer_counts.compare_source_live')
                : t('admin:dealer_counts.compare_source_cache')}
            </div>
            <div className="mt-1 text-xs tabular-nums">
              {t('admin:dealer_counts.compare_totals', {
                counted: fmtUnits(compare.totals.counted),
                smartup: fmtUnits(compare.totals.smartup),
                diff: fmtUnits(compare.totals.diff),
              })}
              {' · '}
              {compare.totals.only_in_count} {t('admin:dealer_counts.compare_only_count')}
              {' · '}
              {compare.totals.only_in_smartup} {t('admin:dealer_counts.compare_only_smartup')}
            </div>
            {compare.unknown_lines > 0 ? (
              <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                {t('admin:dealer_counts.compare_unknown_excluded', { count: compare.unknown_lines })}
              </div>
            ) : null}
          </div>
          <TableScrollArea>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-3 py-3 text-left sm:px-4">SKU</th>
                  <th className="px-3 py-3 text-left sm:px-4">{t('admin:dealer_counts.col_product')}</th>
                  <th className="px-3 py-3 text-right sm:px-4">{t('admin:dealer_counts.col_counted')}</th>
                  <th className="px-3 py-3 text-right sm:px-4">{t('admin:dealer_counts.col_smartup')}</th>
                  <th className="px-3 py-3 text-right sm:px-4">{t('admin:dealer_counts.col_diff')}</th>
                </tr>
              </thead>
              <tbody>
                {compare.rows.map((r) => (
                  <tr key={r.sku} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="whitespace-nowrap px-3 py-2 font-mono sm:px-4">{r.sku}</td>
                    <td className="px-3 py-2 sm:px-4">
                      {r.product_name ?? '—'}
                      {r.only_in ? (
                        <span className="ml-2 text-xs text-slate-400">
                          {r.only_in === 'count'
                            ? t('admin:dealer_counts.compare_only_count')
                            : t('admin:dealer_counts.compare_only_smartup')}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums sm:px-4">{fmtUnits(r.counted)}</td>
                    <td className="px-3 py-2 text-right tabular-nums sm:px-4">{fmtUnits(r.smartup)}</td>
                    <td
                      className={
                        'px-3 py-2 text-right font-semibold tabular-nums sm:px-4 ' +
                        (r.diff === 0
                          ? 'text-slate-400'
                          : r.diff > 0
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-rose-700 dark:text-rose-300')
                      }
                    >
                      {r.diff > 0 ? '+' : ''}
                      {fmtUnits(r.diff)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollArea>
        </Card>
      ) : (
      <Card className="p-0">
        {item.lines.length === 0 ? (
          <EmptyState title={t('admin:dealer_counts.no_lines')} />
        ) : (
          <TableScrollArea>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-3 py-3 text-left sm:px-4">{t('admin:dealer_counts.col_seq')}</th>
                  <th className="px-3 py-3 text-left sm:px-4">SKU</th>
                  <th className="px-3 py-3 text-left sm:px-4">{t('admin:dealer_counts.col_product')}</th>
                  <th className="px-3 py-3 text-left sm:px-4">{t('admin:dealer_counts.col_barcode')}</th>
                  <th className="px-3 py-3 text-right sm:px-4">{t('admin:dealer_counts.col_qty')}</th>
                  <th className="px-3 py-3 text-left sm:px-4">{t('admin:dealer_counts.col_expiry')}</th>
                </tr>
              </thead>
              <tbody>
                {item.lines.map((ln) => (
                  <tr
                    key={ln.id}
                    className={
                      'border-b border-slate-100 dark:border-slate-800' +
                      (ln.product_id ? '' : ' bg-amber-50/60 dark:bg-amber-900/10')
                    }
                  >
                    <td className="px-3 py-2 tabular-nums text-slate-500 sm:px-4">{ln.seq}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono sm:px-4">{ln.sku ?? '—'}</td>
                    <td className="px-3 py-2 sm:px-4">
                      {ln.product_name ?? (
                        <span className="text-amber-700 dark:text-amber-300">
                          {t('admin:dealer_counts.unknown_barcode')}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs sm:px-4">{ln.scanned_barcode}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold sm:px-4">{fmtUnits(ln.qty)}</td>
                    <td className="whitespace-nowrap px-3 py-2 sm:px-4">{fmtExpiry(ln.expiry_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollArea>
        )}
      </Card>
      )}
    </AdminLayout>
  )
}
