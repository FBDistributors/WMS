import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'

import { AppHeader } from '../components/layout/AppHeader'
import { Button } from '../components/ui/button'

export function PickCompletePage() {
  const { documentId } = useParams()
  const navigate = useNavigate()

  const summary = useMemo(() => {
    return {
      total: '—',
      picked: '—',
      time: '—',
    }
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-10">
      <AppHeader title="Pick complete" onBack={() => navigate(-1)} />
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-white p-6 text-center shadow-sm">
        <CheckCircle2 size={48} className="text-green-600" />
        <div className="text-xl font-semibold text-slate-900">Pick yakunlandi</div>
        <div className="text-sm text-slate-500">
          Hujjat № {documentId ?? '—'}
        </div>
        <div className="grid w-full gap-2 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          <div className="flex items-center justify-between">
            <span>Jami lines</span>
            <span className="font-semibold">{summary.total}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Picked</span>
            <span className="font-semibold">{summary.picked}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Vaqt</span>
            <span className="font-semibold">{summary.time}</span>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <Button fullWidth onClick={() => navigate('/picking/mobile-pwa', { replace: true })}>
          Pick listga qaytish
        </Button>
      </div>
    </div>
  )
}
