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

type ActiveTab = 'product' | 'location'

export function MovementPage() {
  const { t } = useTranslation(['admin', 'inventory', 'common'])
  const [activeTab, setActiveTab] = useState<ActiveTab>('product')
  const [productSearch, setProductSearch] = useState('')
  const [productList, setProductList] = useState<InventorySummaryRow[]>([])
  const [productSearching, setProductSearching] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<InventorySummaryRow | null>(null)
  const [details, setDetails] = useState<InventoryDetailRow[]>([])
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [fromRow, setFromRow] = useState<InventoryDetailRow | null>(null)
  const [toLocationId, setToLocationId] = useState('')
  const [toLocationSearch, setToLocationSearch] = useState('')
  const [locations, setLocations] = useState<Location[]>([])
  const [locationsLoading, setLocationsLoading] = useState(false)
  const [qty, setQty] = useState('')
  const [submitLoading, setSubmitLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [bulkFromLocationId, setBulkFromLocationId] = useState('')
  const [bulkFromLocationSearch, setBulkFromLocationSearch] = useState('')
  const [bulkToLocationId, setBulkToLocationId] = useState('')
  const [bulkToLocationSearch, setBulkToLocationSearch] = useState('')
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
    setProductSearch('')
    setProductList([])
    setSelectedProduct(null)
    setDetails([])
    setFromRow(null)
    setToLocationId('')
    setToLocationSearch('')
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
    setToLocationSearch('')
    setDetailsLoading(true)
    getInventoryDetails({ product_id: p.product_id, show_zero: false })
      .then((rows) => setDetails(rows))
      .catch(() => setDetails([]))
      .finally(() => setDetailsLoading(false))
  }, [])

  const toLocationOptions = useMemo(() => {
    if (locationsLoading || !locations.length) return []
    const fromId = fromRow?.location_id
    return locations.filter((loc) => loc.id !== fromId)
  }, [locations, locationsLoading, fromRow?.location_id])

  const toLocationFiltered = useMemo(() => {
    const q = toLocationSearch.trim().toLowerCase()
    if (!q) return []
    return toLocationOptions.filter((loc) => loc.code.toLowerCase().includes(q)).slice(0, 15)
  }, [toLocationOptions, toLocationSearch])

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

  const resetBulkForm = useCallback(() => {
    setBulkFromLocationId('')
    setBulkFromLocationSearch('')
    setBulkToLocationId('')
    setBulkToLocationSearch('')
    setBulkError(null)
    setBulkSuccessCount(null)
  }, [])

  const bulkFromFiltered = useMemo(() => {
    const q = bulkFromLocationSearch.trim().toLowerCase()
    if (!q) return []
    return locations.filter((loc) => loc.code.toLowerCase().includes(q)).slice(0, 15)
  }, [locations, bulkFromLocationSearch])

  const bulkToFiltered = useMemo(() => {
    const q = bulkToLocationSearch.trim().toLowerCase()
    if (!q) return []
    return locations
      .filter((loc) => loc.id !== bulkFromLocationId && loc.code.toLowerCase().includes(q))
      .slice(0, 15)
  }, [locations, bulkFromLocationId, bulkToLocationSearch])

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

      <Card className="overflow-hidden">
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
          <button
            type="button"
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'product'
                ? 'border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
            onClick={() => setActiveTab('product')}
          >
            {t('admin:movement_page.tab_product')}
          </button>
          <button
            type="button"
            className={`px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === 'location'
                ? 'border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
            onClick={() => setActiveTab('location')}
          >
            {t('admin:movement_page.section_move_entire_location')}
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'product' && (
            <>
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
                        setToLocationSearch('')
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setFromRow(row)
                          setToLocationId('')
                          setToLocationSearch('')
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
            <div className="mb-3 relative">
              <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-400">
                {t('admin:movement_page.select_to')}
              </label>
              <input
                type="text"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={toLocationId ? (locations.find((l) => l.id === toLocationId)?.code ?? toLocationSearch) : toLocationSearch}
                onChange={(e) => {
                  setToLocationSearch(e.target.value)
                  setToLocationId('')
                }}
                placeholder={t('admin:movement_page.to_location_code_placeholder')}
              />
              {toLocationSearch.trim().length > 0 && toLocationFiltered.length > 0 && !toLocationId && (
                <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {toLocationFiltered.map((loc) => (
                    <li key={loc.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                        onClick={() => {
                          setToLocationId(loc.id)
                          setToLocationSearch(loc.code)
                        }}
                      >
                        {loc.code} {loc.zone_type ? `(${loc.zone_type})` : ''}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {toLocationOptions.length === 0 && !locationsLoading && (
                <p className="mt-1 text-xs text-amber-600">
                  {t('admin:movement_page.select_other')}
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
            </>
          )}

          {activeTab === 'location' && (
            <>
        <div className="mb-3 relative">
          <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-400">
            {t('admin:movement_page.move_entire_location_from')}
          </label>
          <input
            type="text"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={bulkFromLocationId ? (locations.find((l) => l.id === bulkFromLocationId)?.code ?? bulkFromLocationSearch) : bulkFromLocationSearch}
            onChange={(e) => {
              setBulkFromLocationSearch(e.target.value)
              setBulkFromLocationId('')
              setBulkToLocationId('')
              setBulkToLocationSearch('')
              setBulkError(null)
              setBulkSuccessCount(null)
            }}
            placeholder={t('admin:movement_page.to_location_code_placeholder')}
          />
          {bulkFromLocationSearch.trim().length > 0 && bulkFromFiltered.length > 0 && !bulkFromLocationId && (
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {bulkFromFiltered.map((loc) => (
                <li key={loc.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => {
                      setBulkFromLocationId(loc.id)
                      setBulkFromLocationSearch(loc.code)
                      setBulkToLocationId('')
                      setBulkToLocationSearch('')
                      setBulkError(null)
                      setBulkSuccessCount(null)
                    }}
                  >
                    {loc.code} {loc.zone_type ? `(${loc.zone_type})` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mb-3 relative">
          <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-400">
            {t('admin:movement_page.move_entire_location_to')}
          </label>
          <input
            type="text"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={bulkToLocationId ? (locations.find((l) => l.id === bulkToLocationId)?.code ?? bulkToLocationSearch) : bulkToLocationSearch}
            onChange={(e) => {
              setBulkToLocationSearch(e.target.value)
              setBulkToLocationId('')
              setBulkError(null)
              setBulkSuccessCount(null)
            }}
            placeholder={t('admin:movement_page.to_location_code_placeholder')}
          />
          {bulkToLocationSearch.trim().length > 0 && bulkToFiltered.length > 0 && !bulkToLocationId && (
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {bulkToFiltered.map((loc) => (
                <li key={loc.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => {
                      setBulkToLocationId(loc.id)
                      setBulkToLocationSearch(loc.code)
                      setBulkError(null)
                      setBulkSuccessCount(null)
                    }}
                  >
                    {loc.code} {loc.zone_type ? `(${loc.zone_type})` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {bulkError && (
          <p className="mb-3 text-sm text-red-600 dark:text-red-400">{bulkError}</p>
        )}
        {bulkSuccessCount != null && (
          <p className="mb-3 text-sm text-green-600 dark:text-green-400">
            {t('admin:movement_page.move_entire_location_success', { count: bulkSuccessCount })}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={resetBulkForm} disabled={bulkLoading}>
            {t('admin:movement_page.cancel')}
          </Button>
          <Button
            onClick={handleBulkMove}
            disabled={!canBulkMove}
          >
            {bulkLoading ? '...' : t('admin:movement_page.move_entire_location_submit')}
          </Button>
        </div>
            </>
          )}
        </div>
      </Card>
    </AdminLayout>
  )
}
