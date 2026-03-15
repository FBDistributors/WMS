import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, PackageSearch } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AppHeader } from '../components/layout/AppHeader'
import { PickLineRow } from '../components/picking/PickLineRow'
import { PickScanModal } from '../picking/components/PickScanModal'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingOverlay } from '../components/ui/LoadingOverlay'
import { Progress } from '../components/ui/progress'
import { Separator } from '../components/ui/separator'
import {
  completePick,
  getPickListDetailsForPicker,
  type PickListDetails,
  type PickLine,
} from '../services/pickingApi'

export function PickDetailsPage() {
  const { documentId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation(['picking', 'common'])
  const [data, setData] = useState<PickListDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCompleting, setIsCompleting] = useState(false)
  const [scanModalLine, setScanModalLine] = useState<PickLine | null>(null)
  const loadIdRef = useRef(0)

  const load = useCallback(async () => {
    if (!documentId) {
      setError(t('document_not_found'))
      setIsLoading(false)
      return
    }
    const id = (loadIdRef.current += 1)
    setIsLoading(true)
    setError(null)
    try {
      const details = await getPickListDetailsForPicker(documentId)
      if (id !== loadIdRef.current) return
      setData(details)
    } catch (err) {
      if (id !== loadIdRef.current) return
      setError(t('load_failed'))
    } finally {
      if (id === loadIdRef.current) setIsLoading(false)
    }
  }, [documentId, t])

  useEffect(() => {
    void load()
  }, [load])

  const progress = useMemo(() => {
    if (!data) return { picked: 0, total: 0, percent: 0 }
    const picked = data.picked_lines
    const total = data.total_lines
    const percent = total > 0 ? Math.round((picked / total) * 100) : 0
    return { picked, total, percent }
  }, [data])

  const handleComplete = useCallback(async () => {
    if (!documentId || !data) return
    setIsCompleting(true)
    try {
      await completePick(documentId)
      navigate(`/picking/mobile-pwa/${documentId}/complete`, { replace: true })
    } catch (err) {
      setError(t('complete_error'))
    } finally {
      setIsCompleting(false)
    }
  }, [data, documentId, navigate, t])

  if (isLoading) {
    return (
      <div className="relative min-h-screen bg-slate-50 px-4">
        <AppHeader title={t('details_title')} onBack={() => navigate(-1)} hideUserMenu />
        <LoadingOverlay fullScreen label={t('common:messages.loading')} />
      </div>
    )
  }

  if (!data || error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4">
        <AppHeader title={t('details_title')} onBack={() => navigate(-1)} hideUserMenu />
        <EmptyState
          icon={<PackageSearch size={32} />}
          title={error ?? t('document_not_found')}
          actionLabel={t('refresh')}
          onAction={load}
        />
      </div>
    )
  }

  const allPicked = progress.total > 0 && progress.picked >= progress.total

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-24">
      <AppHeader
        title={data.order_number
          ? t('order_number_display', { number: data.order_number })
          : t('document_number', { number: data.document_no })}
        onBack={() => navigate(-1)}
        hideUserMenu
      />
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>{t('progress_picked', { picked: progress.picked, total: progress.total })}</span>
          <span>{progress.percent}%</span>
        </div>
        <Progress value={progress.percent} className="mt-2" />
      </div>

      <Separator className="my-4" />

      <div className="space-y-3">
        {data.lines.map((line) => (
          <PickLineRow
            key={line.id}
            line={line}
            onClick={() => setScanModalLine(line)}
          />
        ))}
      </div>

      <PickScanModal
        open={scanModalLine !== null}
        line={scanModalLine}
        onClose={() => setScanModalLine(null)}
        onSuccess={load}
      />

      <div className="fixed bottom-0 left-0 right-0 border-t bg-white px-4 py-3">
        <Button
          fullWidth
          variant={allPicked ? 'default' : 'secondary'}
          disabled={!allPicked || isCompleting}
          onClick={handleComplete}
        >
          <CheckCircle2 size={18} />
          {isCompleting ? t('completing') : t('complete_button')}
        </Button>
      </div>
    </div>
  )
}
