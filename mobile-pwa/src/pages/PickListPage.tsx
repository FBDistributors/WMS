import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, RefreshCcw, Boxes } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AppHeader } from '../components/layout/AppHeader'
import { PickListCard } from '../components/picking/PickListCard'
import { EmptyState } from '../components/ui/EmptyState'
import { Button } from '../components/ui/button'
import { listPickLists, type PickList } from '../services/pickingApi'

export function PickListPage() {
  const navigate = useNavigate()
  const { t } = useTranslation('picking')
  const [items, setItems] = useState<PickList[]>([])
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await listPickLists()
      setItems(data)
    } catch (err) {
      setError(t('load_error'))
    } finally {
      setIsLoading(false)
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4">
        <AppHeader title={t('list_title')} onRefresh={load} />
        <div className="space-y-4">
          <div className="h-12 w-full animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-6">
      <AppHeader
        title={t('list_title')}
        onRefresh={load}
        actionSlot={
          <Button variant="ghost" onClick={load} aria-label={t('refresh')}>
            <RefreshCcw size={18} />
          </Button>
        }
      />
      <div className="mb-4 flex items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-sm">
        <Search size={18} className="text-slate-400" />
        <input
          className="w-full bg-transparent text-sm text-slate-900 outline-none"
          placeholder={t('search_placeholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {error ? (
        <EmptyState
          icon={<Boxes size={32} />}
          title={error}
          actionLabel={t('refresh')}
          onAction={load}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Boxes size={32} />}
          title={t('empty_title')}
          description={t('empty_desc')}
          actionLabel={t('refresh')}
          onAction={load}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <PickListCard
              key={item.id}
              item={item}
              onClick={() => navigate(`/picking/mobile-pwa/${item.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
