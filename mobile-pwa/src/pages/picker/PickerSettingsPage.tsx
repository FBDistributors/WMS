import { useTranslation } from 'react-i18next'

import { AppHeader } from '../../components/layout/AppHeader'
import { useTheme } from '../../theme/ThemeProvider'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'

export function PickerSettingsPage() {
  const { t } = useTranslation(['picker', 'common'])
  const { theme, setTheme } = useTheme()

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950">
      <AppHeader title={t('home.settings')} hideUserMenu />
      <div className="w-full max-w-xl mx-auto px-4 sm:px-6">
        <div className="space-y-4">
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
      </div>
    </div>
  )
}
