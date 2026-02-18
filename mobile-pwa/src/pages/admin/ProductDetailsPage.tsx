import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  getProduct,
  getProductHistory,
  type Product,
  type ProductHistoryResponse,
} from '../../services/productsApi'

function formatDate(iso: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
  } catch {
    return iso
  }
}

export function ProductDetailsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation(['products', 'common'])
  const [product, setProduct] = useState<Product | null>(null)
  const [history, setHistory] = useState<ProductHistoryResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) {
      setError(t('products:not_found'))
      setIsLoading(false)
      setHistoryLoading(false)
      return
    }
    setIsLoading(true)
    setHistoryLoading(true)
    setError(null)
    setHistoryError(null)
    try {
      const [productData, historyData] = await Promise.all([
        getProduct(id),
        getProductHistory(id).catch((err) => {
          setHistoryError(err instanceof Error ? err.message : t('products:history_load_failed'))
          return null
        }),
      ])
      setProduct(productData)
      if (historyData) setHistory(historyData)
      else setHistory(null)
    } catch (err) {
      setError(t('products:load_failed'))
    } finally {
      setIsLoading(false)
      setHistoryLoading(false)
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

  const onHand = history?.on_hand_total ?? product?.on_hand_total
  const available = history?.available_total ?? product?.available_total

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
      <div className="space-y-6">
        <Card className="space-y-3">
          <div>
            <div className="text-sm text-slate-500">{t('products:fields.name')}</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{product.name}</div>
          </div>
          <div>
            <div className="text-sm text-slate-500">{t('products:fields.sku')}</div>
            <div className="text-base text-slate-900 dark:text-slate-100">{product.sku}</div>
          </div>
          <div>
            <div className="text-sm text-slate-500">{t('products:fields.barcode')}</div>
            <div className="text-base text-slate-900 dark:text-slate-100">
              {product.barcode ?? product.barcodes?.join(' | ') ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-500">{t('products:fields.status')}</div>
            <div className="text-base text-slate-900 dark:text-slate-100">
              {product.is_active ? t('common:status.active') : t('common:status.inactive')}
            </div>
          </div>
          {(onHand != null || available != null) && (
            <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-3 dark:border-slate-700">
              <div>
                <div className="text-sm text-slate-500">{t('products:history.on_hand')}</div>
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{onHand ?? '—'}</div>
              </div>
              <div>
                <div className="text-sm text-slate-500">{t('products:history.available')}</div>
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{available ?? '—'}</div>
              </div>
            </div>
          )}
        </Card>

        {historyError && (
          <p className="text-sm text-amber-600 dark:text-amber-400">{historyError}</p>
        )}

        {historyLoading && (
          <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700" />
        )}

        {!historyLoading && history && (
          <>
            <Card>
              <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">
                {t('products:history.receiving_history')}
              </h3>
              {history.receiving.length === 0 ? (
                <p className="text-sm text-slate-500">{t('products:history.no_receiving')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">{t('products:history.date')}</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">{t('products:history.received_by')}</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">{t('products:history.doc_no')}</th>
                        <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">{t('products:history.qty')}</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">{t('products:history.batch')}</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">{t('products:history.location')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.receiving.map((row, idx) => (
                        <tr key={idx} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{formatDate(row.date)}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.received_by ?? '—'}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.doc_no}</td>
                          <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">{row.qty}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.batch}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.location_name ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card>
              <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">
                {t('products:history.pick_history')}
              </h3>
              {history.picks.length === 0 ? (
                <p className="text-sm text-slate-500">{t('products:history.no_picks')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">{t('products:history.date')}</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">{t('products:history.picked_by')}</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">{t('products:history.order_number')}</th>
                        <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">{t('products:history.qty')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.picks.map((row, idx) => (
                        <tr key={idx} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{formatDate(row.date)}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.picked_by ?? '—'}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.order_number ?? row.document_doc_no ?? '—'}</td>
                          <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">{row.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </AdminLayout>
  )
}
