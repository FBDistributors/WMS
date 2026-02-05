import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Package, MapPin, Boxes } from 'lucide-react'

const navItems = [
  { label: 'Dashboard', to: '/admin', icon: LayoutDashboard },
  { label: 'Products', to: '/admin/products', icon: Package },
  { label: 'Locations', to: '/admin/locations', icon: MapPin },
  { label: 'Inventory', to: '/admin/inventory', icon: Boxes },
]

export function Sidebar() {
  const location = useLocation()

  return (
    <aside className="w-64 border-r border-slate-200 bg-white p-4">
      <div className="mb-6 text-lg font-semibold text-slate-900">WMS Admin</div>
      <nav className="space-y-1">
        {navItems.map(({ label, to, icon: Icon }) => {
          const isActive =
            location.pathname === to || (to !== '/admin' && location.pathname.startsWith(to))
          return (
            <Link
              key={to}
              to={to}
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
