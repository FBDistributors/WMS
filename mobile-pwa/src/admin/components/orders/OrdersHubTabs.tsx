import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../../rbac/AuthProvider'

function isYangiActive(pathname: string): boolean {
  return (
    pathname === '/admin/orders' ||
    pathname.startsWith('/admin/orders/') ||
    pathname.startsWith('/admin/orders-diller') ||
    pathname.startsWith('/admin/orders-orikzor')
  )
}

export function OrdersHubTabs() {
  const { t } = useTranslation(['orders', 'admin'])
  const { pathname } = useLocation()
  const { has } = useAuth()
  const showPickingTab = has('picking:read')

  const yangiActive = isYangiActive(pathname)

  const pillActive = 'bg-white text-sky-700 shadow-sm dark:bg-slate-900 dark:text-sky-300'
  const pillInactive = 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100'

  const tabs = [
    { to: '/admin/orders', label: t('admin:menu.orders_yangi'), isActive: yangiActive },
    ...(showPickingTab
      ? [
          { to: '/admin/picking', label: t('admin:menu.orders_jarayon'), isActive: pathname === '/admin/picking' },
          { to: '/admin/picking/cancelled', label: t('admin:menu.orders_cancelled'), isActive: pathname === '/admin/picking/cancelled' },
          { to: '/admin/picking/archive', label: t('admin:menu.orders_archive'), isActive: pathname.startsWith('/admin/picking/archive') },
        ]
      : []),
  ]

  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/admin/picking'}
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

export function OrdersSourceSubTabs() {
  const { t } = useTranslation(['admin'])
  const { pathname } = useLocation()

  const tabs = [
    { to: '/admin/orders', label: t('admin:menu.orders_hub_main'), exact: true },
    { to: '/admin/orders-diller', label: t('admin:menu.orders_diller'), exact: false },
    { to: '/admin/orders-orikzor', label: t('admin:menu.orders_orikzor'), exact: false },
  ]

  const activeStyle = 'border-sky-500 text-sky-700 dark:text-sky-300 dark:border-sky-300'
  const inactiveStyle = 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'

  return (
    <div className="flex border-b border-slate-200 dark:border-slate-700 gap-0 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.exact
          ? pathname === tab.to || pathname.startsWith(tab.to + '/')
          : pathname.startsWith(tab.to)
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={() =>
              `shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                isActive ? activeStyle : inactiveStyle
              }`
            }
            aria-current={isActive ? 'page' : undefined}
          >
            {tab.label}
          </NavLink>
        )
      })}
    </div>
  )
}
