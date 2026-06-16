import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { AdminDataTable, type AdminDataTableColumn } from '../../admin/components/AdminDataTable'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { getLocation, type Location } from '../../services/locationsApi'
import { useAppToast } from '../../feedback/useAppToast'
import { getInventoryByLocation, type InventoryByLocationRow } from '../../services/inventoryApi'

export function LocationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation(['locations', 'common'])
  const [location, setLocation] = useState<Location | null>(null)
  const [items, setItems] = useState<InventoryByLocationRow[]>([])
  const [filterQuery, setFilterQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const { showError } = useAppToast()
  const [hasLoadError, setHasLoadError] = useState(false)

  const filteredItems = useMemo(() => {
    const q = filterQuery.trim().toLowerCase()
    if (!q) return items
    return items.filter((row) => {
      const code = (row.product_code ?? '').toLowerCase()
      const name = (row.product_name ?? '').toLowerCase()
      const barcode = (row.barcode ?? '').toLowerCase()
      const brand = (row.brand ?? '').toLowerCase()
      const batch = (row.batch ?? '').toLowerCase()
      const expiry = (row.expiry_date ?? '').toString().toLowerCase()
      return (
        code.includes(q) ||
        name.includes(q) ||
        barcode.includes(q) ||
        brand.includes(q) ||
        batch.includes(q) ||
        expiry.includes(q)
      )
    })
  }, [items, filterQuery])

  const tableColumns = useMemo((): AdminDataTableColumn<InventoryByLocationRow>[] => {
    return [
      {
        id: 'code',
        header: t('locations:detail_col_code'),
        width: '6rem',
        cell: (row) => <span className="font-medium">{row.product_code}</span>,
      },
      {
        id: 'name',
        header: t('locations:detail_col_product_name'),
        width: '14rem',
        cell: (row) => <span className="line-clamp-2 block">{row.product_name}</span>,
      },
      {
        id: 'barcode',
        header: t('locations:detail_col_barcode'),
        width: '8rem',
        cell: (row) => (
          <span className="font-mono text-xs text-slate-700 dark:text-slate-200">{row.barcode ?? '—'}</span>
        ),
      },
      {
        id: 'brand',
        header: t('locations:detail_col_brand'),
        width: '7rem',
        cell: (row) => <span>{row.brand ?? '—'}</span>,
      },
      {
        id: 'batch',
        header: t('locations:detail_col_batch'),
        width: '5rem',
        cell: (row) => <span>{row.batch}</span>,
      },
      {
        id: 'expiry',
        header: t('locations:detail_col_expiry'),
        width: '7rem',
        cell: (row) => <span>{row.expiry_date ?? '—'}</span>,
      },
      {
        id: 'qty',
        header: t('locations:detail_col_qty'),
        width: '5rem',
        align: 'right',
        cell: (row) => <span className="font-medium">{Math.round(Number(row.available))}</span>,
      },
    ]
  }, [t])

  const load = useCallback(async () => {
    if (!id) return
    setIsLoading(true)
    setHasLoadError(false)
    try {
      const [loc, inventory] = await Promise.all([
        getLocation(id),
        getInventoryByLocation(id),
      ])
      setLocation(loc)
      setItems(inventory)
    } catch (err) {
      showError(err instanceof Error ? err.message : t('locations:load_failed'))
      setHasLoadError(true)
      setLocation(null)
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [id, showError, t])

  useEffect(() => {
    void load()
  }, [load])

  const tableBody = () => {
    if (isLoading && items.length === 0) {
      return (
        <div className="relative min-h-[200px] flex-1">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      )
    }
    if (hasLoadError && items.length === 0) {
      return (
        <EmptyState
          title={t('locations:load_failed')}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      )
    }
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('locations:detail_empty')}
          actionLabel={t('common:buttons.back')}
          onAction={() => navigate('/admin/locations')}
        />
      )
    }
    return (
      <>
        <label className="block w-full text-sm text-slate-600 dark:text-slate-300">
          <div className="relative mt-1 max-w-md">
            <input
              type="text"
              className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-3 pr-9 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={t('locations:detail_filter_placeholder')}
            />
            {filterQuery && (
              <button
                type="button"
                onClick={() => setFilterQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                aria-label={t('common:buttons.clear')}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </label>
        {filteredItems.length === 0 ? (
          <EmptyState
            title={t('locations:filter_no_results')}
            actionLabel={t('common:buttons.clear')}
            onAction={() => setFilterQuery('')}
          />
        ) : (
          <AdminDataTable
            columns={tableColumns}
            rows={filteredItems}
            getRowKey={(row) => row.lot_id}
            minWidth="min-w-[48rem]"
            refreshing={isLoading && items.length > 0}
            refreshingLabel={t('common:messages.loading')}
          />
        )}
      </>
    )
  }

  const title = location ? location.code : (id ?? '')

  return (
    <AdminLayout title={title}>
      <Card className="w-full max-w-full space-y-4">
        <div>
          <Button
            variant="ghost"
            className="p-2"
            aria-label={t('common:buttons.back')}
            onClick={() => navigate('/admin/locations')}
          >
            <ArrowLeft size={20} />
          </Button>
        </div>
        {tableBody()}
      </Card>
    </AdminLayout>
  )
}
