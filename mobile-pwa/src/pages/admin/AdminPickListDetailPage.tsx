import { useTranslation } from 'react-i18next'
import { useLocation, useParams } from 'react-router-dom'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { PickListReadOnlyDetail } from '../../components/picking/PickListReadOnlyDetail'
import { Card } from '../../components/ui/card'

export function AdminPickListDetailPage() {
  const { documentId } = useParams<{ documentId: string }>()
  const location = useLocation()
  const { t } = useTranslation('picking')
  const backTo =
    (location.state as { backTo?: string } | null | undefined)?.backTo ?? '/admin/picking/archive'

  if (!documentId) {
    return null
  }

  return (
    <AdminLayout title={t('readonly_page_title')} backTo={backTo}>
      <Card className="p-4 sm:p-6">
        <PickListReadOnlyDetail documentId={documentId} />
      </Card>
    </AdminLayout>
  )
}
