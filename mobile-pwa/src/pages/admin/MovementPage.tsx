import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  createMovement,
  getInventoryDetails,
  getInventoryMovements,
  getInventorySummary,
  type InventoryDetailRow,
  type InventoryMovement,
  type InventorySummaryRow,
} from '../../services/inventoryApi'
import { getLocations, type Location } from '../../services/locationsApi'

const PAGE_SIZE = 50
type MovementKind = 'expired' | 'damaged' | 'simple'

export function MovementPage() {
  const { t } = useTranslation(['admin', 'inventory', 'common'])
  const [items, setItems] = useState<InventoryMovement[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [movementKind, setMovementKind] = useState<MovementKind>('simple')
  const [productSearch, setProductSearch] = useState('')
  const [productList, setProductList] = useState<InventorySummaryRow[]>([])
  const [productSearching, setProductSearching] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<InventorySummaryRow | null>(null)
  const [details, setDetails] = useState<InventoryDetailRow[]>([])
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [fromRow, setFromRow] = useState<InventoryDetailRow | null>(null)
  const [toLocationId, setToLocationId] = useState('')
  const [locations, setLocations] = useState<Location[]>([])
  const [locationsLoading, setLocationsLoading] = useState(false)
  const [qty, setQty] = useState('')
  const [submitLoading, setSubmitLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getInventoryMovements({
        movement_type: 'adjust',
        limit: PAGE_SIZE,
        offset: 0,
      })
      setItems(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const openModal = useCallback(() => {
    setModalOpen(true)
    setMovementKind('simple')
    setProductSearch('')
    setProductList([])
    setSelectedProduct(null)
    setDetails([])
    setFromRow(null)
    setToLocationId('')
    setQty('')
    setSubmitError(null)
  }, [])

  useEffect(() => {
    if (!modalOpen) return
    setLocationsLoading(true)
    getLocations(false)
      .then(setLocations)
      .catch(() => setLocations([]))
      .finally(() => setLocationsLoading(false))
  }, [modalOpen])

  const searchProducts = useCallback(async () => {
    const q = productSearch.trim()
    if (!q) {
      setProductList([])
      return
    }
    setProductSearching(true)
    try {
      const data = await getInventorySummary({ search: q, only_available: true })
      setProductList(data)
    } catch {
      setProductList([])
    } finally {
      setProductSearching(false)
    }
  }, [productSearch])

  useEffect(() => {
    const timer = setTimeout(searchProducts, 400)
    return () => clearTimeout(timer)
  }, [productSearch, searchProducts])

  const selectProduct = useCallback((p: InventorySummaryRow) => {
    setSelectedProduct(p)
    setDetails([])
    setFromRow(null)
    setToLocationId('')
    setDetailsLoading(true)
    getInventoryDetails({ product_id: p.product_id, show_zero: false })
      .then((rows) => setDetails(rows))
      .catch(() => setDetails([]))
      .finally(() => setDetailsLoading(false))
  }, [])

  const toLocationOptions = useMemo(() => {
    if (locationsLoading || !locations.length) return []
    const fromId = fromRow?.location_id
    if (movementKind === 'expired') {
      return locations.filter((loc) => loc.zone_type === 'EXPIRED' && loc.id !== fromId)
    }
    if (movementKind === 'damaged') {
      return locations.filter((loc) => loc.zone_type === 'DAMAGED' && loc.id !== fromId)
    }
    return locations.filter((loc) => loc.id !== fromId)
  }, [locations, locationsLoading, movementKind, fromRow?.location_id])

  const maxQty = fromRow ? Number(fromRow.available) || 0 : 0
  const qtyNum = Math.floor(Number(qty) || 0)
  const canSubmit =
    selectedProduct &&
    fromRow &&
    toLocationId &&
    toLocationId !== fromRow.location_id &&
    qtyNum >= 1 &&
    qtyNum <= maxQty

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !selectedProduct || !fromRow) return
    setSubmitLoading(true)
    setSubmitError(null)
    try {
      await createMovement({
        product_id: selectedProduct.product_id,
        lot_id: fromRow.lot_id,
        location_id: fromRow.location_id,
        qty_change: -qtyNum,
        movement_type: 'adjust',
        reason_code: 'inventory_shortage',
      })
      await createMovement({
        product_id: selectedProduct.product_id,
        lot_id: fromRow.lot_id,
        location_id: toLocationId,
        qty_change: qtyNum,
        movement_type: 'adjust',
        reason_code: 'inventory_overage',
      })
      setModalOpen(false)
      void loadHistory()
      alert(t('admin:movement_page.success'))
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('admin:movement_page.error'))
    } finally {
      setSubmitLoading(false)
    }
  }, [canSubmit, selectedProduct, fromRow, toLocationId, qtyNum, loadHistory, t])

  const content = () => {
    if (isLoading) {
      return (
        <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      )
    }
    if (error) {
      return (
        <EmptyState
          title={error}
          actionLabel={t('common:buttons.retry')}
          onAction={loadHistory}
        />
      )
    }
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('inventory:movements_empty')}
          description={t('inventory:movements_empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={loadHistory}
        />
      )
    }
    return (
      <TableScrollArea>
        <table className="min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="px-4 py-3 text-left">{t('inventory:columns.movement_type')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.qty')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.product')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.lot')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.location')}</th>
              <th className="px-4 py-3 text-left">{t('inventory:columns.created_at')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {t(`inventory:movement_types.${row.movement_type}`, row.movement_type)}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {Math.round(Number(row.qty_change))}
                </td>
                <td className="max-w-[200px] px-4 py-3 text-slate-700 dark:text-slate-200">
                  {row.product_code != null || row.product_name != null ? (
                    <span className="block truncate" title={row.product_name ?? undefined}>
                      {[row.product_code, row.product_name].filter(Boolean).join(' — ')}
                    </span>
                  ) : (
                    row.product_id
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">{row.lot_id}</td>
                <td className="px-4 py-3 text-slate-500">{row.location_id}</td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(row.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }

  return (
    <>
      <AdminLayout
        title={t('admin:menu.movement')}
        actionSlot={
          <Button onClick={openModal}>
            <Plus size={18} />
            {t('admin:movement_page.do_button')}
          </Button>
        }
      >
        <h2 className="mb-3 text-lg font-medium text-slate-700 dark:text-slate-300">
          {t('admin:movement_page.history')}
        </h2>
        <Card className="space-y-4">{content()}</Card>
      </AdminLayout>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-6">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            onClick={() => setModalOpen(false)}
            aria-label={t('admin:movement_page.cancel')}
          />
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('admin:movement_page.do_button')}
            </h3>

            <div className="mb-3">
              <span className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-400">
                {t('admin:movement_page.kind_label')}
              </span>
              <div className="flex gap-2">
                {(['expired', 'damaged', 'simple'] as const).map((kind) => (
                  <Button
                    key={kind}
                    variant={movementKind === kind ? 'default' : 'secondary'}
                    onClick={() => {
                      setMovementKind(kind)
                      setToLocationId('')
                    }}
                  >
                    {t(`admin:movement_page.type_${kind}`)}
                  </Button>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-400">
                {t('admin:movement_page.product_search')}
              </label>
              <input
                type="text"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder={t('admin:movement_page.select_product')}
              />
              {productSearching && (
                <p className="mt-1 text-xs text-slate-500">...</p>
              )}
              {productList.length > 0 && !selectedProduct && (
                <ul className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  {productList.slice(0, 10).map((p) => (
                    <li key={p.product_id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                        onClick={() => selectProduct(p)}
                      >
                        {p.product_code} — {p.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {selectedProduct && (
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {selectedProduct.product_code} — {selectedProduct.name}
                  <button
                    type="button"
                    className="ml-2 text-blue-600"
                    onClick={() => {
                      setSelectedProduct(null)
                      setDetails([])
                      setFromRow(null)
                    }}
                  >
                    (x)
                  </button>
                </p>
              )}
            </div>

            {detailsLoading && <p className="mb-2 text-sm text-slate-500">...</p>}
            {details.length > 0 && (
              <div className="mb-3">
                <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-400">
                  {t('admin:movement_page.select_from')}
                </label>
                <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  {details.map((row) => (
                    <button
                      key={`${row.lot_id}-${row.location_id}`}
                      type="button"
                      className={`block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 dark:border-slate-700 ${
                        fromRow?.location_id === row.location_id && fromRow?.lot_id === row.lot_id
                          ? 'bg-blue-50 dark:bg-blue-950'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                      onClick={() => {
                        setFromRow(row)
                        setToLocationId('')
                      }}
                    >
                      {row.location_code} | {row.batch} | {row.available} {t('admin:movement_page.pcs')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {fromRow && (
              <>
                <div className="mb-3">
                  <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-400">
                    {t('admin:movement_page.select_to')}
                  </label>
                  <select
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    value={toLocationId}
                    onChange={(e) => setToLocationId(e.target.value)}
                  >
                    <option value="">—</option>
                    {toLocationOptions.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.code} {loc.zone_type ? `(${loc.zone_type})` : ''}
                      </option>
                    ))}
                  </select>
                  {toLocationOptions.length === 0 && !locationsLoading && (
                    <p className="mt-1 text-xs text-amber-600">
                      {movementKind === 'expired'
                        ? t('admin:movement_page.no_expired_zone')
                        : movementKind === 'damaged'
                          ? t('admin:movement_page.no_damaged_zone')
                          : t('admin:movement_page.select_other')}
                    </p>
                  )}
                </div>
                <div className="mb-4">
                  <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-400">
                    {t('admin:movement_page.qty')} (max {maxQty} {t('admin:movement_page.pcs')})
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={maxQty}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                  />
                </div>
              </>
            )}

            {submitError && (
              <p className="mb-3 text-sm text-red-600 dark:text-red-400">{submitError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={submitLoading}>
                {t('admin:movement_page.cancel')}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || submitLoading}
              >
                {submitLoading ? '...' : t('admin:movement_page.submit')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
