import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { getProduct, type Product } from '../../services/productsApi'

export function ProductDetailsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation(['products', 'common'])
  const [product, setProduct] = useState<Product | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) {
      setError(t('products:not_found'))
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const data = await getProduct(id)
      setProduct(data)
    } catch (err) {
      setError(t('products:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [id, t])

  useEffect(() => {
    void load()
  }, [load])

  if (isLoading) {
    return (
      <AdminLayout title={t('products:details_title')}>
        <div className="h-32 w-full animate-pulse rounded-2xl bg-slate-200" />
      </AdminLayout>
    )
  }

  if (!product || error) {
    return (
      <AdminLayout title={t('products:details_title')}>
        <EmptyState
          title={error ?? t('products:not_found')}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      </AdminLayout>
    )
  }

  return (
    <AdminLayout
      title={t('products:details_title')}
      actionSlot={
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
          {t('common:buttons.back')}
        </Button>
      }
    >
      <Card className="space-y-3">
        <div>
          <div className="text-sm text-slate-500">{t('products:fields.name')}</div>
          <div className="text-lg font-semibold text-slate-900">{product.name}</div>
        </div>
        <div>
          <div className="text-sm text-slate-500">{t('products:fields.sku')}</div>
          <div className="text-base text-slate-900">{product.sku}</div>
        </div>
        <div>
          <div className="text-sm text-slate-500">{t('products:fields.barcode')}</div>
          <div className="text-base text-slate-900">
            {product.barcode ?? product.barcodes?.join(' | ') ?? '—'}
          </div>
        </div>
        <div>
          <div className="text-sm text-slate-500">{t('products:fields.status')}</div>
          <div className="text-base text-slate-900">
            {product.is_active ? t('common:status.active') : t('common:status.inactive')}
          </div>
        </div>
      </Card>
    </AdminLayout>
  )
}
