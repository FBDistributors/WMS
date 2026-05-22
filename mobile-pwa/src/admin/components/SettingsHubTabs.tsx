import { useTranslation } from 'react-i18next'

export type SettingsHubTabId = 'vip-customers' | 'work-zones' | 'organizations'

const TABS: { id: SettingsHubTabId; labelKey: string }[] = [
  { id: 'vip-customers', labelKey: 'admin:settings_hub.tabs.vip_customers' },
  { id: 'work-zones', labelKey: 'admin:settings_hub.tabs.work_zones' },
  { id: 'organizations', labelKey: 'admin:settings_hub.tabs.organizations' },
]

type SettingsHubTabsProps = {
  value: SettingsHubTabId
  onChange: (tabId: SettingsHubTabId) => void
}

export function SettingsHubTabs({ value, onChange }: SettingsHubTabsProps) {
  const { t } = useTranslation('admin')

  return (
    <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={[
            'rounded-full px-4 py-2 text-sm font-semibold transition-colors',
            value === tab.id
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
          ].join(' ')}
          onClick={() => onChange(tab.id)}
        >
          {t(tab.labelKey)}
        </button>
      ))}
    </div>
  )
}
