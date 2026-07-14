import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PackageX, RefreshCw, Search } from 'lucide-react'

import { AdminDataTable, type AdminDataTableColumn } from '../../admin/components/AdminDataTable'
import { AdminLayout } from '../../admin/components/AdminLayout'
import { AdminTablePagination } from '../../admin/components/AdminTablePagination'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
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
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [hasLoadError, setHasLoadError] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const hasLoadedOnceRef = useRef(false)

  const load = useCallback(async () => {
    if (!hasLoadedOnceRef.current) setIsLoading(true)
    else setIsRefreshing(true)
    setHasLoadError(false)
    try {
      const res = await getSmartupReturns({ q: search, limit: PAGE_SIZE, offset })
      setRows(res.items)
      setTotal(res.total)
      hasLoadedOnceRef.current = true
    } catch {
      showError(t('admin:smartupReturns.load_error'))
      setHasLoadError(true)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
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

  const showInitialLoading = isLoading && !hasLoadedOnceRef.current

  const columns = useMemo((): AdminDataTableColumn<SmartupReturn>[] => {
    return [
      {
        id: 'date',
        header: t('admin:smartupReturns.col_date'),
        width: '9rem',
        cell: (row) => (
          <span className="whitespace-nowrap text-slate-700 dark:text-slate-200">
            {row.return_date ?? '—'}
          </span>
        ),
      },
      {
        id: 'customer',
        header: t('admin:smartupReturns.col_customer'),
        width: '16rem',
        cell: (row) => (
          <span
            className="block truncate font-medium text-slate-900 dark:text-slate-100"
            title={row.person_name ?? undefined}
          >
            {row.person_name ?? '—'}
          </span>
        ),
      },
      {
        id: 'order',
        header: t('admin:smartupReturns.col_order'),
        width: '9rem',
        cell: (row) => <span className="text-slate-500">{row.order_deal_id ?? '—'}</span>,
      },
      {
        id: 'products',
        header: t('admin:smartupReturns.col_products'),
        width: '7rem',
        align: 'right',
        cell: (row) => <span className="tabular-nums">{row.lines_count}</span>,
      },
      {
        id: 'amount',
        header: t('admin:smartupReturns.col_amount'),
        width: '9rem',
        align: 'right',
        cell: (row) => (
          <span className="tabular-nums font-semibold text-rose-600 dark:text-rose-400">
            {formatAmount(row.total_amount)}
          </span>
        ),
      },
      {
        id: 'manager',
        header: t('admin:smartupReturns.col_manager'),
        width: '12rem',
        cell: (row) => (
          <span className="block truncate text-slate-500" title={row.sales_manager_name ?? undefined}>
            {row.sales_manager_name ?? '—'}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('admin:smartupReturns.col_status'),
        width: '9rem',
        cell: (row) => (
          <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {row.status ?? '—'}
          </span>
        ),
      },
    ]
  }, [t])

  const tableBody = (): ReactNode => {
    if (showInitialLoading) {
      return (
        <div className="relative min-h-[240px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      )
    }
    if (hasLoadError) {
      return (
        <EmptyState
          title={t('admin:smartupReturns.load_error')}
          actionLabel={t('common:buttons.retry')}
          onAction={() => void load()}
        />
      )
    }
    if (rows.length === 0) {
      return (
        <EmptyState
          icon={<PackageX size={32} />}
          title={t('admin:smartupReturns.empty')}
          actionLabel={t('common:buttons.refresh')}
          onAction={() => void load()}
        />
      )
    }
    return (
      <AdminDataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        minWidth="min-w-[64rem]"
        onRowClick={(row) => navigate(`/admin/smartup-returns/${row.id}`)}
        refreshing={isRefreshing}
        refreshingLabel={t('common:messages.loading')}
      />
    )
  }

  return (
    <AdminLayout
      titleSlot={
        <div className="flex items-center gap-2">
          <PackageX size={18} />
          <span className="text-sm font-semibold">{t('admin:smartupReturns.title')}</span>
        </div>
      }
    >
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="relative w-full min-w-[180px] max-w-md sm:w-72 sm:flex-none">
            <Search
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSearch()
              }}
              placeholder={t('admin:smartupReturns.search_placeholder')}
              className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
              aria-label={t('admin:smartupReturns.search_placeholder')}
            />
          </div>
          <Button variant="secondary" onClick={onSearch}>
            {t('common:actions.search', 'Qidirish')}
          </Button>
          <Button
            className="gap-1.5"
            onClick={() => void onSync()}
            disabled={syncing}
          >
            <RefreshCw size={18} className={syncing ? 'animate-spin shrink-0' : 'shrink-0'} />
            {t('admin:smartupReturns.sync_btn')}
          </Button>
        </div>

        {tableBody()}

        {!showInitialLoading && total > 0 ? (
          <AdminTablePagination
            offset={offset}
            pageSize={PAGE_SIZE}
            total={total}
            onPrev={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            onNext={() => setOffset(offset + PAGE_SIZE)}
          />
        ) : null}
      </Card>
    </AdminLayout>
  )
}
