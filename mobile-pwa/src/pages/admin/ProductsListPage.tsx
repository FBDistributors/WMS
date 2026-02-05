import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Boxes } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/EmptyState'
import { getProducts, type Product } from '../../services/productsApi'

const statusVariant: Record<Product['status'], 'success' | 'neutral'> = {
  active: 'success',
  inactive: 'neutral',
}

export function ProductsListPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<Product[]>([])
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getProducts({ q: query })
      setItems(data)
    } catch (err) {
      setError('Mahsulotlar yuklanmadi. Qayta urinib ko‘ring.')
    } finally {
      setIsLoading(false)
    }
  }, [query])

  useEffect(() => {
    void load()
  }, [load])

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
          actionLabel="Qayta urinib ko‘rish"
          onAction={load}
        />
      )
    }

    if (items.length === 0) {
      return (
        <EmptyState
          icon={<Boxes size={32} />}
          title="Mahsulotlar topilmadi"
          description="Hozircha mahsulotlar yo‘q."
          actionLabel="Yangilash"
          onAction={load}
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
                SKU: {item.sku} · {item.barcode ?? 'Barcode —'}
              </div>
            </div>
            <Badge variant={statusVariant[item.status]}>
              {item.status === 'active' ? 'ACTIVE' : 'INACTIVE'}
            </Badge>
          </Card>
        ))}
      </div>
    )
  }, [error, isLoading, items, load, navigate])

  return (
    <AdminLayout
      title="Products"
      actionSlot={
        <Button variant="secondary" onClick={load}>
          Yangilash
        </Button>
      }
    >
      <div className="mb-4 flex items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-sm">
        <Search size={18} className="text-slate-400" />
        <input
          className="w-full bg-transparent text-sm text-slate-900 outline-none"
          placeholder="Mahsulot nomi, SKU yoki barcode"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {content}
    </AdminLayout>
  )
}
