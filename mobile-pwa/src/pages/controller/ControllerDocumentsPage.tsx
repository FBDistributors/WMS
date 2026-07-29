import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AppHeader } from '../../components/layout/AppHeader'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import { listPickLists, type PickList, isTerminalPickListStatus } from '../../services/pickingApi'

export function ControllerDocumentsPage() {
  const { t, i18n } = useTranslation(['controller', 'common', 'picking'])
  const navigate = useNavigate()
  const [docs, setDocs] = useState<PickList[]>([])
  const [loading, setLoading] = useState(true)
  const { showError } = useAppToast()
  const [hasLoadError, setHasLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    listPickLists(50, 0)
      .then((data) => {
        if (!cancelled) setDocs(data)
      })
      .catch(() => {
        if (!cancelled) {
          showError(t('documents.load_error'))
          setHasLoadError(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [showError, t])

  const statusBadge = (status: PickList['status']) => {
    const map: Record<PickList['status'], string> = {
      NEW: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
      IN_PROGRESS: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
      REVIEW: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
      DONE: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
      ERROR: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
      RETURNING: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
      UNKNOWN: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    }
    return map[status] ?? map.UNKNOWN
  }

  return (
    <div className="min-h-screen w-full min-w-0 overflow-x-hidden bg-slate-50 dark:bg-slate-950">
      <AppHeader title={t('documents.title')} onRefresh={() => window.location.reload()} hideUserMenu />
      <div className="w-full max-w-xl mx-auto px-4 sm:px-6 min-w-0 pb-nav">
        {loading ? (
          <div className="relative min-h-[200px]">
            <LoadingOverlay label={t('common:messages.loading')} />
          </div>
        ) : hasLoadError ? (
          <EmptyState
            title={t('documents.load_error')}
            actionLabel={t('common:buttons.retry')}
            onAction={() => window.location.reload()}
          />
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-700 dark:bg-slate-800">
            <ClipboardList size={48} className="text-slate-400" />
            <p className="text-slate-600 dark:text-slate-400">{t('documents.empty')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() =>
                  isTerminalPickListStatus(doc.status)
                    ? navigate(`/controller/documents/view/${doc.id}`, {
                        state: { backTo: '/controller/documents' },
                      })
                    : navigate(`/picking/mobile-pwa/${doc.id}`)
                }
                className="flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {doc.order_number
                      ? t('picking:order_number_display', { number: doc.order_number })
                      : doc.document_no}
                  </div>
                  {doc.delivery_number ? (
                    <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                      {t('picking:delivery_number_short', { number: doc.delivery_number })}
                    </div>
                  ) : null}
                  <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {doc.picked_lines} / {doc.total_lines} {t('documents.lines')}
                  </div>
                  {doc.status === 'DONE' && doc.completed_at && (
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {t('documents.completed_at')}: {new Date(doc.completed_at).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge(doc.status)}`}
                >
                  {t(`picking:doc_status.${doc.document_status.toLowerCase().replace(/-/g, '_')}`, {
                    defaultValue: doc.document_status,
                  })}
                </span>
                <span className="text-slate-400">›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
