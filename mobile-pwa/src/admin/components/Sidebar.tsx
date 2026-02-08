import { Link, useLocation } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Package,
  Boxes,
  ClipboardList,
  Users,
  UserCircle2,
  Settings,
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../rbac/AuthProvider'
import type { MenuItem } from '../../rbac/menu'
import { filterMenuByPermissions } from '../../rbac/menu'
import { isSupervisor, isWarehouseAdmin } from '../../rbac/permissions'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip'

const MENU_ITEMS: Array<MenuItem & { key: string }> = [
  { key: 'dashboard', label: 'Dashboard', path: '/admin', icon: LayoutDashboard, required: 'admin:access' },
  { key: 'products', label: 'Products', path: '/admin/products', icon: Package, required: 'products:read' },
  { key: 'inventory', label: 'Inventory', path: '/admin/inventory', icon: Boxes, required: 'inventory:read' },
  { key: 'picking', label: 'Picking', path: '/picking/mobile-pwa', icon: ClipboardList, required: 'picking:read' },
  { key: 'users', label: 'Users & Access', path: '/admin/users', icon: Users, required: 'users:manage' },
  { key: 'profile', label: 'Profile', path: '/admin/profile', icon: Settings, required: 'admin:access' },
]

type SidebarProps = {
  collapsed: boolean
  onToggleCollapse: () => void
  onNavigate?: () => void
}

export function Sidebar({ collapsed, onToggleCollapse, onNavigate }: SidebarProps) {
  const location = useLocation()
  const { user } = useAuth()
  const { t } = useTranslation(['admin', 'common'])
  const items = filterMenuByPermissions(MENU_ITEMS, user?.permissions ?? []).filter((item) => {
    if (item.key !== 'profile') return true
    if (!user) return false
    return isWarehouseAdmin(user.role) || isSupervisor(user.role)
  })

  const roleLabel = useMemo(() => {
    if (!user) return ''
    return t(`admin:roles.${user.role}`)
  }, [t, user])

  const initials = useMemo(() => {
    if (!user) return ''
    const source = user.name || user.id
    return source
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('')
  }, [user])

  return (
    <aside
      className={[
        'flex h-screen flex-col border-r border-slate-200 bg-white p-4 transition-all',
        'dark:border-slate-800 dark:bg-slate-900',
        'md:fixed md:inset-y-0 md:left-0',
        collapsed ? 'w-20' : 'w-64',
      ].join(' ')}
    >
      <div className="mb-6 flex items-center justify-between">
        <div
          className={[
            'text-lg font-semibold text-slate-900 transition-opacity dark:text-slate-100',
            collapsed ? 'opacity-0' : 'opacity-100',
          ].join(' ')}
        >
          {t('admin:sidebar_title')}
        </div>
        <Button
          variant="ghost"
          className={collapsed ? 'mx-auto' : ''}
          onClick={onToggleCollapse}
          aria-label={collapsed ? t('common:sidebar.expand') : t('common:sidebar.collapse')}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </Button>
      </div>
      <TooltipProvider>
        <nav className="space-y-1">
          {items.map(({ label, path, icon: Icon, key }) => {
            const isActive =
              location.pathname === path || (path !== '/admin' && location.pathname.startsWith(path))
            const content = (
              <Link
                key={path}
                to={path}
                onClick={onNavigate}
                className={[
                  'flex items-center rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                  collapsed ? 'justify-center' : 'gap-3',
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                ].join(' ')}
              >
                <Icon size={18} />
                <span className={collapsed ? 'sr-only' : ''}>{t(`menu.${key}`, label)}</span>
              </Link>
            )
            if (!collapsed) {
              return content
            }
            return (
              <Tooltip key={path}>
                <TooltipTrigger asChild>{content}</TooltipTrigger>
                <TooltipContent side="right">{t(`menu.${key}`, label)}</TooltipContent>
              </Tooltip>
            )
          })}
        </nav>
      </TooltipProvider>

      <div className="mt-auto pt-4">
        <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
          <div
            className={[
              'flex items-center gap-3',
              collapsed ? 'flex-col' : 'justify-between',
            ].join(' ')}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-200">
                {initials || <UserCircle2 size={18} />}
              </div>
              <div className={collapsed ? 'sr-only' : ''}>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {user?.name ?? '—'}
                </div>
                <Badge variant="neutral">{roleLabel}</Badge>
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-300">
              <UserCircle2 size={18} />
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
