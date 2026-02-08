import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Package,
  Boxes,
  ClipboardList,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../rbac/AuthProvider'
import type { MenuItem } from '../../rbac/menu'
import { filterMenuByPermissions } from '../../rbac/menu'

const MENU_ITEMS: Array<MenuItem & { key: string }> = [
  { key: 'dashboard', label: 'Dashboard', path: '/admin', icon: LayoutDashboard, required: 'admin:access' },
  { key: 'products', label: 'Products', path: '/admin/products', icon: Package, required: 'products:read' },
  { key: 'inventory', label: 'Inventory', path: '/admin/inventory', icon: Boxes, required: 'inventory:read' },
  { key: 'picking', label: 'Picking', path: '/picking/mobile-pwa', icon: ClipboardList, required: 'picking:read' },
  { key: 'users', label: 'Users & Access', path: '/admin/users', icon: Users, required: 'users:manage' },
]

type SidebarProps = {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const location = useLocation()
  const { user } = useAuth()
  const { t } = useTranslation('admin')
  const items = filterMenuByPermissions(MENU_ITEMS, user?.permissions ?? [])

  return (
    <aside className="w-64 border-r border-slate-200 bg-white p-4">
      <div className="mb-6 text-lg font-semibold text-slate-900">{t('sidebar_title')}</div>
      <nav className="space-y-1">
        {items.map(({ label, path, icon: Icon, key }) => {
          const isActive =
            location.pathname === path || (path !== '/admin' && location.pathname.startsWith(path))
          return (
            <Link
              key={path}
              to={path}
              onClick={onNavigate}
              className={[
                'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100',
              ].join(' ')}
            >
              <Icon size={18} />
              {t(`menu.${key}`, label)}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
