import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Package,
  Boxes,
  ClipboardList,
  Users,
  UserCircle2,
  LogOut,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../rbac/AuthProvider'
import type { MenuItem } from '../../rbac/menu'
import { filterMenuByPermissions } from '../../rbac/menu'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip'

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
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const { t } = useTranslation(['admin', 'common'])
  const items = filterMenuByPermissions(MENU_ITEMS, user?.permissions ?? [])
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('wms_sidebar_collapsed') === 'true'
  })
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('wms_sidebar_collapsed', String(isCollapsed))
  }, [isCollapsed])

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!profileRef.current) return
      if (!profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

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
        isCollapsed ? 'w-20' : 'w-64',
      ].join(' ')}
    >
      <div className="mb-6 flex items-center justify-between">
        <div
          className={[
            'text-lg font-semibold text-slate-900 transition-opacity dark:text-slate-100',
            isCollapsed ? 'opacity-0' : 'opacity-100',
          ].join(' ')}
        >
          {t('admin:sidebar_title')}
        </div>
        <Button
          variant="ghost"
          className={isCollapsed ? 'mx-auto' : ''}
          onClick={() => setIsCollapsed((prev) => !prev)}
          aria-label={isCollapsed ? t('common:sidebar.expand') : t('common:sidebar.collapse')}
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
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
                  isCollapsed ? 'justify-center' : 'gap-3',
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                ].join(' ')}
              >
                <Icon size={18} />
                <span className={isCollapsed ? 'sr-only' : ''}>{t(`menu.${key}`, label)}</span>
              </Link>
            )
            if (!isCollapsed) {
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
              isCollapsed ? 'flex-col' : 'justify-between',
            ].join(' ')}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-200">
                {initials || <UserCircle2 size={18} />}
              </div>
              <div className={isCollapsed ? 'sr-only' : ''}>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {user?.name ?? '—'}
                </div>
                <Badge variant="neutral">{roleLabel}</Badge>
              </div>
            </div>
            <div className="relative" ref={profileRef}>
              <Button
                variant="ghost"
                onClick={() => setIsProfileOpen((prev) => !prev)}
                aria-label={t('admin:profile.menu')}
              >
                <UserCircle2 size={18} />
              </Button>
              {isProfileOpen ? (
                <div className="absolute right-0 mt-2 w-44 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-lg dark:border-slate-800 dark:bg-slate-900">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={() => {
                      navigate('/admin/profile')
                      setIsProfileOpen(false)
                      onNavigate?.()
                    }}
                  >
                    <UserCircle2 size={16} />
                    {t('admin:profile.my_profile')}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={() => {
                      signOut()
                      navigate('/login')
                    }}
                  >
                    <LogOut size={16} />
                    {t('common:actions.sign_out')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
