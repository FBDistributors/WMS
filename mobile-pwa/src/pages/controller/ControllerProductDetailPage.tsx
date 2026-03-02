import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AppHeader } from '../../components/layout/AppHeader'
import { getProduct, type Product } from '../../services/productsApi'

export function ControllerProductDetailPage() {
  const { productId } = useParams<{ productId: string }>()
  const { t } = useTranslation('controller')
  const navigate = useNavigate()
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!productId) return
    let cancelled = false
    getProduct(productId)
      .then((p) => {
        if (!cancelled) setProduct(p)
      })
      .catch(() => {
        if (!cancelled) setProduct(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [productId])

  if (!productId) {
    navigate('/controller/products')
    return null
  }

  return (
    <div className="min-h-screen w-full min-w-0 overflow-x-hidden bg-slate-50 dark:bg-slate-950">
      <AppHeader
        title={product?.name ?? t('products.detail')}
        onBack={() => navigate('/controller/products')}
        hideUserMenu
      />
      <div className="w-full max-w-xl mx-auto px-4 sm:px-6 min-w-0 pb-8">
        {loading ? (
          <div className="h-40 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700" />
        ) : !product ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
            <p className="text-red-800 dark:text-red-200">{t('products.load_error')}</p>
            <button
              type="button"
              onClick={() => navigate('/controller/products')}
              className="mt-3 flex items-center gap-2 text-sm text-red-700 dark:text-red-300"
            >
              <ArrowLeft size={16} />
              {t('home.back_to_scan')}
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {product.name}
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="text-slate-500 dark:text-slate-400">SKU</dt>
                <dd className="font-medium text-slate-900 dark:text-slate-100">{product.sku}</dd>
              </div>
              {product.barcode && (
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">{t('products.barcode')}</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">
                    {product.barcode}
                  </dd>
                </div>
              )}
              {product.brand_name && (
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">{t('products.brand')}</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">
                    {product.brand_name}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>
    </div>
  )
}
