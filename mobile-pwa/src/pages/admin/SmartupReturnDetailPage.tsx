import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CheckCircle2, PackageX, Send } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { DispatchReturnDialog } from '../../admin/components/returns/DispatchReturnDialog'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import { getSmartupReturn, type SmartupReturn } from '../../services/smartupReturnsApi'

function fmt(n: number | null): string {
  if (n == null) return '—'
  return Math.round(n).toLocaleString('ru-RU')
}

export function SmartupReturnDetailPage() {
  const { t } = useTranslation(['admin', 'common'])
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { showError } = useAppToast()
  const [item, setItem] = useState<SmartupReturn | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dispatchOpen, setDispatchOpen] = useState(false)

  const load = useCallback(async () => {
    if (!id) {
      setLoadError(t('admin:smartupReturns.load_error'))
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setLoadError(null)
    try {
      setItem(await getSmartupReturn(id))
    } catch {
      setLoadError(t('admin:smartupReturns.load_error'))
      setItem(null)
      showError(t('admin:smartupReturns.load_error'))
    } finally {
      setIsLoading(false)
    }
  }, [id, showError, t])

  useEffect(() => {
    void load()
  }, [load])

  if (isLoading) {
    return (
      <AdminLayout title={t('admin:smartupReturns.detail_title')}>
        <div className="relative min-h-[260px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      </AdminLayout>
    )
  }

  if (!item || loadError) {
    return (
      <AdminLayout title={t('admin:smartupReturns.detail_title')}>
        <EmptyState
          title={loadError ?? t('admin:smartupReturns.load_error')}
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
          <PackageX size={18} />
          <span className="text-sm font-semibold">{t('admin:smartupReturns.detail_title')}</span>
        </div>
      }
    >
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => navigate('/admin/smartup-returns')}>
            <ArrowLeft size={16} />
            {t('common:buttons.back')}
          </Button>
          {item.customer_return_id ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              <CheckCircle2 size={16} />
              {t('admin:smartupReturns.dispatch.already_dispatched')}
            </span>
          ) : (
            <Button className="gap-1.5" onClick={() => setDispatchOpen(true)}>
              <Send size={16} />
              {t('admin:smartupReturns.dispatch.dispatch_btn')}
            </Button>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <InfoItem label={t('admin:smartupReturns.col_customer')} value={item.person_name ?? '—'} />
          <InfoItem label={t('admin:smartupReturns.col_date')} value={item.return_date ?? '—'} />
          <InfoItem label={t('admin:smartupReturns.col_order')} value={item.order_deal_id ?? '—'} />
          <InfoItem label={t('admin:smartupReturns.col_amount')} value={fmt(item.total_amount)} />
          <InfoItem label={t('admin:smartupReturns.col_manager')} value={item.sales_manager_name ?? '—'} />
          <InfoItem label={t('admin:smartupReturns.col_status')} value={item.status ?? '—'} />
          <InfoItem label={t('admin:smartupReturns.detail_reason')} value={item.return_reason_id ?? '—'} />
          <InfoItem label={t('admin:smartupReturns.detail_deal')} value={item.deal_id} />
        </div>

        {item.note ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
            {item.note}
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('admin:smartupReturns.detail_products', { count: item.lines_count })}
          </div>
          {item.lines.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-800">
              {t('admin:smartupReturns.empty')}
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-[860px] w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="px-3 py-2">{t('admin:smartupReturns.line_product')}</th>
                    <th className="px-3 py-2 text-right">{t('admin:smartupReturns.line_qty')}</th>
                    <th className="px-3 py-2 text-right">{t('admin:smartupReturns.line_price')}</th>
                    <th className="px-3 py-2">{t('admin:smartupReturns.line_expiry')}</th>
                    <th className="px-3 py-2">{t('admin:smartupReturns.line_warehouse')}</th>
                    <th className="px-3 py-2">{t('admin:smartupReturns.line_action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {item.lines.map((line, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2">{line.product_name ?? line.product_code ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{line.return_quant ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(line.product_price)}</td>
                      <td className="px-3 py-2">{line.expiry_date ?? '—'}</td>
                      <td className="px-3 py-2">{line.warehouse_code ?? '—'}</td>
                      <td className="px-3 py-2">{line.action_name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <DispatchReturnDialog
        open={dispatchOpen}
        returnId={item.id}
        onOpenChange={setDispatchOpen}
        onDispatched={() => {
          setDispatchOpen(false)
          void load()
        }}
      />
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
