import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { fetchJSON, type ApiError } from '../../services/apiClient'

type SmartupImportResponse = {
  created: number
  updated: number
  skipped: number
  errors: Array<{ external_id: string; reason: string }>
}

export function IntegrationsSmartupPage() {
  const { t } = useTranslation(['admin', 'common'])
  const today = new Date().toISOString().slice(0, 10)
  const [beginDealDate, setBeginDealDate] = useState(today)
  const [endDealDate, setEndDealDate] = useState(today)
  const [filialCode, setFilialCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState<SmartupImportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      const payload = {
        begin_deal_date: beginDealDate,
        end_deal_date: endDealDate,
        filial_code: filialCode || null,
      }
      const data = await fetchJSON<SmartupImportResponse>('/api/v1/integrations/smartup/import', {
        method: 'POST',
        body: payload,
      })
      setResult(data)
    } catch (err) {
      const apiError = err as ApiError
      if (apiError?.details && typeof apiError.details === 'object' && 'detail' in apiError.details) {
        setError(String((apiError.details as { detail: string }).detail))
        return
      }
      const message = err instanceof Error ? err.message : t('admin:integrations.smartup.error')
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AdminLayout title={t('admin:integrations.smartup.title')}>
      <Card className="space-y-4">
        <div>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t('admin:integrations.smartup.title')}
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {t('admin:integrations.smartup.subtitle')}
          </div>
        </div>
        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
            {error}
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('admin:integrations.smartup.begin_deal_date')}
            <input
              type="date"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={beginDealDate}
              onChange={(event) => setBeginDealDate(event.target.value)}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('admin:integrations.smartup.end_deal_date')}
            <input
              type="date"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={endDealDate}
              onChange={(event) => setEndDealDate(event.target.value)}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('admin:integrations.smartup.filial_code')}
            <input
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={filialCode}
              onChange={(event) => setFilialCode(event.target.value)}
              placeholder={t('admin:integrations.smartup.filial_placeholder')}
            />
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => window.location.assign('/admin/integrations/smartup/orders')}>
            {t('admin:integrations.smartup.view_orders')}
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? t('admin:integrations.smartup.running') : t('admin:integrations.smartup.run')}
          </Button>
        </div>
        {result ? (
          <div className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
            <div>
              {t('admin:integrations.smartup.summary', {
                created: result.created,
                updated: result.updated,
                skipped: result.skipped,
              })}
            </div>
            {result.errors.length > 0 ? (
              <div className="max-h-40 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                {result.errors.map((entry) => (
                  <div key={`${entry.external_id}-${entry.reason}`}>
                    {t('admin:integrations.smartup.row_error', {
                      external_id: entry.external_id,
                      reason: entry.reason,
                    })}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>
    </AdminLayout>
  )
}
