import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import { getSmartupReturn, type SmartupReturn } from '../../services/smartupReturnsApi'

function fmt(n: number | null): string {
  if (n == null) return '—'
  return Math.round(n).toLocaleString('ru-RU')
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 px-3.5 py-2.5 dark:border-slate-800">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  )
}

export function SmartupReturnDetailPage() {
  const { t } = useTranslation(['admin', 'common'])
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { showError } = useAppToast()
  const [item, setItem] = useState<SmartupReturn | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      setItem(await getSmartupReturn(id))
    } catch {
      showError(t('admin:smartupReturns.load_error'))
    } finally {
      setLoading(false)
    }
  }, [id, showError, t])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <AdminLayout>
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            className="gap-2"
            onClick={() => navigate('/admin/smartup-returns')}
          >
            <ArrowLeft className="h-4 w-4" />
            {t('common:actions.back', 'Orqaga')}
          </Button>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">
            {t('admin:smartupReturns.detail_title')}
          </h1>
        </div>

        <div className="relative min-h-[120px]">
          {loading ? <LoadingOverlay label="" /> : null}
          {item ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={t('admin:smartupReturns.col_customer')} value={item.person_name ?? '—'} />
                <Field label={t('admin:smartupReturns.col_date')} value={item.return_date ?? '—'} />
                <Field label={t('admin:smartupReturns.col_order')} value={item.order_deal_id ?? '—'} />
                <Field label={t('admin:smartupReturns.col_amount')} value={fmt(item.total_amount)} />
                <Field label={t('admin:smartupReturns.col_manager')} value={item.sales_manager_name ?? '—'} />
                <Field label={t('admin:smartupReturns.col_status')} value={item.status ?? '—'} />
                <Field label={t('admin:smartupReturns.detail_reason')} value={item.return_reason_id ?? '—'} />
                <Field label={t('admin:smartupReturns.detail_deal')} value={item.deal_id} />
              </div>

              {item.note ? (
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                  {item.note}
                </div>
              ) : null}

              <div>
                <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {t('admin:smartupReturns.detail_products', { count: item.lines_count })}
                </h2>
                <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        <th className="px-3 py-2.5">{t('admin:smartupReturns.line_product')}</th>
                        <th className="px-3 py-2.5 text-right">{t('admin:smartupReturns.line_qty')}</th>
                        <th className="px-3 py-2.5 text-right">{t('admin:smartupReturns.line_price')}</th>
                        <th className="px-3 py-2.5">{t('admin:smartupReturns.line_expiry')}</th>
                        <th className="px-3 py-2.5">{t('admin:smartupReturns.line_warehouse')}</th>
                        <th className="px-3 py-2.5">{t('admin:smartupReturns.line_action')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.lines.map((l, i) => (
                        <tr
                          key={i}
                          className="border-b border-slate-50 text-slate-700 last:border-0 dark:border-slate-800/60 dark:text-slate-200"
                        >
                          <td className="px-3 py-2.5 font-medium">{l.product_name ?? l.product_code ?? '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{l.return_quant ?? '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{fmt(l.product_price)}</td>
                          <td className="px-3 py-2.5">{l.expiry_date ?? '—'}</td>
                          <td className="px-3 py-2.5">{l.warehouse_code ?? '—'}</td>
                          <td className="px-3 py-2.5">{l.action_name ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </AdminLayout>
  )
}
