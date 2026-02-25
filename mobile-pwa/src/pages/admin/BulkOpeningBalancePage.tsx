import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, X } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { bulkOpeningBalance } from '../../services/inventoryApi'
import { getLocations, type Location } from '../../services/locationsApi'

export function BulkOpeningBalancePage() {
  const { t } = useTranslation(['kamomat', 'common'])
  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState('')
  const [locationSearch, setLocationSearch] = useState('')
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false)
  const [qty, setQty] = useState('100')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null)

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

  const handleSubmit = useCallback(async () => {
    const locId = locationId.trim()
    const numQty = Math.floor(Number(qty) || 0)
    if (!locId || numQty < 1) {
      setError(t('kamomat:opening_balance.validation'))
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await bulkOpeningBalance({
        location_id: locId,
        qty: numQty,
      })
      setResult({
        created: res.created_count,
        skipped: res.skipped_count,
        errors: res.errors ?? [],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('kamomat:load_error'))
    } finally {
      setLoading(false)
    }
  }, [locationId, qty, t])

  return (
    <AdminLayout title={t('kamomat:opening_balance.title')}>
      <div className="mb-4">
        <Link
          to="/admin/kamomat"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
        >
          <ArrowLeft size={16} />
          {t('kamomat:write_off.back')}
        </Link>
      </div>

      <Card className="mb-4 max-w-xl space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t('kamomat:opening_balance.description')}
        </p>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('kamomat:write_off.select_location')}
        </label>
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
        </div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('kamomat:opening_balance.qty_per_product')}
        </label>
        <input
          type="number"
          min={1}
          max={999999}
          className="w-32 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={handleSubmit}
            disabled={!locationId || loading || Math.floor(Number(qty) || 0) < 1}
          >
            {loading ? t('common:messages.loading') : t('kamomat:opening_balance.submit')}
          </Button>
          <Link to="/admin/kamomat" className="text-sm text-slate-600 dark:text-slate-400">
            {t('kamomat:write_off.back')}
          </Link>
        </div>
      </Card>

      {error && (
        <div className="mb-4 max-w-xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
          {error}
        </div>
      )}
      {result && (
        <Card className="max-w-xl space-y-2">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {t('kamomat:opening_balance.result_title')}
          </h3>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {t('kamomat:opening_balance.created_count', { count: result.created })}
          </p>
          {result.skipped > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {t('kamomat:opening_balance.skipped_count', { count: result.skipped })}
            </p>
          )}
          {result.errors.length > 0 && (
            <ul className="max-h-40 overflow-y-auto rounded-lg bg-slate-100 p-2 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {result.errors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </AdminLayout>
  )
}
