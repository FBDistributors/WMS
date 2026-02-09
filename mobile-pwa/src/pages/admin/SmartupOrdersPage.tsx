import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { fetchJSON } from '../../services/apiClient'

type SmartupDocument = {
  id: string
  reference_number: string
  status: string
  lines_total: number
  lines_done: number
  source_external_id?: string | null
  created_at: string
}

const PAGE_SIZE = 50

export function SmartupOrdersPage() {
  const { t } = useTranslation(['admin', 'common'])
  const [items, setItems] = useState<SmartupDocument[]>([])
  const [status, setStatus] = useState('all')
  const [offset, setOffset] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchJSON<SmartupDocument[]>('/api/v1/documents', {
        query: {
          source: 'smartup',
          status: status === 'all' ? undefined : status,
          limit: PAGE_SIZE,
          offset,
        },
      })
      setItems(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('admin:integrations.smartup_orders.error')
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [offset, status, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setOffset(0)
  }, [status])

  const content = useMemo(() => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return (
        <EmptyState
          title={error}
          actionLabel={t('common:buttons.retry')}
          onAction={load}
        />
      )
    }
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('admin:integrations.smartup_orders.empty')}
          description={t('admin:integrations.smartup_orders.empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="px-4 py-3 text-left">{t('admin:integrations.smartup_orders.columns.doc_no')}</th>
              <th className="px-4 py-3 text-left">{t('admin:integrations.smartup_orders.columns.external_id')}</th>
              <th className="px-4 py-3 text-left">{t('admin:integrations.smartup_orders.columns.status')}</th>
              <th className="px-4 py-3 text-left">{t('admin:integrations.smartup_orders.columns.lines')}</th>
              <th className="px-4 py-3 text-left">{t('admin:integrations.smartup_orders.columns.created')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                  {item.reference_number}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {item.source_external_id ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{item.status}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {item.lines_done}/{item.lines_total}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {new Date(item.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }, [error, isLoading, items, load, t])

  return (
    <AdminLayout title={t('admin:integrations.smartup_orders.title')}>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('admin:integrations.smartup_orders.title')}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {t('admin:integrations.smartup_orders.subtitle')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">{t('admin:integrations.smartup_orders.status.all')}</option>
              <option value="smartup_created">{t('admin:integrations.smartup_orders.status.smartup_created')}</option>
              <option value="confirmed">{t('admin:integrations.smartup_orders.status.confirmed')}</option>
              <option value="in_progress">{t('admin:integrations.smartup_orders.status.in_progress')}</option>
              <option value="completed">{t('admin:integrations.smartup_orders.status.completed')}</option>
            </select>
            <Button variant="secondary" onClick={load}>
              {t('common:buttons.refresh')}
            </Button>
          </div>
        </div>
        {content}
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset((prev) => Math.max(prev - PAGE_SIZE, 0))}
          >
            {t('common:buttons.back')}
          </Button>
          <Button
            variant="secondary"
            disabled={items.length < PAGE_SIZE}
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
          >
            {t('common:buttons.next')}
          </Button>
        </div>
      </Card>
    </AdminLayout>
  )
}
