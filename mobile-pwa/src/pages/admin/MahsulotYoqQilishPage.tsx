import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Package, X } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  createMovement,
  getInventoryByLocation,
  type InventoryByLocationRow,
} from '../../services/inventoryApi'
import { getLocations, type Location } from '../../services/locationsApi'

const REASON_WRITE_OFF = 'inventory_shortage'

export function MahsulotYoqQilishPage() {
  const { t } = useTranslation(['kamomat', 'common'])
  const navigate = useNavigate()
  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState('')
  const [locationSearch, setLocationSearch] = useState('')
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false)
  const [products, setProducts] = useState<InventoryByLocationRow[]>([])
  const [loading, setLoading] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  /** writeOffQty[key] = number to write off; key = `${product_id}:${lot_id}` */
  const [writeOffQty, setWriteOffQty] = useState<Record<string, string>>({})

  useEffect(() => {
    getLocations(false)
      .then(setLocations)
      .catch(() => setLocations([]))
  }, [])

  const filteredLocations = useMemo(() => {
    const q = locationSearch.trim().toLowerCase()
    if (!q) return locations
    return locations.filter((loc) => {
      const code = (loc.code ?? '').toLowerCase()
      const name = (loc.name ?? '').toLowerCase()
      return code.includes(q) || name.includes(q)
    })
  }, [locations, locationSearch])

  const loadProducts = useCallback(() => {
    if (!locationId.trim()) {
      setProducts([])
      setWriteOffQty({})
      return
    }
    setLoading(true)
    setError(null)
    setSuccess(null)
    getInventoryByLocation(locationId)
      .then((rows) => {
        setProducts(rows)
        setWriteOffQty({})
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : t('kamomat:load_error'))
        setProducts([])
      })
      .finally(() => setLoading(false))
  }, [locationId, t])

  useEffect(() => {
    if (locationId) loadProducts()
    else {
      setProducts([])
      setWriteOffQty({})
    }
  }, [locationId, loadProducts])

  const setQty = useCallback((key: string, value: string) => {
    setWriteOffQty((prev) => ({ ...prev, [key]: value }))
  }, [])

  const getQty = useCallback(
    (row: InventoryByLocationRow) => {
      const key = `${row.product_id}:${row.lot_id}`
      const v = writeOffQty[key]
      const num = Math.floor(Number(v) || 0)
      return num
    },
    [writeOffQty]
  )

  const getQtyInput = useCallback(
    (row: InventoryByLocationRow) => {
      const key = `${row.product_id}:${row.lot_id}`
      return writeOffQty[key] ?? ''
    },
    [writeOffQty]
  )

  const hasAnyWriteOff = products.some((row) => getQty(row) > 0)
  const invalidQty = products.some((row) => {
    const q = getQty(row)
    return q > 0 && (q > row.available || q > row.on_hand)
  })

  const handleSubmit = useCallback(async () => {
    if (!locationId || !hasAnyWriteOff || invalidQty) return
    setSubmitLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const promises: Promise<unknown>[] = []
      for (const row of products) {
        const q = getQty(row)
        if (q <= 0) continue
        promises.push(
          createMovement({
            product_id: row.product_id,
            lot_id: row.lot_id,
            location_id: locationId,
            qty_change: -q,
            movement_type: 'adjust',
            reason_code: REASON_WRITE_OFF,
          })
        )
      }
      await Promise.all(promises)
      setSuccess(t('kamomat:write_off.success'))
      setWriteOffQty({})
      loadProducts()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('kamomat:write_off.error'))
    } finally {
      setSubmitLoading(false)
    }
  }, [locationId, products, hasAnyWriteOff, invalidQty, getQty, t, loadProducts])

  return (
    <AdminLayout title={t('kamomat:write_off.title')}>
      <div className="mb-4">
        <Link
          to="/admin/kamomat"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
        >
          <ArrowLeft size={16} />
          {t('kamomat:write_off.back')}
        </Link>
      </div>

      <Card className="mb-4 space-y-3">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('kamomat:write_off.select_location')}
        </label>
        <div className="relative flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px]">
            <input
              type="text"
              className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-3 pr-9 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={locationSearch}
              onChange={(e) => setLocationSearch(e.target.value)}
              onFocus={() => setLocationDropdownOpen(true)}
              onBlur={() => setTimeout(() => setLocationDropdownOpen(false), 150)}
              placeholder={t('kamomat:write_off.location_placeholder')}
              autoComplete="off"
            />
            {locationSearch && (
              <button
                type="button"
                onClick={() => {
                  setLocationSearch('')
                  setLocationId('')
                  setLocationDropdownOpen(false)
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                aria-label={t('common:buttons.clear')}
              >
                <X size={16} />
              </button>
            )}
          </div>
          {locationDropdownOpen && filteredLocations.length > 0 && (
            <ul
              className="absolute left-0 top-full z-10 mt-1 max-h-48 w-full min-w-[240px] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
              role="listbox"
            >
              {filteredLocations.map((loc) => {
                const code = loc.code ?? ''
                const name = (loc.name ?? '').trim()
                const label = name && name !== code ? `${code} — ${loc.name}` : code
                return (
                  <li key={loc.id} role="option">
                    <button
                      type="button"
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${
                        locationId === loc.id ? 'bg-blue-50 dark:bg-blue-950/50' : ''
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setLocationId(loc.id)
                        setLocationSearch(label)
                        setLocationDropdownOpen(false)
                      }}
                    >
                      {label}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {locationId && (
            <Button variant="secondary" onClick={loadProducts} disabled={loading}>
              {loading ? t('common:messages.loading') : t('kamomat:write_off.load_products')}
            </Button>
          )}
        </div>
      </Card>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/50 dark:text-green-200">
          {success}
        </div>
      )}

      {locationId && (
        <Card className="space-y-4">
          {loading ? (
            <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
          ) : products.length === 0 ? (
            <EmptyState
              icon={<Package size={32} />}
              title={t('kamomat:write_off.empty_location')}
              actionLabel={t('kamomat:write_off.back')}
              onAction={() => navigate('/admin/kamomat')}
            />
          ) : (
            <>
              <TableScrollArea>
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr className="border-b border-slate-200 dark:border-slate-800">
                      <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">
                        {t('kamomat:write_off.product')}
                      </th>
                      <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">
                        {t('kamomat:write_off.batch')}
                      </th>
                      <th className="whitespace-nowrap px-3 py-3 text-right sm:px-4">
                        {t('kamomat:write_off.on_hand')}
                      </th>
                      <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">
                        {t('kamomat:write_off.write_off_qty')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((row) => {
                      const onHand = Number(row.on_hand)
                      const available = Number(row.available)
                      const inputVal = getQtyInput(row)
                      const numVal = getQty(row)
                      const over = numVal > 0 && (numVal > available || numVal > onHand)
                      return (
                        <tr
                          key={`${row.product_id}:${row.lot_id}`}
                          className="border-b border-slate-100 dark:border-slate-800"
                        >
                          <td className="px-3 py-3 sm:px-4">
                            <span className="font-medium text-slate-800 dark:text-slate-200">
                              {row.product_code}
                            </span>
                            {row.product_name && (
                              <span className="ml-1 text-slate-600 dark:text-slate-400">
                                — {row.product_name}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-300 sm:px-4">
                            {row.batch}
                            {row.expiry_date ? ` (${row.expiry_date})` : ''}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-slate-700 dark:text-slate-200 sm:px-4">
                            {Math.round(Number(row.on_hand))}
                          </td>
                          <td className="px-3 py-3 sm:px-4">
                            <input
                              type="number"
                              min={0}
                              max={Math.round(available)}
                              step={1}
                              className={`w-24 rounded-xl border px-2 py-1.5 text-right font-mono text-sm outline-none dark:bg-slate-900 dark:text-slate-100 ${
                                over
                                  ? 'border-red-500 dark:border-red-500'
                                  : 'border-slate-200 dark:border-slate-700'
                              }`}
                              value={inputVal}
                              onChange={(e) =>
                                setQty(`${row.product_id}:${row.lot_id}`, e.target.value)
                              }
                              placeholder="0"
                            />
                            {over && (
                              <span className="ml-1 text-xs text-red-600 dark:text-red-400">
                                ≤ {Math.round(available)}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </TableScrollArea>
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleSubmit}
                  disabled={!hasAnyWriteOff || invalidQty || submitLoading}
                >
                  {submitLoading ? t('common:messages.loading') : t('kamomat:write_off.submit')}
                </Button>
                <Link to="/admin/kamomat" className="text-sm text-slate-600 dark:text-slate-400">
                  {t('kamomat:write_off.back')}
                </Link>
              </div>
            </>
          )}
        </Card>
      )}
    </AdminLayout>
  )
}
