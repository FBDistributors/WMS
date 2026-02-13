import { useNavigate } from 'react-router-dom'
import { User, LogOut, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AppHeader } from '../../components/layout/AppHeader'
import { useAuth } from '../../rbac/AuthProvider'
import { useTheme } from '../../theme/ThemeProvider'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'

export function PickerProfilePage() {
  const { t } = useTranslation(['picker', 'common'])
  const { user, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950">
      <AppHeader title={t('profile.title')} hideUserMenu />
      <div className="w-full max-w-xl mx-auto px-4 sm:px-6 pb-nav">
        {/* User info */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50">
              <User size={28} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {user?.name ?? '—'}
              </div>
              <div className="text-sm text-slate-500 dark:text-slate-400">
                {t(`common:roles.${user?.role}`)}
              </div>
            </div>
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-slate-500 dark:text-slate-400">{t('profile.username')}</dt>
              <dd className="font-medium text-slate-900 dark:text-slate-100">
                {user?.username ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">{t('profile.phone')}</dt>
              <dd className="font-medium text-slate-900 dark:text-slate-100">—</dd>
            </div>
          </dl>
        </div>

        {/* Settings */}
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-2 px-1 text-sm font-medium text-slate-600 dark:text-slate-400">
            <Settings size={18} />
            {t('profile.settings_section')}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
              {t('common:theme.label')}
            </div>
            <div className="flex gap-2">
              {(['light', 'dark'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTheme(m)}
                  className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition ${
                    theme === m
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {t(`common:theme.${m}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
              {t('common:labels.language')}
            </div>
            <LanguageSwitcher />
          </div>
        </div>

        {/* Logout */}
        <div className="mt-6">
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 transition hover:bg-red-100 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/50"
          >
            <LogOut size={18} />
            {t('common:logout')}
          </button>
        </div>
      </div>
    </div>
  )
}
