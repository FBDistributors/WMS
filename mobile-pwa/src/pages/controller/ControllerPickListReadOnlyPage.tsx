import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import { PickListReadOnlyDetail } from '../../components/picking/PickListReadOnlyDetail'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'

export function ControllerPickListReadOnlyPage() {
  const { documentId } = useParams<{ documentId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation('picking')
  const backTo =
    (location.state as { backTo?: string } | null | undefined)?.backTo ?? '/controller/documents'

  if (!documentId) {
    return null
  }

  return (
    <>
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/95">
        <Button variant="ghost" className="gap-2 px-0" type="button" onClick={() => navigate(backTo)}>
          <ArrowLeft size={18} />
          {t('readonly_back')}
        </Button>
      </div>
      <div className="px-4 py-4">
        <Card className="p-4">
          <PickListReadOnlyDetail documentId={documentId} />
        </Card>
      </div>
    </>
  )
}
