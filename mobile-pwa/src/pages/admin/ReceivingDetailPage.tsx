import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { TableScrollArea } from '../../components/TableScrollArea'
import { getReceipt, type Receipt } from '../../services/receivingApi'
import { getProducts, type Product } from '../../services/productsApi'
import { getLocations, type Location } from '../../services/locationsApi'
import { getInventorySummary } from '../../services/inventoryApi'

function formatReceiptDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function ReceivingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation(['receiving', 'common'])
  const listQuery = (location.state as { listQuery?: string } | null)?.listQuery ?? ''
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [inventoryMap, setInventoryMap] = useState<Map<string, number>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) {
      setLoadError(t('receiving:not_found'))
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setLoadError(null)
    try {
      const [receiptData, locationsData] = await Promise.all([
        getReceipt(id),
        getLocations(false),
      ])
      setReceipt(receiptData)
      setLocations(locationsData)

      const productIds = [
        ...new Set(
          receiptData.lines.map((l) => l.product_id).filter(Boolean)
        ),
      ]
      if (productIds.length > 0) {
        const [productsRes, inventoryRows] = await Promise.all([
          getProducts({ product_ids: productIds, limit: productIds.length }),
          getInventorySummary({ product_ids: productIds }),
        ])
        setProducts(productsRes.items)
        const map = new Map<string, number>()
        inventoryRows.forEach((row) => {
          map.set(row.product_id, Math.round(Number(row.on_hand_total)))
        })
        setInventoryMap(map)
      } else {
        setProducts([])
        setInventoryMap(new Map())
      }
    } catch {
      setLoadError(t('receiving:load_failed'))
    } finally {
      setIsLoading(false)
    }
  }, [id, t])

  useEffect(() => {
    void load()
  }, [load])

  const productLookup = useMemo(() => {
    return new Map(products.map((p) => [p.id, p]))
  }, [products])

  const locationLookup = useMemo(() => {
    return new Map(locations.map((loc) => [loc.id, loc]))
  }, [locations])

  if (isLoading) {
    return (
      <AdminLayout title={t('receiving:title')}>
        <div className="h-32 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      </AdminLayout>
    )
  }

  if (!receipt || loadError) {
    return (
      <AdminLayout title={t('receiving:title')}>
        <EmptyState
          title={loadError ?? t('receiving:not_found')}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      </AdminLayout>
    )
  }

  return (
    <AdminLayout
      title={t('receiving:detail_title')}
      backTo={`/admin/receiving${listQuery ? `?${listQuery}` : ''}`}
    >
      <Card className="space-y-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2 md:grid-cols-4">
          <div>
            <span className="text-slate-500 dark:text-slate-400">
              {t('receiving:col_doc_no')}
            </span>
            <p className="font-medium text-slate-900 dark:text-slate-100">
              {receipt.doc_no}
            </p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">
              {t('receiving:status')}
            </span>
            <p className="font-medium text-slate-900 dark:text-slate-100">
              {t(`receiving:statuses.${receipt.status}`)}
            </p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">
              {t('receiving:received_by')}
            </span>
            <p className="font-medium text-slate-900 dark:text-slate-100">
              {receipt.created_by_username ?? '—'}
            </p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">
              {t('receiving:received_at')}
            </span>
            <p className="font-medium text-slate-900 dark:text-slate-100">
              {receipt.created_at
                ? formatReceiptDate(receipt.created_at)
                : '—'}
            </p>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            {t('receiving:detail_lines')}
          </h3>
          <TableScrollArea>
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {t('receiving:detail_col_code')}
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {t('receiving:detail_col_barcode')}
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {t('receiving:detail_col_product')}
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {t('receiving:fields.qty')}
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {t('receiving:detail_col_qoldiq')}
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {t('receiving:fields.batch')}
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {t('receiving:fields.expiry_date')}
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {t('receiving:fields.location')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {receipt.lines.map((line) => {
                  const product = productLookup.get(line.product_id)
                  const location = locationLookup.get(line.location_id)
                  const barcode =
                    product?.barcode ||
                    (product?.barcodes && product.barcodes[0]) ||
                    '—'
                  const qoldiq = inventoryMap.get(line.product_id) ?? '—'
                  return (
                    <tr
                      key={line.id}
                      className="border-b border-slate-100 dark:border-slate-800"
                    >
                      <td className="py-2.5 px-2 font-medium text-slate-900 dark:text-slate-100">
                        {product?.sku ?? line.product_id}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300 font-mono text-xs">
                        {barcode}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300">
                        {product?.name ?? '—'}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300">
                        {Math.round(Number(line.qty))}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300">
                        {typeof qoldiq === 'number' ? qoldiq : qoldiq}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300">
                        {line.batch || '—'}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {line.expiry_date ?? '—'}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300">
                        {location?.code ?? line.location_id}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableScrollArea>
        </div>

        <div className="flex justify-start pt-2">
          <Button
            variant="secondary"
            onClick={() => navigate(`/admin/receiving${listQuery ? `?${listQuery}` : ''}`)}
            className="gap-2"
          >
            <ArrowLeft size={18} />
            {t('receiving:back_to_list')}
          </Button>
        </div>
      </Card>
    </AdminLayout>
  )
}
