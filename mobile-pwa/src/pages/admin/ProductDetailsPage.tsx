import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { AdminLayout } from '../../components/admin/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getProduct, type Product } from '../../services/productsApi'

export function ProductDetailsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [product, setProduct] = useState<Product | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) {
      setError('Mahsulot topilmadi.')
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const data = await getProduct(id)
      setProduct(data)
    } catch (err) {
      setError('Mahsulot yuklanmadi.')
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (isLoading) {
    return (
      <AdminLayout title="Product details">
        <div className="h-32 w-full animate-pulse rounded-2xl bg-slate-200" />
      </AdminLayout>
    )
  }

  if (!product || error) {
    return (
      <AdminLayout title="Product details">
        <EmptyState
          title={error ?? 'Mahsulot topilmadi'}
          actionLabel="Qayta urinib ko‘rish"
          onAction={load}
        />
      </AdminLayout>
    )
  }

  return (
    <AdminLayout
      title="Product details"
      actionSlot={
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
          Back
        </Button>
      }
    >
      <Card className="space-y-3">
        <div>
          <div className="text-sm text-slate-500">Name</div>
          <div className="text-lg font-semibold text-slate-900">{product.name}</div>
        </div>
        <div>
          <div className="text-sm text-slate-500">SKU</div>
          <div className="text-base text-slate-900">{product.sku}</div>
        </div>
        <div>
          <div className="text-sm text-slate-500">Barcode</div>
          <div className="text-base text-slate-900">{product.barcode ?? '—'}</div>
        </div>
        <div>
          <div className="text-sm text-slate-500">Status</div>
          <div className="text-base text-slate-900">{product.status}</div>
        </div>
      </Card>
    </AdminLayout>
  )
}
