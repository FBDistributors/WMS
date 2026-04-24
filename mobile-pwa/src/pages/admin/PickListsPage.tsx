import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FileText, RefreshCw, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { OrdersHubTabs } from '../../admin/components/orders/OrdersHubTabs'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { TableScrollArea } from '../../components/TableScrollArea'
import { listPickLists, cancelPickList, type PickList, type PickListStatus } from '../../services/pickingApi'
import { useAuth } from '../../rbac/AuthProvider'

const PAGE_SIZE = 200

function statusBadgeClass(status: PickListStatus): string {
  switch (status) {
    case 'DONE':
      return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
    case 'IN_PROGRESS':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
    case 'REVIEW':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
    case 'ERROR':
      return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
    case 'UNKNOWN':
    case 'NEW':
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

function formatActivity(iso: string | undefined, locale: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export function PickListsPage() {
  const { t, i18n } = useTranslation(['picking', 'common'])
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const archive = pathname.endsWith('/picking/archive')
  const { has } = useAuth()

  const processScope = archive ? ('archived' as const) : ('active' as const)

  const [items, setItems] = useState<PickList[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  /** Keyingi sahifa uchun offset (yuklangan qatorlar soni) */
  const nextOffsetRef = useRef(0)

  const canCancel = has('documents:edit_status')

  const load = useCallback(
    async (opts: { background?: boolean; append?: boolean } = {}) => {
      const { background = false, append = false } = opts
      if (!background && !append) {
        setIsLoading(true)
        setError(null)
      } else if (background && !append) {
        setIsRefreshing(true)
      } else if (append) {
        setLoadingMore(true)
      }
      try {
        const offset = append ? nextOffsetRef.current : 0
        const data = await listPickLists(PAGE_SIZE, offset, { processScope })
        if (append) {
          setItems((prev) => [...prev, ...data])
          nextOffsetRef.current += data.length
        } else {
          setItems(data)
          nextOffsetRef.current = data.length
        }
        setHasMore(data.length === PAGE_SIZE)
      } catch {
        if (!append) {
          if (!background) setError(t('picking:load_error'))
        }
      } finally {
        if (!background && !append) {
          setIsLoading(false)
        } else if (background && !append) {
          setIsRefreshing(false)
        } else if (append) {
          setLoadingMore(false)
        }
      }
    },
    [processScope, t]
  )

  useEffect(() => {
    nextOffsetRef.current = 0
    void load()
  }, [load, archive])

  const filtered = useMemo(() => {
    if (!query.trim()) return items
    const term = query.toLowerCase()
    return items.filter((item) => {
      const parts = [
        item.document_no,
        item.order_number ?? '',
        item.delivery_number ?? '',
        item.picker_name ?? '',
        item.controller_name ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return parts.includes(term)
    })
  }, [items, query])

  const viewItems = useMemo(() => {
    if (archive) {
      return filtered.filter((item) => item.status === 'DONE')
    }
    return filtered.filter((item) => item.status !== 'DONE')
  }, [archive, filtered])

  const docStatusLabel = useCallback(
    (raw: string) => {
      const k = raw.toLowerCase().replace(/-/g, '_')
      return t(`picking:doc_status.${k}`, { defaultValue: raw })
    },
    [t]
  )

  const handleCancel = useCallback(
    async (item: PickList) => {
      if (!confirm(t('picking:cancel_confirm', { doc: item.document_no }))) return
      setCancellingId(item.id)
      try {
        await cancelPickList(item.id)
        nextOffsetRef.current = 0
        void load({ background: true })
      } catch {
        setError(t('picking:cancel_error'))
      } finally {
        setCancellingId(null)
      }
    },
    [load, t]
  )

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="relative flex-1 min-h-[200px]">
          <LoadingOverlay label={t('common:messages.loading')} />
        </div>
      )
    }
    if (error) {
      return (
        <EmptyState
          title={error}
          actionLabel={t('common:buttons.retry')}
          onAction={() => {
            nextOffsetRef.current = 0
            void load()
          }}
        />
      )
    }
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('picking:empty_title')}
          description={t('picking:empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={() => {
            nextOffsetRef.current = 0
            void load()
          }}
        />
      )
    }
    if (filtered.length === 0) {
      return (
        <EmptyState
          title={t('picking:search_empty_title')}
          description={t('picking:search_empty_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={() => {
            nextOffsetRef.current = 0
            void load()
          }}
        />
      )
    }
    if (viewItems.length === 0) {
      return (
        <EmptyState
          title={archive ? t('picking:empty_archive_title') : t('picking:empty_jarayon_title')}
          description={archive ? t('picking:empty_archive_desc') : t('picking:empty_jarayon_desc')}
          actionLabel={t('common:buttons.refresh')}
          onAction={() => {
            nextOffsetRef.current = 0
            void load()
          }}
        />
      )
    }
    return (
      <TableScrollArea inline>
        <table className="w-max min-w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="px-4 py-3 text-left">{t('picking:document_label')}</th>
              <th className="px-4 py-3 text-left">{t('picking:column_delivery_number')}</th>
              <th className="px-4 py-3 text-left">{t('picking:status_label')}</th>
              <th className="px-4 py-3 text-left">{t('picking:total_lines')}</th>
              <th className="px-4 py-3 text-left">{t('picking:column_picker')}</th>
              <th className="px-4 py-3 text-left">{t('picking:column_controller')}</th>
              <th className="px-4 py-3 text-left">{t('picking:last_activity')}</th>
              <th className="px-4 py-3"></th>
              {canCancel && <th className="px-4 py-3"></th>}
            </tr>
          </thead>
          <tbody>
            {viewItems.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                onClick={() => navigate(`/picking/mobile-pwa/${item.id}`)}
              >
                <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                  {item.order_number
                    ? t('picking:order_number_display', { number: item.order_number })
                    : item.document_no}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">
                  {item.delivery_number ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(item.status)}`}
                  >
                    {docStatusLabel(item.document_status)}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {item.picked_lines}/{item.total_lines}
                </td>
                <td className="max-w-[140px] truncate px-4 py-3 text-slate-600 dark:text-slate-300" title={item.picker_name ?? ''}>
                  {item.picker_name ?? '—'}
                </td>
                <td className="max-w-[140px] truncate px-4 py-3 text-slate-600 dark:text-slate-300" title={item.controller_name ?? ''}>
                  {item.controller_name ?? '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">
                  {formatActivity(item.updated_at, i18n.language)}
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
  }, [
    archive,
    canCancel,
    cancellingId,
    docStatusLabel,
    error,
    filtered,
    handleCancel,
    i18n.language,
    isLoading,
    items.length,
    load,
    navigate,
    t,
    viewItems,
  ])

  return (
    <AdminLayout titleSlot={<OrdersHubTabs />}>
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
          <Button
            variant="secondary"
            onClick={() => {
              nextOffsetRef.current = 0
              void load({ background: true })
            }}
            disabled={isRefreshing}
          >
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

        {hasMore && !isLoading && items.length > 0 && (
          <div className="flex justify-center pb-2">
            <Button variant="secondary" onClick={() => void load({ append: true })} disabled={loadingMore}>
              {loadingMore ? t('common:messages.loading') : t('picking:load_more')}
            </Button>
          </div>
        )}
      </Card>
    </AdminLayout>
  )
}
