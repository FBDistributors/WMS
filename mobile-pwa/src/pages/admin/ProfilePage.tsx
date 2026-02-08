import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { useAuth } from '../../rbac/AuthProvider'

export function ProfilePage() {
  const { user } = useAuth()
  const { t } = useTranslation(['admin', 'common'])

  const roleLabel = useMemo(() => {
    if (!user) return '—'
    return t(`admin:roles.${user.role}`)
  }, [t, user])

  return (
    <AdminLayout title={t('admin:profile.title')}>
      <Card className="max-w-xl space-y-4">
        <div>
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {t('admin:profile.fields.username')}
          </div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-200">
            {user?.name ?? '—'}
          </div>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {t('admin:profile.fields.full_name')}
          </div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-200">—</div>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {t('admin:profile.fields.role')}
          </div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-200">{roleLabel}</div>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {t('admin:profile.fields.permissions')}
          </div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-200">
            {t('admin:profile.permissions_count', { count: user?.permissions.length ?? 0 })}
          </div>
        </div>
        <div>
          <Button variant="secondary" onClick={() => {}}>
            {t('admin:profile.change_password')}
          </Button>
        </div>
      </Card>
    </AdminLayout>
  )
}
