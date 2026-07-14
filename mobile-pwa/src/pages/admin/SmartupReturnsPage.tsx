import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, RefreshCw, Search } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import {
  getSmartupReturns,
  syncSmartupReturns,
  type SmartupReturn,
} from '../../services/smartupReturnsApi'

const PAGE_SIZE = 50

function formatAmount(n: number | null): string {
  if (n == null) return '—'
  return Math.round(n).toLocaleString('ru-RU')
}

export function SmartupReturnsPage() {
  const { t } = useTranslation(['admin', 'common'])
  const navigate = useNavigate()
  const { showSuccess, showError } = useAppToast()
  const [rows, setRows] = useState<SmartupReturn[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getSmartupReturns({ q: search, limit: PAGE_SIZE, offset })
      setRows(res.items)
      setTotal(res.total)
    } catch {
      showError(t('admin:smartupReturns.load_error'))
    } finally {
      setLoading(false)
    }
  }, [search, offset, showError, t])

  useEffect(() => {
    void load()
  }, [load])

  const onSync = async () => {
    setSyncing(true)
    try {
      const r = await syncSmartupReturns()
      showSuccess(
        t('admin:smartupReturns.sync_result', {
          fetched: r.fetched,
          created: r.created,
          updated: r.updated,
        }),
      )
      setOffset(0)
      await load()
    } catch {
      showError(t('admin:smartupReturns.sync_error'))
    } finally {
      setSyncing(false)
    }
  }

  const onSearch = () => {
    setOffset(0)
    setSearch(query)
  }

  const pageInfo = useMemo(() => {
    if (total === 0) return '0'
    const from = offset + 1
    const to = Math.min(offset + PAGE_SIZE, total)
    return `${from}–${to} / ${total}`
  }, [offset, total])

  return (
    <AdminLayout>
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">
              {t('admin:smartupReturns.title')}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('admin:smartupReturns.subtitle')}
            </p>
          </div>
          <Button type="button" onClick={() => void onSync()} disabled={syncing} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {t('admin:smartupReturns.sync_btn')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSearch()
              }}
              placeholder={t('admin:smartupReturns.search_placeholder')}
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          <Button type="button" variant="secondary" onClick={onSearch}>
            {t('common:actions.search', 'Qidirish')}
          </Button>
        </div>

        <div className="relative overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {loading ? <LoadingOverlay label="" /> : null}
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-3 py-3 w-8"></th>
                <th className="px-3 py-3">{t('admin:smartupReturns.col_date')}</th>
                <th className="px-3 py-3">{t('admin:smartupReturns.col_customer')}</th>
                <th className="px-3 py-3">{t('admin:smartupReturns.col_order')}</th>
                <th className="px-3 py-3 text-right">{t('admin:smartupReturns.col_products')}</th>
                <th className="px-3 py-3 text-right">{t('admin:smartupReturns.col_amount')}</th>
                <th className="px-3 py-3">{t('admin:smartupReturns.col_manager')}</th>
                <th className="px-3 py-3">{t('admin:smartupReturns.col_status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-slate-400">
                    {t('admin:smartupReturns.empty')}
                  </td>
                </tr>
              ) : null}
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-slate-50 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40"
                  onClick={() => navigate(`/admin/smartup-returns/${r.id}`)}
                >
                  <td className="px-3 py-3 text-slate-400">
                    <ChevronRight className="h-4 w-4" />
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-slate-700 dark:text-slate-200">
                    {r.return_date ?? '—'}
                  </td>
                  <td className="px-3 py-3 font-medium text-slate-900 dark:text-slate-100">
                    {r.person_name ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-slate-500">{r.order_deal_id ?? '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.lines_count}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-rose-600 dark:text-rose-400">
                    {formatAmount(r.total_amount)}
                  </td>
                  <td className="px-3 py-3 text-slate-500">{r.sales_manager_name ?? '—'}</td>
                  <td className="px-3 py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {r.status ?? '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{pageInfo}</span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              {t('common:actions.prev', 'Oldingi')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              {t('common:actions.next', 'Keyingi')}
            </Button>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
