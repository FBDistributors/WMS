import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { LogOut, Menu, Moon, Sun, User, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Button } from '../../components/ui/button'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { useAuth } from '../../rbac/AuthProvider'
import { useTheme } from '../../theme/ThemeProvider'

type AdminLayoutProps = {
  title: string
  actionSlot?: ReactNode
  children: ReactNode
}

export function AdminLayout({ title, actionSlot, children }: AdminLayoutProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('wms_sidebar_collapsed') === 'true'
  })
  const [showUserMenu, setShowUserMenu] = useState(false)
  const { user, setRole, isMock, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const { t } = useTranslation(['admin', 'common'])
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('wms_sidebar_collapsed', String(isCollapsed))
  }, [isCollapsed])

  return (
    <div className="flex h-screen bg-slate-100 dark:bg-slate-950">
      <div className="hidden md:block">
        <Sidebar collapsed={isCollapsed} onToggleCollapse={() => setIsCollapsed((prev) => !prev)} />
      </div>
      {isOpen ? (
        <div
          className="fixed inset-0 z-20 bg-black/30 md:hidden"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="h-full w-72 bg-white shadow-xl dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t('admin:header.menu')}
              </div>
              <Button variant="ghost" onClick={() => setIsOpen(false)}>
                <X size={18} />
              </Button>
            </div>
            <Sidebar
              collapsed={false}
              onToggleCollapse={() => setIsCollapsed((prev) => !prev)}
              onNavigate={() => setIsOpen(false)}
            />
          </div>
        </div>
      ) : null}
      <div className={['flex flex-1 flex-col', isCollapsed ? 'md:pl-20' : 'md:pl-64'].join(' ')}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-6 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="md:hidden" onClick={() => setIsOpen(true)}>
              <Menu size={18} />
            </Button>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Button
              variant="ghost"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={t('common:theme.label')}
            >
              {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
            </Button>
            {user && import.meta.env.DEV && isMock ? (
              <select
                className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                value={user.role}
                onChange={(event) => setRole(event.target.value as typeof user.role)}
              >
                <option value="picker">picker</option>
                <option value="receiver">receiver</option>
                <option value="inventory_controller">inventory_controller</option>
                <option value="supervisor">supervisor</option>
                <option value="warehouse_admin">warehouse_admin</option>
              </select>
            ) : null}
            {actionSlot}
            
            {/* User Profile & Logout */}
            {user ? (
              <div className="relative">
                <Button
                  variant="ghost"
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  aria-label={t('common:user_menu')}
                  className="flex items-center gap-2"
                >
                  <User size={18} />
                  <span className="hidden sm:inline text-sm">{user.name}</span>
                </Button>
                
                {showUserMenu ? (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowUserMenu(false)}
                    />
                    <div className="absolute right-0 top-full mt-2 z-20 w-48 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {user.name}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {t(`common:roles.${user.role}`)}
                        </div>
                      </div>
                      <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <LogOut size={16} />
                        {t('common:logout')}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </div>
  )
}
