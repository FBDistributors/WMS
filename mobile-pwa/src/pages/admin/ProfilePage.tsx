import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { SettingsTabs } from '../../admin/components/SettingsTabs'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { useAuth } from '../../rbac/AuthProvider'

import type React from 'react'

export function ProfilePage() {
  const { user } = useAuth()
  const { t } = useTranslation(['admin', 'common'])
  const [activeTab, setActiveTab] = useState('profile')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const roleLabel = useMemo(() => {
    if (!user) return '—'
    return t(`admin:roles.${user.role}`)
  }, [t, user])

  const nameParts = useMemo(() => {
    const raw = user?.name?.trim() ?? ''
    if (!raw) return { full: '—', initials: '—' }
    const parts = raw.split(' ').filter(Boolean)
    const initials = parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('')
    return { full: raw, initials }
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
    <AdminLayout title={t('admin:settings.title')}>
      <div className="space-y-6">
        <SettingsTabs value={activeTab} onChange={setActiveTab} />

        {activeTab !== 'profile' ? (
          <Card className="max-w-3xl">
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t(`admin:settings.tabs.${activeTab}`)}
              </div>
              <Badge variant="neutral">{t('admin:settings.coming_soon')}</Badge>
            </div>
          </Card>
        ) : null}

        {activeTab === 'profile' ? (
          <Card className="max-w-3xl space-y-8">
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
              {nameParts.full}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">{roleLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
            {t('admin:profile.update_picture')}
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

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {t('admin:profile.fields.full_name')}
            </div>
            <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
              {nameParts.full}
            </div>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {t('admin:profile.fields.email')}
            </div>
            <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
              {t('admin:profile.placeholders.email')}
            </div>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {t('admin:profile.fields.role')}
            </div>
            <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
              {roleLabel}
            </div>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {t('admin:profile.fields.department')}
            </div>
            <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
              {t('admin:profile.placeholders.department')}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t('admin:profile.password_title')}
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              alert(t('admin:profile.password_soon'))
            }}
          >
            {t('admin:profile.change_password')}
          </Button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t('admin:profile.security_title')}
            </div>
            <Badge variant="neutral">{t('admin:settings.coming_soon')}</Badge>
          </div>
          <Button variant="outline" onClick={() => {}}>
            {t('admin:profile.enable_2fa')}
          </Button>
        </div>
          </Card>
        ) : null}
      </div>
    </AdminLayout>
  )
}
