import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { PickListReadOnlyDetail } from '../../components/picking/PickListReadOnlyDetail'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'

export function PickingViewReadOnlyPage() {
  const { documentId } = useParams<{ documentId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation('picking')

  if (!documentId) {
    return null
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-4xl items-center gap-2">
          <Button variant="ghost" className="gap-2 px-0" type="button" onClick={() => navigate('/picking/mobile-pwa')}>
            <ArrowLeft size={18} />
            {t('readonly_back')}
          </Button>
        </div>
      </div>
      <div className="mx-auto max-w-4xl px-4 py-6">
        <Card className="p-4 sm:p-6">
          <PickListReadOnlyDetail documentId={documentId} />
        </Card>
      </div>
    </div>
  )
}
