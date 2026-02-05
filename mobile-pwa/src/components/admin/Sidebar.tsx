import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Package,
  MapPin,
  Boxes,
  ClipboardList,
  Users,
} from 'lucide-react'

import { useAuth } from '../../auth/AuthContext'
import type { PermissionKey } from '../../auth/permissions'

type NavItem = {
  label: string
  to: string
  icon: typeof LayoutDashboard
  requiredPermission: PermissionKey
}

const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/admin', icon: LayoutDashboard, requiredPermission: 'admin:read' },
  {
    label: 'Products',
    to: '/admin/products',
    icon: Package,
    requiredPermission: 'products:read',
  },
  {
    label: 'Locations',
    to: '/admin/locations',
    icon: MapPin,
    requiredPermission: 'inventory:read',
  },
  {
    label: 'Inventory',
    to: '/admin/inventory',
    icon: Boxes,
    requiredPermission: 'inventory:read',
  },
  {
    label: 'Picking',
    to: '/picking/mobile-pwa',
    icon: ClipboardList,
    requiredPermission: 'picking:read',
  },
  {
    label: 'Users & Access',
    to: '/admin/users',
    icon: Users,
    requiredPermission: 'users:manage',
  },
]

type SidebarProps = {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const location = useLocation()
  const { hasPermission } = useAuth()

  const allowedItems = navItems.filter((item) => hasPermission(item.requiredPermission))

  return (
    <aside className="w-64 border-r border-slate-200 bg-white p-4">
      <div className="mb-6 text-lg font-semibold text-slate-900">WMS Admin</div>
      <nav className="space-y-1">
        {allowedItems.map(({ label, to, icon: Icon }) => {
          const isActive =
            location.pathname === to || (to !== '/admin' && location.pathname.startsWith(to))
          return (
            <Link
              key={to}
              to={to}
              onClick={onNavigate}
              className={[
                'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100',
              ].join(' ')}
            >
              <Icon size={18} />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
