import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import {
  createMovement,
  getInventoryDetails,
  getInventorySummary,
  getInventoryByLocation,
  type InventoryDetailRow,
  type InventorySummaryRow,
} from '../../services/inventoryApi'
import { getLocations, type Location } from '../../services/locationsApi'

type MovementKind = 'expired' | 'damaged' | 'simple'

export function MovementPage() {
  const { t } = useTranslation(['admin', 'inventory', 'common'])
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
  const [bulkFromLocationId, setBulkFromLocationId] = useState('')
  const [bulkToLocationId, setBulkToLocationId] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [bulkSuccessCount, setBulkSuccessCount] = useState<number | null>(null)

  useEffect(() => {
    setLocationsLoading(true)
    getLocations(false)
      .then(setLocations)
      .catch(() => setLocations([]))
      .finally(() => setLocationsLoading(false))
  }, [])

  const resetForm = useCallback(() => {
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
      alert(t('admin:movement_page.success'))
      resetForm()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('admin:movement_page.error'))
    } finally {
      setSubmitLoading(false)
    }
  }, [canSubmit, selectedProduct, fromRow, toLocationId, qtyNum, t, resetForm])

  const canBulkMove =
    bulkFromLocationId &&
    bulkToLocationId &&
    bulkFromLocationId !== bulkToLocationId &&
    !bulkLoading

  const handleBulkMove = useCallback(async () => {
    if (!canBulkMove) return
    setBulkLoading(true)
    setBulkError(null)
    setBulkSuccessCount(null)
    try {
      const rows = await getInventoryByLocation(bulkFromLocationId)
      const toMove = rows.filter((r) => Number(r.available) > 0)
      if (toMove.length === 0) {
        setBulkError(t('admin:movement_page.move_entire_location_empty'))
        setBulkLoading(false)
        return
      }
      for (const row of toMove) {
        const qty = Math.round(Number(row.available))
        await createMovement({
          product_id: row.product_id,
          lot_id: row.lot_id,
          location_id: bulkFromLocationId,
          qty_change: -qty,
          movement_type: 'adjust',
          reason_code: 'inventory_shortage',
        })
        await createMovement({
          product_id: row.product_id,
          lot_id: row.lot_id,
          location_id: bulkToLocationId,
          qty_change: qty,
          movement_type: 'adjust',
          reason_code: 'inventory_overage',
        })
      }
      setBulkSuccessCount(toMove.length)
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : t('admin:movement_page.move_entire_location_error'))
    } finally {
      setBulkLoading(false)
    }
  }, [canBulkMove, bulkFromLocationId, bulkToLocationId, t])

  return (
    <AdminLayout title={t('admin:menu.movement')}>
      <Card className="p-4">
        <Link
          to="/admin/kamomat"
          className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {t('admin:movement_page.view_history_link')}
          <span aria-hidden>→</span>
        </Link>
      </Card>

      <Card className="p-6">
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
            <label className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-400">
              {t('admin:movement_page.select_from')}
            </label>
            <div className="max-h-48 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5">{t('inventory:columns.location')}</th>
                    <th className="px-4 py-2.5">{t('inventory:columns.batch')}</th>
                    <th className="px-4 py-2.5 text-right">{t('inventory:columns.qty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {details.map((row) => (
                    <tr
                      key={`${row.lot_id}-${row.location_id}`}
                      role="button"
                      tabIndex={0}
                      className={`cursor-pointer border-b border-slate-100 transition-colors last:border-0 dark:border-slate-700 ${
                        fromRow?.location_id === row.location_id && fromRow?.lot_id === row.lot_id
                          ? 'bg-blue-50 dark:bg-blue-950'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                      onClick={() => {
                        setFromRow(row)
                        setToLocationId('')
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setFromRow(row)
                          setToLocationId('')
                        }
                      }}
                    >
                      <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                        {row.location_code}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">
                        {row.batch}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">
                        {Math.round(Number(row.available))} {t('admin:movement_page.pcs')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
          <Button variant="ghost" onClick={resetForm} disabled={submitLoading}>
            {t('admin:movement_page.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || submitLoading}
          >
            {submitLoading ? '...' : t('admin:movement_page.submit')}
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t('admin:movement_page.move_entire_location_title')}
        </h3>
        <div className="mb-3">
          <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-400">
            {t('admin:movement_page.move_entire_location_from')}
          </label>
          <select
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={bulkFromLocationId}
            onChange={(e) => {
              setBulkFromLocationId(e.target.value)
              setBulkError(null)
              setBulkSuccessCount(null)
            }}
          >
            <option value="">—</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.code} {loc.zone_type ? `(${loc.zone_type})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-400">
            {t('admin:movement_page.move_entire_location_to')}
          </label>
          <select
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={bulkToLocationId}
            onChange={(e) => {
              setBulkToLocationId(e.target.value)
              setBulkError(null)
              setBulkSuccessCount(null)
            }}
          >
            <option value="">—</option>
            {locations
              .filter((loc) => loc.id !== bulkFromLocationId)
              .map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.code} {loc.zone_type ? `(${loc.zone_type})` : ''}
                </option>
              ))}
          </select>
        </div>
        {bulkError && (
          <p className="mb-3 text-sm text-red-600 dark:text-red-400">{bulkError}</p>
        )}
        {bulkSuccessCount != null && (
          <p className="mb-3 text-sm text-green-600 dark:text-green-400">
            {t('admin:movement_page.move_entire_location_success', { count: bulkSuccessCount })}
          </p>
        )}
        <Button
          onClick={handleBulkMove}
          disabled={!canBulkMove}
        >
          {bulkLoading ? '...' : t('admin:movement_page.move_entire_location_submit')}
        </Button>
      </Card>
    </AdminLayout>
  )
}
