import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../../rbac/AuthProvider'

/** Buyurtmalar segmenti: /admin/orders, /admin/order-statuses, /admin/orders/:id — boshqa hub tablari emas */
function isOrdersHubOrdersActive(pathname: string): boolean {
  if (pathname.startsWith('/admin/orders-diller')) return false
  if (pathname.startsWith('/admin/orders-orikzor')) return false
  if (pathname.startsWith('/admin/picking')) return false
  return true
}

export function OrdersHubTabs() {
  const { t } = useTranslation(['orders', 'admin'])
  const { pathname } = useLocation()
  const { has } = useAuth()
  const showPickingTab = has('picking:read')

  const base =
    'rounded-full px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap shrink-0'
  const active = 'bg-blue-600 text-white dark:bg-blue-500'
  const inactive = 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'

  const ordersTabActive = isOrdersHubOrdersActive(pathname)

  return (
    <div className="flex flex-wrap items-center gap-1 overflow-x-auto scrollbar-hide">
      <NavLink
        to="/admin/orders"
        className={() => [base, ordersTabActive ? active : inactive].join(' ')}
      >
        {t('orders:title')}
      </NavLink>
      <NavLink
        to="/admin/orders-diller"
        className={({ isActive }) => [base, isActive ? active : inactive].join(' ')}
      >
        {t('admin:menu.orders_diller')}
      </NavLink>
      <NavLink
        to="/admin/orders-orikzor"
        className={({ isActive }) => [base, isActive ? active : inactive].join(' ')}
      >
        {t('admin:menu.orders_orikzor')}
      </NavLink>
      {showPickingTab ? (
        <NavLink
          to="/admin/picking"
          className={({ isActive }) => [base, isActive ? active : inactive].join(' ')}
        >
          {t('admin:menu.picking')}
        </NavLink>
      ) : null}
    </div>
  )
}
