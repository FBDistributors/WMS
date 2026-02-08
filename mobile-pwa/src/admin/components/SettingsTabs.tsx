import { useTranslation } from 'react-i18next'

const TABS = [
  { id: 'profile', labelKey: 'admin:settings.tabs.profile' },
  { id: 'notifications', labelKey: 'admin:settings.tabs.notifications' },
  { id: 'integrations', labelKey: 'admin:settings.tabs.integrations' },
  { id: 'security', labelKey: 'admin:settings.tabs.security' },
]

type SettingsTabsProps = {
  value: string
  onChange: (tabId: string) => void
}

export function SettingsTabs({ value, onChange }: SettingsTabsProps) {
  const { t } = useTranslation('admin')

  return (
    <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
      {TABS.map((tab) => {
        const isActive = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            className={[
              'rounded-full px-4 py-2 text-sm font-semibold transition-colors',
              isActive
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
            ].join(' ')}
            onClick={() => onChange(tab.id)}
          >
            {t(tab.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
