import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { useAuth } from '../../rbac/AuthProvider'

import type React from 'react'

export function ProfilePage() {
  const { user } = useAuth()
  const { t } = useTranslation(['admin', 'common'])
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const roleLabel = useMemo(() => {
    if (!user) return '—'
    return t(`admin:roles.${user.role}`)
  }, [t, user])

  const nameParts = useMemo(() => {
    const raw = user?.name?.trim() ?? ''
    if (!raw) return { first: '—', last: '—', initials: '—' }
    const parts = raw.split(' ').filter(Boolean)
    const first = parts[0] ?? '—'
    const last = parts.slice(1).join(' ') || '—'
    const initials = parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('')
    return { first, last, initials }
  }, [user])

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const nextUrl = URL.createObjectURL(file)
    if (avatarUrl) {
      URL.revokeObjectURL(avatarUrl)
    }
    setAvatarUrl(nextUrl)
  }

  return (
    <AdminLayout title={t('admin:profile.title')}>
      <Card className="max-w-2xl space-y-6">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-lg font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-200">
              {avatarUrl ? (
                <img src={avatarUrl} alt={t('admin:profile.avatar_alt')} className="h-full w-full object-cover" />
              ) : (
                nameParts.initials
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {user?.name ?? '—'}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">{roleLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
            {t('admin:profile.upload_photo')}
          </Button>
          {avatarUrl ? (
            <Button
              variant="ghost"
              onClick={() => {
                URL.revokeObjectURL(avatarUrl)
                setAvatarUrl(null)
              }}
            >
              {t('admin:profile.remove_photo')}
            </Button>
          ) : null}
        </div>
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
            {t('admin:profile.fields.first_name')}
          </div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-200">{nameParts.first}</div>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {t('admin:profile.fields.last_name')}
          </div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-200">{nameParts.last}</div>
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
