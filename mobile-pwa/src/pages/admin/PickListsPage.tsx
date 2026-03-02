import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, RefreshCw, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { TableScrollArea } from '../../components/TableScrollArea'
import { listPickLists, cancelPickList, type PickList } from '../../services/pickingApi'
import { useAuth } from '../../rbac/AuthProvider'

export function PickListsPage() {
  const { t } = useTranslation(['picking', 'admin', 'common'])
  const navigate = useNavigate()
  const { has } = useAuth()

  const [items, setItems] = useState<PickList[]>([])
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const canCancel = has('documents:edit_status')

  const load = useCallback(async (background = false) => {
    if (!background) {
      setIsLoading(true)
      setError(null)
    } else {
      setIsRefreshing(true)
    }
    try {
      const data = await listPickLists(100, 0)
      setItems(data)
    } catch {
      if (!background) setError(t('picking:load_error'))
    } finally {
      if (!background) setIsLoading(false)
      else setIsRefreshing(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    if (!query.trim()) return items
    const term = query.toLowerCase()
    return items.filter((item) => item.document_no.toLowerCase().includes(term))
  }, [items, query])

  const handleCancel = useCallback(
    async (item: PickList) => {
      if (!confirm(t('picking:cancel_confirm', { doc: item.document_no }))) return
      setCancellingId(item.id)
      try {
        await cancelPickList(item.id)
        void load(true)
      } catch {
        setError(t('picking:cancel_error'))
      } finally {
        setCancellingId(null)
      }
    },
    [load, t]
  )

  const statusLabel = (status: string) =>
    t(`picking:status.${status.toLowerCase()}`, status)

  const content = useMemo(() => {
    if (isLoading) {
      return <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    }
    if (error) {
      return (
        <EmptyState
          title={error}
          actionLabel={t('common:buttons.retry')}
          onAction={() => load()}
        />
      )
    }
    if (filtered.length === 0) {
      return (
        <EmptyState
          title={t('picking:empty_title')}
          description={t('picking:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={load}
        />
      )
    }
    return (
      <TableScrollArea inline>
        <table className="w-max min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="px-4 py-3 text-left">{t('picking:document_label')}</th>
              <th className="px-4 py-3 text-left">{t('picking:status_label')}</th>
              <th className="px-4 py-3 text-left">{t('picking:total_lines')}</th>
              <th className="px-4 py-3"></th>
              {canCancel && <th className="px-4 py-3"></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                onClick={() => navigate(`/picking/mobile-pwa/${item.id}`)}
              >
                <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                  {item.document_no}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.status === 'DONE'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
                        : item.status === 'IN_PROGRESS'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
                          : item.status === 'ERROR'
                            ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {statusLabel(item.status)}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {item.picked_lines}/{item.total_lines}
                </td>
                <td className="px-4 py-3">
                  <Button
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation()
                      navigate(`/picking/mobile-pwa/${item.id}`)
                    }}
                  >
                    <FileText size={18} />
                  </Button>
                </td>
                {canCancel && (
                  <td className="px-4 py-3">
                    <Button
                      variant="outline"
                      className="h-8 border-red-200 px-2 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation()
                        void handleCancel(item)
                      }}
                      disabled={cancellingId === item.id}
                    >
                      <XCircle size={14} className="mr-1" />
                      {cancellingId === item.id ? t('picking:cancelling') : t('picking:cancel_document')}
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    )
  }, [canCancel, cancellingId, error, filtered, handleCancel, isLoading, load, navigate, t])

  return (
    <AdminLayout title={t('picking:list_title')}>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('picking:list_title')}
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              {isRefreshing && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                  {t('picking:refresh')}
                </span>
              )}
            </div>
          </div>
          <Button variant="secondary" onClick={() => load(true)} disabled={isRefreshing}>
            <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
            {t('common:buttons.refresh')}
          </Button>
        </div>

        <label className="block text-sm text-slate-600 dark:text-slate-300">
          {t('picking:search_placeholder')}
          <input
            className="mt-1 w-full max-w-xs rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
            placeholder={t('picking:search_placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        <div className="max-h-[calc(100vh-320px)] min-h-0 overflow-auto">{content}</div>
      </Card>
    </AdminLayout>
  )
}
