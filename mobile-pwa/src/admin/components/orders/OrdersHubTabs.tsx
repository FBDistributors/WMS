import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

type HubSegment = 'orders' | 'diller' | 'orikzor'

function segmentFromPath(pathname: string): HubSegment {
  if (pathname.startsWith('/admin/orders-diller')) return 'diller'
  if (pathname.startsWith('/admin/orders-orikzor')) return 'orikzor'
  return 'orders'
}

export function OrdersHubTabs() {
  const { t } = useTranslation(['orders', 'admin'])
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const active = segmentFromPath(pathname)

  const tabs: { segment: HubSegment; label: string; path: string }[] = [
    { segment: 'orders', label: t('orders:title'), path: '/admin/orders' },
    { segment: 'diller', label: t('admin:menu.orders_diller'), path: '/admin/orders-diller' },
    { segment: 'orikzor', label: t('admin:menu.orders_orikzor'), path: '/admin/orders-orikzor' },
  ]

  return (
    <div className="flex gap-0 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
      {tabs.map((tab) => {
        const isActive = active === tab.segment
        return (
          <button
            key={tab.segment}
            type="button"
            onClick={() => navigate(tab.path)}
            className={[
              'shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-sky-500 text-sky-600 dark:border-sky-400 dark:text-sky-400'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200',
            ].join(' ')}
            aria-current={isActive ? 'page' : undefined}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
