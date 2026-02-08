import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Boxes } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/EmptyState'
import { getProducts, type Product } from '../../services/productsApi'

const statusVariant = (isActive: boolean) => (isActive ? 'success' : 'neutral')

export function ProductsListPage() {
  const navigate = useNavigate()
  const { t } = useTranslation(['products', 'common'])
  const [items, setItems] = useState<Product[]>([])
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (search: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getProducts({ q: search })
      setItems(data.items)
    } catch (err) {
      setError(t('products:load_error'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

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

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="space-y-3">
          <div className="h-16 w-full animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-16 w-full animate-pulse rounded-2xl bg-slate-200" />
        </div>
      )
    }

    if (error) {
      return (
        <EmptyState
          icon={<Boxes size={32} />}
          title={error}
          actionLabel={t('common:buttons.retry')}
          onAction={handleRetry}
        />
      )
    }

    if (items.length === 0) {
      return (
        <EmptyState
          icon={<Boxes size={32} />}
          title={t('products:empty_title')}
          description={t('products:empty_desc')}
          actionLabel={t('products:refresh')}
          onAction={handleRetry}
        />
      )
    }

    return (
      <div className="space-y-3">
        {items.map((item) => (
          <Card
            key={item.id}
            className="flex items-center justify-between gap-3 hover:border-blue-200"
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/admin/products/${item.id}`)}
          >
            <div>
              <div className="text-base font-semibold text-slate-900">{item.name}</div>
              <div className="text-xs text-slate-500">
                SKU: {item.sku} · {item.barcode ?? `${t('products:fields.barcode')} —`}
              </div>
            </div>
            <Badge variant={statusVariant(item.is_active)}>
              {item.is_active ? t('common:status.active') : t('common:status.inactive')}
            </Badge>
          </Card>
        ))}
      </div>
    )
  }, [error, isLoading, items, load, navigate, t])

  return (
    <AdminLayout
      title={t('products:title')}
      actionSlot={
        <Button variant="secondary" onClick={handleRetry}>
          {t('products:refresh')}
        </Button>
      }
    >
      <div className="mb-4 flex items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-sm">
        <Search size={18} className="text-slate-400" />
        <input
          className="w-full bg-transparent text-sm text-slate-900 outline-none"
          placeholder={t('products:search_placeholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {content}
    </AdminLayout>
  )
}
