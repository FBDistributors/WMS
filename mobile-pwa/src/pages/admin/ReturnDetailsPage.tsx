import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ClipboardList } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { getCustomerReturn, type CustomerReturnOut } from '../../services/ordersApi'

export function ReturnDetailsPage() {
  const { t } = useTranslation(['admin', 'common'])
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const listQuery = (location.state as { listQuery?: string } | null)?.listQuery ?? ''
  const backUrl = `/admin/returns-history${listQuery ? `?${listQuery}` : ''}`

  const [item, setItem] = useState<CustomerReturnOut | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) {
      setLoadError(t('admin:returns_details.not_found'))
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setLoadError(null)
    try {
      const data = await getCustomerReturn(id)
      setItem(data)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('admin:returns_details.load_failed'))
      setItem(null)
    } finally {
      setIsLoading(false)
    }
  }, [id, t])

  useEffect(() => {
    void load()
  }, [load])

  const customerText = useMemo(() => {
    if (!item) return '—'
    return item.customer_name || item.customer_id || '—'
  }, [item])

  if (isLoading) {
    return (
      <AdminLayout title={t('admin:returns_details.title')}>
        <div className="relative min-h-[260px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      </AdminLayout>
    )
  }

  if (!item || loadError) {
    return (
      <AdminLayout title={t('admin:returns_details.title')}>
        <EmptyState
          title={loadError ?? t('admin:returns_details.not_found')}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      </AdminLayout>
    )
  }

  return (
    <AdminLayout
      titleSlot={
        <div className="flex items-center gap-2">
          <ClipboardList size={18} />
          <span className="text-sm font-semibold">{t('admin:returns_details.title')}</span>
        </div>
      }
    >
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => navigate(backUrl)}>
            <ArrowLeft size={16} />
            {t('common:buttons.back')}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <InfoItem label={t('admin:returns_details.fields.doc_no')} value={item.doc_no} />
          <InfoItem label={t('admin:returns_details.fields.status')} value={item.status} />
          <InfoItem label={t('admin:returns_details.fields.customer')} value={customerText} />
          <InfoItem
            label={t('admin:returns_details.fields.created_by')}
            value={item.created_by_user_name || item.created_by_user_id || '—'}
          />
          <InfoItem
            label={t('admin:returns_details.fields.approved_by')}
            value={item.approved_by_user_name || item.approved_by_user_id || '—'}
          />
          <InfoItem
            label={t('admin:returns_details.fields.assigned_picker')}
            value={item.assigned_picker_user_name || item.assigned_picker_user_id || '—'}
          />
          <InfoItem
            label={t('admin:returns_details.fields.assigned_by')}
            value={item.assigned_by_user_name || item.assigned_by_user_id || '—'}
          />
          <InfoItem
            label={t('admin:returns_details.fields.assigned_at')}
            value={formatDateTime(item.assigned_at)}
          />
          <InfoItem
            label={t('admin:returns_details.fields.created_at')}
            value={formatDateTime(item.created_at)}
          />
          <InfoItem
            label={t('admin:returns_details.fields.updated_at')}
            value={formatDateTime(item.updated_at)}
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('admin:returns_details.lines_title')}
          </div>
          {item.lines.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-800">
              {t('admin:returns_details.no_lines')}
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-[860px] w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="px-3 py-2">{t('admin:returns_details.columns.product')}</th>
                    <th className="px-3 py-2">{t('admin:returns_details.columns.location')}</th>
                    <th className="px-3 py-2">{t('admin:returns_details.columns.qty')}</th>
                    <th className="px-3 py-2">{t('admin:returns_details.columns.batch')}</th>
                    <th className="px-3 py-2">{t('admin:returns_details.columns.expiry')}</th>
                  </tr>
                </thead>
                <tbody>
                  {item.lines.map((line) => (
                    <tr key={line.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2">{line.product_name}</td>
                      <td className="px-3 py-2 font-mono">{line.location_code}</td>
                      <td className="px-3 py-2">{line.qty}</td>
                      <td className="px-3 py-2">{line.batch || '—'}</td>
                      <td className="px-3 py-2">{line.expiry_date || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </AdminLayout>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm text-slate-700 dark:text-slate-200">{value}</div>
    </div>
  )
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('uz-UZ')
}
