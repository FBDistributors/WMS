import { useTranslation } from 'react-i18next'
import { AdminLayout } from '../../admin/components/AdminLayout'
import { Card } from '../../components/ui/card'

export function MovementPage() {
  const { t } = useTranslation('admin')

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {t('menu.movement')}
        </h1>
        <Card className="p-6 text-slate-600 dark:text-slate-400">
          <p>{t('menu.movement')}</p>
        </Card>
      </div>
    </AdminLayout>
  )
}
