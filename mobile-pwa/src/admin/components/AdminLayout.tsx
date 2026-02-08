import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { Menu, Monitor, Moon, Sun, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const [isThemeOpen, setIsThemeOpen] = useState(false)
  const { user, setRole, isMock } = useAuth()
  const { theme, setTheme } = useTheme()
  const { t } = useTranslation(['admin', 'common'])
  const themeRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!themeRef.current) return
      if (!themeRef.current.contains(event.target as Node)) {
        setIsThemeOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 md:flex dark:bg-slate-950">
      <div className="hidden md:block">
        <Sidebar />
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
            <Sidebar onNavigate={() => setIsOpen(false)} />
          </div>
        </div>
      ) : null}
      <div className="flex-1">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
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
            <div className="relative" ref={themeRef}>
              <Button
                variant="ghost"
                onClick={() => setIsThemeOpen((prev) => !prev)}
                aria-label={t('common:theme.label')}
              >
                {theme === 'dark' ? <Moon size={18} /> : theme === 'light' ? <Sun size={18} /> : <Monitor size={18} />}
              </Button>
              {isThemeOpen ? (
                <div className="absolute right-0 mt-2 w-44 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-lg dark:border-slate-800 dark:bg-slate-900">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={() => {
                      setTheme('light')
                      setIsThemeOpen(false)
                    }}
                  >
                    <Sun size={16} />
                    {t('common:theme.light')}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={() => {
                      setTheme('dark')
                      setIsThemeOpen(false)
                    }}
                  >
                    <Moon size={16} />
                    {t('common:theme.dark')}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={() => {
                      setTheme('system')
                      setIsThemeOpen(false)
                    }}
                  >
                    <Monitor size={16} />
                    {t('common:theme.system')}
                  </button>
                </div>
              ) : null}
            </div>
            {user ? (
              <div className="hidden text-sm text-slate-500 sm:block dark:text-slate-400">
                {user.name} · {user.role}
              </div>
            ) : null}
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
          </div>
        </header>
        <main className="px-4 py-6">{children}</main>
      </div>
    </div>
  )
}
