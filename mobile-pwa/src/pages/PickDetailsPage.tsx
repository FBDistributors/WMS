import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, PackageSearch } from 'lucide-react'

import { AppHeader } from '../components/layout/AppHeader'
import { PickLineRow } from '../components/picking/PickLineRow'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/EmptyState'
import { Progress } from '../components/ui/progress'
import { Separator } from '../components/ui/separator'
import { completePick, getPickListDetails, type PickListDetails } from '../services/pickingApi'

export function PickDetailsPage() {
  const { documentId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<PickListDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCompleting, setIsCompleting] = useState(false)

  const load = useCallback(async () => {
    if (!documentId) {
      setError('Document topilmadi.')
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const details = await getPickListDetails(documentId)
      setData(details)
    } catch (err) {
      setError('Hujjat yuklanmadi. Qayta urinib ko‘ring.')
    } finally {
      setIsLoading(false)
    }
  }, [documentId])

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
      setError('Yakunlashda xato. Qayta urinib ko‘ring.')
    } finally {
      setIsCompleting(false)
    }
  }, [data, documentId, navigate])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4">
        <AppHeader title="Pick details" onBack={() => navigate(-1)} />
        <div className="space-y-4">
          <div className="h-20 w-full animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-24 w-full animate-pulse rounded-2xl bg-slate-200" />
        </div>
      </div>
    )
  }

  if (!data || error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4">
        <AppHeader title="Pick details" onBack={() => navigate(-1)} />
        <EmptyState
          icon={<PackageSearch size={32} />}
          title={error ?? 'Hujjat topilmadi'}
          actionLabel="Qayta urinib ko‘rish"
          onAction={load}
        />
      </div>
    )
  }

  const allPicked = progress.total > 0 && progress.picked >= progress.total

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-24">
      <AppHeader title={`Hujjat № ${data.document_no}`} onBack={() => navigate(-1)} />
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>{progress.picked} / {progress.total} picked</span>
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
            onClick={() => navigate(`/picking/mobile-pwa/${data.id}/line/${line.id}`)}
          />
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t bg-white px-4 py-3">
        <Button
          fullWidth
          variant={allPicked ? 'default' : 'secondary'}
          disabled={!allPicked || isCompleting}
          onClick={handleComplete}
        >
          <CheckCircle2 size={18} />
          {isCompleting ? 'Yakunlanmoqda...' : 'Complete pick'}
        </Button>
      </div>
    </div>
  )
}
