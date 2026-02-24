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
import { listDocuments } from '../../services/api/documents'
import type { DocumentListItem } from '../../services/api/types'

const PAGE_SIZE = 50

export function KamomatlarPage() {
  const { t } = useTranslation(['kamomat', 'common'])
  const [items, setItems] = useState<AuditLogRecord[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [entityId, setEntityId] = useState('')
  const [docMap, setDocMap] = useState<Record<string, string>>({})
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detailRow, setDetailRow] = useState<AuditLogRecord | null>(null)

  const loadDocuments = useCallback(async () => {
    try {
      const list = await listDocuments({ limit: 200, offset: 0 })
      setDocuments(list)
      const map: Record<string, string> = {}
      list.forEach((d) => {
        map[d.id] = d.reference_number ?? d.id
      })
      setDocMap(map)
    } catch {
      setDocMap({})
    }
  }, [])

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await listAuditLogs({
        entity_type: 'document',
        entity_id: entityId || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setItems(data.items)
      setTotal(data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('kamomat:load_error'))
    } finally {
      setIsLoading(false)
    }
  }, [entityId, dateFrom, dateTo, offset, t])

  useEffect(() => {
    void loadDocuments()
  }, [loadDocuments])

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
    } catch {
      return String(obj)
    }
  }

  const docNo = (entityId: string) => docMap[entityId] ?? entityId

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
          title={t('kamomat:empty')}
          description={t('kamomat:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    return (
      <TableScrollArea>
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('kamomat:columns.date')}</th>
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('kamomat:columns.user')}</th>
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('kamomat:columns.action')}</th>
              <th className="whitespace-nowrap px-3 py-3 text-left sm:px-4">{t('kamomat:columns.document')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                onClick={() => setDetailRow(row)}
              >
                <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-300 sm:px-4">
                  {new Date(row.created_at).toLocaleString()}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-700 dark:text-slate-200 sm:px-4">
                  {row.username ?? row.user_id ?? '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-3 sm:px-4">
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
                <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-800 dark:text-slate-200 sm:px-4">
                  {docNo(row.entity_id)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }

  return (
    <AdminLayout title={t('kamomat:title')}>
      <Card className="mb-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('kamomat:filters.document')}
            <select
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            >
              <option value="">{t('kamomat:filters.all_documents')}</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.reference_number} ({d.doc_type})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('kamomat:filters.date_from')}
            <input
              type="date"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            {t('kamomat:filters.date_to')}
            <input
              type="date"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <div className="flex items-end">
            <Button onClick={handleApply}>{t('kamomat:filters.apply')}</Button>
          </div>
        </div>
      </Card>
      <Card className="space-y-4">{content()}</Card>
      <div className="mt-4 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
        <span>{t('kamomat:total', { count: total })}</span>
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
              {detailRow.action} • {docNo(detailRow.entity_id)}
            </h3>
            <p className="mb-2 text-xs text-slate-500">
              {new Date(detailRow.created_at).toLocaleString()} • {detailRow.username ?? '—'}
              {detailRow.ip_address ? ` • ${detailRow.ip_address}` : ''}
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="mb-1 text-sm font-medium text-slate-600 dark:text-slate-400">
                  {t('kamomat:detail.old_data')}
                </h4>
                <pre className="max-h-64 overflow-auto rounded-xl bg-slate-100 p-3 font-mono text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200">
                  {formatJson(detailRow.old_data)}
                </pre>
              </div>
              <div>
                <h4 className="mb-1 text-sm font-medium text-slate-600 dark:text-slate-400">
                  {t('kamomat:detail.new_data')}
                </h4>
                <pre className="max-h-64 overflow-auto rounded-xl bg-slate-100 p-3 font-mono text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200">
                  {formatJson(detailRow.new_data)}
                </pre>
              </div>
            </div>
            <Button className="mt-4" variant="secondary" onClick={() => setDetailRow(null)}>
              {t('common:buttons.close')}
            </Button>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
