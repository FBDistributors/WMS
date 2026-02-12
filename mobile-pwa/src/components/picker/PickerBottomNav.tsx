import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Home, ClipboardList, Scan, Package, User, Settings, LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../rbac/AuthProvider'

type NavItem = {
  path: string
  icon: typeof Home
  labelKey: string
  isScan?: boolean
  isAccount?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { path: '/picker', icon: Home, labelKey: 'home.asosiy' },
  { path: '/picking/mobile-pwa', icon: ClipboardList, labelKey: 'home.pick_tasks' },
  { path: '#scan', icon: Scan, labelKey: 'home.scan_button', isScan: true },
  { path: '/picker/inventory', icon: Package, labelKey: 'home.inventory' },
  { path: '#account', icon: User, labelKey: 'home.account', isAccount: true },
]

type PickerBottomNavProps = {
  onScanClick: () => void
}

export function PickerBottomNav({ onScanClick }: PickerBottomNavProps) {
  const { t } = useTranslation(['picker', 'common'])
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()
  const [showAccountMenu, setShowAccountMenu] = useState(false)

  const handleNav = (item: NavItem) => {
    if (item.isScan) {
      onScanClick()
    } else if (item.isAccount) {
      setShowAccountMenu((v) => !v)
    } else if (item.path !== '#scan') {
      navigate(item.path)
    }
  }

  const handleLogout = async () => {
    setShowAccountMenu(false)
    await logout()
    navigate('/login')
  }

  return (
    <nav className="relative flex-shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="flex items-center justify-around px-2 sm:px-4 pb-safe pt-2 max-w-lg mx-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = !item.isScan && !item.isAccount && location.pathname === item.path

          if (item.isScan) {
            return (
              <button
                key="scan"
                type="button"
                onClick={onScanClick}
                className="-mt-6 flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg transition hover:bg-violet-700 active:scale-95"
                aria-label={t(item.labelKey)}
              >
                <Scan size={28} />
              </button>
            )
          }

          return (
            <button
              key={item.path}
              type="button"
              onClick={() => handleNav(item)}
              className={`flex flex-col items-center gap-1 px-3 py-1 ${showAccountMenu && item.isAccount ? 'text-violet-600' : ''}`}
            >
              <Icon
                size={22}
                className={isActive || (showAccountMenu && item.isAccount) ? 'text-violet-600' : 'text-slate-500 dark:text-slate-400'}
              />
              <span
                className={`text-xs ${
                  isActive || (showAccountMenu && item.isAccount) ? 'font-medium text-violet-600' : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {t(item.labelKey)}
              </span>
            </button>
          )
        })}
      </div>

      {showAccountMenu && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowAccountMenu(false)}
            aria-hidden
          />
          <div className="absolute bottom-full left-2 right-2 mb-2 z-20 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800 sm:left-auto sm:right-2 sm:w-56">
            {user && (
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {user.name}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {t(`common:roles.${user.role}`)}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setShowAccountMenu(false)
                navigate('/picker/settings')
              }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <Settings size={18} />
              {t('home.settings')}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <LogOut size={18} />
              {t('common:logout')}
            </button>
          </div>
        </>
      )}
    </nav>
  )
}
