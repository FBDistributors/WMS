import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { listAuditLogs } from '../../services/auditApi'
import type { AuditLogRecord } from '../../services/auditApi'

const PAGE_SIZE = 50
const ENTITY_TYPES = ['product', 'location', 'user', 'brand', 'order', 'document', 'stock_movement']

export function AuditLogsPage() {
  const { t } = useTranslation(['audit', 'common'])
  const [items, setItems] = useState<AuditLogRecord[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [entityType, setEntityType] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detailRow, setDetailRow] = useState<AuditLogRecord | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await listAuditLogs({
        entity_type: entityType || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setItems(data.items)
      setTotal(data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('audit:load_error'))
    } finally {
      setIsLoading(false)
    }
  }, [entityType, dateFrom, dateTo, offset, t])

  useEffect(() => {
    void load()
  }, [load])

  const handleApply = () => {
    setOffset(0)
    void load()
  }

  const formatJson = (obj: Record<string, unknown> | null) => {
    if (!obj || Object.keys(obj).length === 0) return '—'
    try {
      return JSON.stringify(obj, null, 2)
    }
    catch {
      return String(obj)
    }
  }

  const content = () => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return <EmptyState title={error} actionLabel={t('common:buttons.retry')} onAction={load} />
    }
    if (items.length === 0) {
      return (
        <EmptyState
          icon={<FileText size={32} />}
          title={t('audit:empty')}
          description={t('audit:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    return (
      <TableScrollArea>
        <table className="min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="px-4 py-3 text-left">{t('audit:columns.timestamp')}</th>
              <th className="px-4 py-3 text-left">{t('audit:columns.user')}</th>
              <th className="px-4 py-3 text-left">{t('audit:columns.action')}</th>
              <th className="px-4 py-3 text-left">{t('audit:columns.entity_type')}</th>
              <th className="px-4 py-3 text-left">{t('audit:columns.entity_id')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                onClick={() => setDetailRow(row)}
              >
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {new Date(row.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {row.username ?? row.user_id ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      row.action === 'CREATE'
                        ? 'rounded bg-green-100 px-1.5 py-0.5 text-green-800 dark:bg-green-900/50 dark:text-green-200'
                        : row.action === 'DELETE'
                          ? 'rounded bg-red-100 px-1.5 py-0.5 text-red-800 dark:bg-red-900/50 dark:text-red-200'
                          : 'rounded bg-blue-100 px-1.5 py-0.5 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200'
                    }
                  >
                    {row.action}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.entity_type}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.entity_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }

  return (
    <AdminLayout title={t('audit:title')}>
      <Card className="mb-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('audit:filters.entity_type')}
            <select
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
            >
              <option value="">{t('audit:filters.all')}</option>
              {ENTITY_TYPES.map((et) => (
                <option key={et} value={et}>
                  {et}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('audit:filters.date_from')}
            <input
              type="date"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('audit:filters.date_to')}
            <input
              type="date"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <div className="flex items-end">
            <Button onClick={handleApply}>{t('audit:filters.apply')}</Button>
          </div>
        </div>
      </Card>
      <Card className="space-y-4">{content()}</Card>
      <div className="mt-4 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
        <span>
          {t('audit:total', { count: total })}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset((p) => Math.max(0, p - PAGE_SIZE))}
          >
            {t('common:buttons.back')}
          </Button>
          <Button
            variant="secondary"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((p) => p + PAGE_SIZE)}
          >
            {t('common:buttons.next')}
          </Button>
        </div>
      </div>

      {/* Detail modal */}
      {detailRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            onClick={() => setDetailRow(null)}
            aria-label={t('common:buttons.close')}
          />
          <div className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {detailRow.action} {detailRow.entity_type} • {detailRow.entity_id}
            </h3>
            <p className="mb-2 text-xs text-slate-500">
              {new Date(detailRow.created_at).toLocaleString()} • {detailRow.username ?? '—'}
              {detailRow.ip_address ? ` • ${detailRow.ip_address}` : ''}
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="mb-1 text-sm font-medium text-slate-600 dark:text-slate-400">
                  {t('audit:old_data')}
                </h4>
                <pre className="max-h-64 overflow-auto rounded-xl bg-slate-100 p-3 font-mono text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200">
                  {formatJson(detailRow.old_data)}
                </pre>
              </div>
              <div>
                <h4 className="mb-1 text-sm font-medium text-slate-600 dark:text-slate-400">
                  {t('audit:new_data')}
                </h4>
                <pre className="max-h-64 overflow-auto rounded-xl bg-slate-100 p-3 font-mono text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200">
                  {formatJson(detailRow.new_data)}
                </pre>
              </div>
            </div>
            <Button
              className="mt-4"
              variant="secondary"
              onClick={() => setDetailRow(null)}
            >
              {t('common:buttons.close')}
            </Button>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
