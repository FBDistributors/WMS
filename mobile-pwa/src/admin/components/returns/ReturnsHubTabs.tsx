import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

/** Qaytimlar bo'limi tabi: SmartUp qaytimlar (inbox) va Qaytganlar (arxiv). */
export function ReturnsHubTabs() {
  const { t } = useTranslation(['admin'])
  const { pathname } = useLocation()

  const pillActive = 'bg-white text-sky-700 shadow-sm dark:bg-slate-900 dark:text-sky-300'
  const pillInactive =
    'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100'

  const tabs = [
    {
      to: '/admin/smartup-returns',
      label: t('admin:menu.smartup_returns', 'SmartUp qaytimlar'),
      isActive: pathname.startsWith('/admin/smartup-returns'),
    },
    {
      to: '/admin/returns-history',
      label: t('admin:menu.returns_history', 'Qaytganlar'),
      isActive: pathname.startsWith('/admin/returns-history'),
    },
  ]

  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={() =>
            `shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
              tab.isActive ? pillActive : pillInactive
            }`
          }
          aria-current={tab.isActive ? 'page' : undefined}
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  )
}
