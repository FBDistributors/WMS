import type { ReactNode } from 'react'
import { useState } from 'react'

import { ArrowLeft, LogOut, RefreshCcw, User } from 'lucide-react'
import { BRAND } from '../../config/branding'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '../ui/button'
import { useAuth } from '../../rbac/AuthProvider'

type AppHeaderProps = {
  title: string
  onBack?: () => void
  onRefresh?: () => void
  actionSlot?: ReactNode
}

export function AppHeader({ title, onBack, onRefresh, actionSlot }: AppHeaderProps) {
  const { t } = useTranslation('common')
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [showUserMenu, setShowUserMenu] = useState(false)

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <header className="sticky top-0 z-10 -mx-4 mb-4 bg-slate-50/95 px-4 py-3 backdrop-blur dark:bg-slate-900/95">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {onBack ? (
            <Button variant="ghost" onClick={onBack} aria-label={t('buttons.back')}>
              <ArrowLeft size={18} />
            </Button>
          ) : (
            <img src={BRAND.logoMain} alt="" className="h-8 w-auto object-contain" aria-hidden />
          )}
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          {actionSlot}
          {onRefresh ? (
            <Button variant="ghost" onClick={onRefresh} aria-label={t('buttons.refresh')}>
              <RefreshCcw size={18} />
            </Button>
          ) : null}
          {/* User Profile & Logout (like Admin) */}
          {user ? (
            <div className="relative">
              <Button
                variant="ghost"
                onClick={() => setShowUserMenu(!showUserMenu)}
                aria-label={t('user_menu')}
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
                        {t(`roles.${user.role}`)}
                      </div>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      <LogOut size={16} />
                      {t('logout')}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
