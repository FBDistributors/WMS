import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Package, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AppHeader } from '../../components/layout/AppHeader'
import { getProducts, type Product } from '../../services/productsApi'

export function ControllerProductsPage() {
  const { t } = useTranslation('controller')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const locationFilter = searchParams.get('location')
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getProducts({ search: debouncedSearch || undefined, limit: 50, offset: 0 })
      .then((res) => {
        if (!cancelled) {
          setProducts(res.items)
          setTotal(res.total)
        }
      })
      .catch(() => {
        if (!cancelled) setProducts([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedSearch])

  return (
    <div className="min-h-screen w-full min-w-0 overflow-x-hidden bg-slate-50 dark:bg-slate-950">
      <AppHeader
        title={locationFilter ? `${t('products.title')} – ${locationFilter}` : t('products.title')}
        hideUserMenu
      />
      <div className="w-full max-w-xl mx-auto px-4 sm:px-6 min-w-0 pb-nav">
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
          <Search size={18} className="text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('products.search_placeholder')}
            className="flex-1 bg-transparent text-sm outline-none dark:text-slate-100"
          />
        </div>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700"
              />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-700 dark:bg-slate-800">
            <Package size={48} className="text-slate-400" />
            <p className="text-slate-600 dark:text-slate-400">{t('products.empty')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => navigate(`/controller/products/${p.id}`)}
                className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700">
                  <Package size={20} className="text-slate-600 dark:text-slate-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 dark:text-slate-100">{p.name}</div>
                  <div className="text-sm text-slate-500 dark:text-slate-400">
                    {p.sku}
                    {p.barcode ? ` · ${p.barcode}` : ''}
                  </div>
                </div>
                <span className="text-slate-400">›</span>
              </button>
            ))}
            {total > products.length && (
              <p className="py-2 text-center text-sm text-slate-500">
                {t('products.showing_count', { count: products.length, total })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
