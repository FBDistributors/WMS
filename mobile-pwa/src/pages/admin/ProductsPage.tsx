import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { ProductsTable } from '../../admin/components/products/ProductsTable'
import { ProductsTableSettings } from '../../admin/components/products/ProductsTableSettings'
import { useTableConfig } from '../../admin/hooks/useTableConfig'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/EmptyState'
import { getProducts, type Product } from '../../services/productsApi'
import { useAuth } from '../../rbac/AuthProvider'

const COLUMN_OPTIONS = [
  { id: 'sku', labelKey: 'products:columns.sku' },
  { id: 'photo', labelKey: 'products:columns.photo' },
  { id: 'name', labelKey: 'products:columns.name' },
  { id: 'category', labelKey: 'products:columns.category' },
  { id: 'brand', labelKey: 'products:columns.brand' },
  { id: 'status', labelKey: 'products:columns.status' },
  { id: 'quantity', labelKey: 'products:columns.quantity' },
  { id: 'created_by', labelKey: 'products:columns.created_by' },
  { id: 'article_code', labelKey: 'products:columns.article_code' },
  { id: 'barcode', labelKey: 'products:columns.barcode' },
  { id: 'internal_id', labelKey: 'products:columns.internal_id' },
  { id: 'manufacturer', labelKey: 'products:columns.manufacturer' },
  { id: 'group', labelKey: 'products:columns.group' },
  { id: 'qty_cases', labelKey: 'products:columns.qty_cases' },
  { id: 'qty_units', labelKey: 'products:columns.qty_units' },
]

const SEARCH_FIELD_OPTIONS = [
  { id: 'sku', labelKey: 'products:search_fields.sku' },
  { id: 'barcode', labelKey: 'products:search_fields.barcode' },
  { id: 'name', labelKey: 'products:search_fields.name' },
  { id: 'alt_name', labelKey: 'products:search_fields.alt_name' },
  { id: 'category', labelKey: 'products:search_fields.category' },
  { id: 'group', labelKey: 'products:search_fields.group' },
]

export function ProductsPage() {
  const navigate = useNavigate()
  const { t } = useTranslation(['products', 'common'])
  const { isSupervisor, isWarehouseAdmin } = useAuth()
  const canManageSettings = isSupervisor || isWarehouseAdmin

  const { config, updateConfig, resetConfig } = useTableConfig()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const [items, setItems] = useState<Product[]>([])
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (search: string) => {
      setIsLoading(true)
      setError(null)
      try {
        const data = await getProducts({ q: search })
        setItems(data.items)
      } catch {
        setError(t('products:load_error'))
      } finally {
        setIsLoading(false)
      }
    },
    [t]
  )

  const handleRetry = useCallback(() => {
    void load(debouncedQuery)
  }, [debouncedQuery, load])

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(handle)
  }, [query])

  useEffect(() => {
    void load(debouncedQuery)
  }, [debouncedQuery, load])

  const columnOptions = useMemo(
    () => COLUMN_OPTIONS.map((column) => ({ id: column.id, label: t(column.labelKey) })),
    [t]
  )

  const searchFieldOptions = useMemo(
    () => SEARCH_FIELD_OPTIONS.map((field) => ({ id: field.id, label: t(field.labelKey) })),
    [t]
  )

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="space-y-3">
          <div className="h-20 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
          <div className="h-20 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
        </div>
      )
    }

    if (error) {
      return (
        <EmptyState
          icon={<Settings size={32} />}
          title={error}
          actionLabel={t('common:buttons.retry')}
          onAction={handleRetry}
        />
      )
    }

    if (items.length === 0) {
      return (
        <EmptyState
          icon={<Settings size={32} />}
          title={t('products:empty_title')}
          description={t('products:empty_desc')}
          actionLabel={t('products:refresh')}
          onAction={handleRetry}
        />
      )
    }

    return (
      <ProductsTable
        items={items}
        columnOrder={config.columnOrder}
        visibleColumns={config.visibleColumns}
        onRowClick={(item) => navigate(`/admin/products/${item.id}`)}
      />
    )
  }, [config.columnOrder, config.visibleColumns, error, handleRetry, isLoading, items, navigate, t])

  return (
    <AdminLayout
      title={t('products:title')}
      actionSlot={
        <div className="flex items-center gap-2">
          {canManageSettings && (
            <Button variant="secondary" onClick={() => setIsSettingsOpen(true)}>
              <Settings size={16} className="mr-2" />
              {t('products:table.settings_button')}
            </Button>
          )}
          <Button variant="secondary" onClick={handleRetry}>
            {t('products:refresh')}
          </Button>
        </div>
      }
    >
      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <Search size={18} className="text-slate-400" />
        <input
          className="w-full bg-transparent text-sm text-slate-900 outline-none dark:text-slate-100"
          placeholder={t('products:search_placeholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {content}
      {canManageSettings && (
        <ProductsTableSettings
          open={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
          config={config}
          columns={columnOptions}
          searchFields={searchFieldOptions}
          onSave={updateConfig}
          onReset={resetConfig}
        />
      )}
    </AdminLayout>
  )
}
