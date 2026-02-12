import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Scan, Boxes, ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AppHeader } from '../../components/layout/AppHeader'
import { ScanModal } from '../../components/picker/ScanModal'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  listPickerInventory,
  listPickerLocations,
  type PickerInventoryItem,
  type PickerLocationOption,
} from '../../services/pickerInventoryApi'
import { resolveBarcode } from '../../services/scannerApi'
import { getPickerInventoryCache, setPickerInventoryCache } from '../../lib/pickerInventoryCache'
import { getExpiryColorClass } from '../../utils/expiry'
import type { ApiError } from '../../services/apiClient'

function formatExpiry(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString()
  } catch {
    return d
  }
}

function formatError(err: unknown): string {
  if (err && typeof err === 'object' && 'details' in err) {
    const d = (err as ApiError).details
    if (d && typeof d === 'object' && 'detail' in d) return String(d.detail)
  }
  return err instanceof Error ? err.message : 'Error'
}

export function PickerInventoryPage() {
  const { t } = useTranslation('picker')
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [locationId, setLocationId] = useState<string>('')
  const [locations, setLocations] = useState<PickerLocationOption[]>([])
  const [items, setItems] = useState<PickerInventoryItem[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [offlineMode, setOfflineMode] = useState(false)
  const [, setNextCursor] = useState<string | null>(null)

  const load = useCallback(async (overrides?: { q?: string; location_id?: string }) => {
    setIsLoading(true)
    setError(null)
    const qVal = overrides?.q ?? query
    const locVal = overrides?.location_id ?? locationId
    try {
      const res = await listPickerInventory({
        q: qVal || undefined,
        location_id: locVal || undefined,
        limit: 30,
      })
      setItems(res.items)
      setNextCursor(res.next_cursor)
      setPickerInventoryCache(res)
      setOfflineMode(false)
    } catch (err) {
      const cached = getPickerInventoryCache()
      if (cached?.data && typeof cached.data === 'object' && 'items' in cached.data) {
        const data = cached.data as { items: PickerInventoryItem[] }
        setItems(data.items)
        setOfflineMode(true)
        setError(null)
      } else {
        setError(formatError(err))
      }
    } finally {
      setIsLoading(false)
    }
  }, [query, locationId])

  const handleSearch = () => void load()

  const loadLocations = useCallback(async () => {
    try {
      const locs = await listPickerLocations()
      setLocations(locs)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void load()
  }, [locationId])

  useEffect(() => {
    void loadLocations()
  }, [loadLocations])

  const handleScanned = useCallback(
    async (barcode: string) => {
      setScanOpen(false)
      try {
        const res = await resolveBarcode(barcode)
        if (res.type === 'PRODUCT' && res.entity_id) {
          navigate(`/picker/inventory/${res.entity_id}`)
        } else if (res.type === 'LOCATION' && res.entity_id) {
          setLocationId(res.entity_id)
          const res2 = await listPickerInventory({ location_id: res.entity_id, limit: 30 })
          setItems(res2.items)
          setNextCursor(res2.next_cursor)
          setPickerInventoryCache(res2)
        } else if (res.type === 'UNKNOWN') {
          setError(t('scan.unknown'))
        }
      } catch {
        setQuery(barcode)
        void load()
      }
    },
    [navigate, load, t]
  )

  const toggleExpand = (productId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-6 dark:bg-slate-950">
      <AppHeader title={t('inventory.title')} onRefresh={load} />
      {offlineMode && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t('inventory.offline_warning')}
        </div>
      )}
      <div className="mb-4 flex gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-sm dark:bg-slate-800">
          <Search size={18} className="text-slate-400" />
          <input
            className="w-full bg-transparent text-sm text-slate-900 outline-none dark:text-slate-100"
            placeholder={t('inventory.search_placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>
        <Button onClick={handleSearch} variant="ghost" aria-label="Search">
          {t('common:labels.search')}
        </Button>
        <Button onClick={() => setScanOpen(true)} aria-label={t('inventory.scan')}>
          <Scan size={20} />
        </Button>
      </div>
      {locations.length > 0 && (
        <div className="mb-3">
          <select
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">{t('inventory.best_location')} — All</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.code} — {loc.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={<Boxes size={32} />}
          title={t('inventory.load_error')}
          description={error}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Boxes size={32} />}
          title={t('inventory.no_results')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.product_id} className="overflow-hidden">
              <div
                className="cursor-pointer"
                onClick={() => toggleExpand(item.product_id)}
                role="button"
                tabIndex={0}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-900 dark:text-slate-100">{item.name}</div>
                    {item.main_barcode && (
                      <div className="text-xs text-slate-500">{item.main_barcode}</div>
                    )}
                  </div>
                  {expanded.has(item.product_id) ? (
                    <ChevronUp size={18} className="text-slate-400" />
                  ) : (
                    <ChevronDown size={18} className="text-slate-400" />
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  <span>
                    {t('inventory.best_location')}: {item.best_location ?? '—'}
                  </span>
                  <span>
                    {t('inventory.available')}: {item.available_qty}
                  </span>
                  <span className={getExpiryColorClass(item.nearest_expiry)}>
                    {t('inventory.expiry')}: {formatExpiry(item.nearest_expiry)}
                  </span>
                </div>
              </div>
              {expanded.has(item.product_id) && item.top_locations.length > 0 && (
                <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                  <div className="text-xs font-medium text-slate-500">{t('inventory.more_locations')}</div>
                  <div className="mt-2 space-y-1">
                    {item.top_locations.map((lot, i) => (
                      <div
                        key={i}
                        className="flex justify-between text-sm text-slate-600 dark:text-slate-400"
                      >
                        <span>{lot.location_code} / {lot.batch_no}</span>
                        <span>{lot.available_qty} {formatExpiry(lot.expiry_date)}</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    className="mt-2"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/picker/inventory/${item.product_id}`)
                    }}
                  >
                    {t('inventory.full_details')} →
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <ScanModal open={scanOpen} onClose={() => setScanOpen(false)} onScanned={handleScanned} />
    </div>
  )
}
