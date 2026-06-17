import { useCallback, useEffect, useState } from 'react'
import { PackagePlus, Pencil, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { AddProductBoxDialog } from '../../admin/components/product_boxes/AddProductBoxDialog'
import { EditProductBoxDialog } from '../../admin/components/product_boxes/EditProductBoxDialog'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import {
  deleteProductBox,
  listProductBoxes,
  type ProductBox,
} from '../../services/productBoxesApi'
import { useAuth } from '../../rbac/AuthProvider'

export function ProductBoxesPage() {
  const { t } = useTranslation(['productBoxes', 'common'])
  const { has, isSupervisor, isWarehouseAdmin } = useAuth()
  const canManage = has('products:write') || isSupervisor || isWarehouseAdmin
  const { showError, showSuccess } = useAppToast()

  const [items, setItems] = useState<ProductBox[]>([])
  const [search, setSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editItem, setEditItem] = useState<ProductBox | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await listProductBoxes({
        search: activeSearch || undefined,
        limit: 200,
      })
      setItems(data)
    } catch {
      showError(t('productBoxes:load_error'))
    } finally {
      setIsLoading(false)
    }
  }, [activeSearch, showError, t])

  useEffect(() => {
    void load()
  }, [load])

  const handleDelete = async (item: ProductBox) => {
    if (!window.confirm(t('productBoxes:confirm_delete', { code: item.box_barcode }))) return
    try {
      await deleteProductBox(item.id)
      showSuccess(t('productBoxes:deleted'))
      void load()
    } catch (error) {
      showError(error instanceof Error ? error.message : t('productBoxes:delete_failed'))
    }
  }

  return (
    <AdminLayout
      title={t('productBoxes:title')}
      actionSlot={
        canManage ? (
          <Button type="button" onClick={() => setIsAddOpen(true)}>
            <PackagePlus className="mr-1 h-4 w-4" />
            {t('productBoxes:add')}
          </Button>
        ) : undefined
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm dark:border-slate-600 dark:bg-slate-800"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setActiveSearch(search.trim())
            }}
            placeholder={t('productBoxes:search_placeholder')}
          />
        </div>
        <Button type="button" variant="outline" onClick={() => setActiveSearch(search.trim())}>
          {t('common:search')}
        </Button>
        <Button type="button" variant="outline" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {isLoading ? <LoadingOverlay /> : null}

      {!isLoading && items.length === 0 ? (
        <EmptyState
          title={t('productBoxes:empty_title')}
          description={t('productBoxes:empty_desc')}
          actionLabel={canManage ? t('productBoxes:add') : undefined}
          onAction={canManage ? () => setIsAddOpen(true) : undefined}
        />
      ) : null}

      {!isLoading && items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-3">{t('productBoxes:columns.box_barcode')}</th>
                <th className="px-4 py-3">{t('productBoxes:columns.product')}</th>
                <th className="px-4 py-3">{t('productBoxes:columns.units')}</th>
                <th className="px-4 py-3">{t('productBoxes:columns.label')}</th>
                {canManage ? <th className="px-4 py-3 w-16" /> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-slate-100 dark:border-slate-800"
                >
                  <td className="px-4 py-3 font-mono text-xs">{item.box_barcode}</td>
                  <td className="px-4 py-3">
                    {item.product
                      ? `${item.product.sku} — ${item.product.name}`
                      : item.product_id}
                  </td>
                  <td className="px-4 py-3">{item.units_per_box}</td>
                  <td className="px-4 py-3 text-slate-500">{item.label ?? '—'}</td>
                  {canManage ? (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="rounded p-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                          title={t('productBoxes:edit')}
                          onClick={() => {
                            setEditItem(item)
                            setIsEditOpen(true)
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                          title={t('common:delete')}
                          onClick={() => void handleDelete(item)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <AddProductBoxDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        onCreated={() => {
          showSuccess(t('productBoxes:created'))
          void load()
        }}
      />
      <EditProductBoxDialog
        open={isEditOpen}
        item={editItem}
        onOpenChange={(open) => {
          setIsEditOpen(open)
          if (!open) setEditItem(null)
        }}
        onUpdated={() => {
          showSuccess(t('productBoxes:updated'))
          void load()
        }}
      />
    </AdminLayout>
  )
}
