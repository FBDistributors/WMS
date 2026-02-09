import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Settings, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { AddProductDialog } from '../../admin/components/products/AddProductDialog'
import { ImportProductsDialog } from '../../admin/components/products/ImportProductsDialog'
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
  const { isSupervisor, isWarehouseAdmin, has } = useAuth()
  const canManageSettings = isSupervisor || isWarehouseAdmin
  const canManageProducts = has('products:write') || isSupervisor || isWarehouseAdmin

  const { config, updateConfig, resetConfig } = useTableConfig()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)

  const [items, setItems] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const limit = 50
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (search: string, nextOffset: number) => {
      setIsLoading(true)
      setError(null)
      try {
        const data = await getProducts({ search, limit, offset: nextOffset })
        setItems(data.items)
        setTotal(data.total)
      } catch {
        setError(t('products:load_error'))
      } finally {
        setIsLoading(false)
      }
    },
    [limit, t]
  )

  const handleRetry = useCallback(() => {
    void load(debouncedQuery, offset)
  }, [debouncedQuery, load, offset])

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(handle)
  }, [query])

  const prevQueryRef = useRef(debouncedQuery)

  useEffect(() => {
    const prev = prevQueryRef.current
    if (prev !== debouncedQuery && offset !== 0) {
      prevQueryRef.current = debouncedQuery
      setOffset(0)
      return
    }
    prevQueryRef.current = debouncedQuery
    void load(debouncedQuery, offset)
  }, [debouncedQuery, load, offset])

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
        <Button variant="secondary" onClick={handleRetry}>
          {t('products:refresh')}
        </Button>
      }
    >
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <Search size={18} className="text-slate-400" />
          <input
            className="w-full bg-transparent text-sm text-slate-900 outline-none dark:text-slate-100"
            placeholder={t('products:search_placeholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 md:flex-nowrap">
          {canManageProducts && (
            <Button
              className="w-full md:w-auto"
              onClick={() => setIsAddOpen(true)}
            >
              <Plus size={16} />
              {t('products:add.button')}
            </Button>
          )}
          {canManageProducts && (
            <Button
              variant="secondary"
              className="w-full md:w-auto"
              onClick={() => setIsImportOpen(true)}
            >
              <Upload size={16} />
              {t('products:import.button')}
            </Button>
          )}
          {canManageSettings && (
            <Button
              variant="secondary"
              className="w-full md:w-auto"
              onClick={() => setIsSettingsOpen(true)}
            >
              <Settings size={16} />
              {t('products:table.settings_button')}
            </Button>
          )}
          <Button variant="secondary" className="w-full md:w-auto" onClick={handleRetry}>
            {t('products:refresh')}
          </Button>
        </div>
      </div>
      {content}
      {total > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600 dark:text-slate-300">
          <div>
            {t('products:pagination.summary', {
              from: offset + 1,
              to: Math.min(offset + limit, total),
              total,
            })}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset((prev) => Math.max(prev - limit, 0))}
            >
              {t('products:pagination.prev')}
            </Button>
            <Button
              variant="secondary"
              disabled={offset + limit >= total}
              onClick={() => setOffset((prev) => prev + limit)}
            >
              {t('products:pagination.next')}
            </Button>
          </div>
        </div>
      ) : null}
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
      {canManageProducts && (
        <AddProductDialog
          open={isAddOpen}
          onOpenChange={setIsAddOpen}
          onCreated={() => {
            setOffset(0)
            void load(debouncedQuery, 0)
          }}
        />
      )}
      {canManageProducts && (
        <ImportProductsDialog
          open={isImportOpen}
          onOpenChange={setIsImportOpen}
          onImported={() => {
            setOffset(0)
            void load(debouncedQuery, 0)
          }}
        />
      )}
    </AdminLayout>
  )
}
