import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AppHeader } from '../../components/layout/AppHeader'
import { listPickLists, type PickList } from '../../services/pickingApi'

export function ControllerDocumentsPage() {
  const { t } = useTranslation('controller')
  const navigate = useNavigate()
  const [docs, setDocs] = useState<PickList[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listPickLists(50, 0)
      .then((data) => {
        if (!cancelled) setDocs(data)
      })
      .catch(() => {
        if (!cancelled) setError(t('documents.load_error'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  const statusBadge = (status: PickList['status']) => {
    const map: Record<PickList['status'], string> = {
      NEW: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
      IN_PROGRESS: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
      DONE: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
      ERROR: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
    }
    return map[status] ?? ''
  }

  return (
    <div className="min-h-screen w-full min-w-0 overflow-x-hidden bg-slate-50 dark:bg-slate-950">
      <AppHeader title={t('documents.title')} onRefresh={() => window.location.reload()} hideUserMenu />
      <div className="w-full max-w-xl mx-auto px-4 sm:px-6 min-w-0 pb-nav">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700"
              />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
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
                onClick={() => navigate(`/picking/mobile-pwa/${doc.id}`)}
                className="flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {doc.document_no}
                  </div>
                  <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {doc.picked_lines} / {doc.total_lines} {t('documents.lines')}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge(doc.status)}`}
                >
                  {doc.status}
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
