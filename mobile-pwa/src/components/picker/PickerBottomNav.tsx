import { useNavigate, useLocation } from 'react-router-dom'
import { Home, ClipboardList, Scan, Package, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type NavItem = {
  path: string
  icon: typeof Home
  labelKey: string
  isScan?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { path: '/picker', icon: Home, labelKey: 'home.asosiy' },
  { path: '/picking/mobile-pwa', icon: ClipboardList, labelKey: 'home.pick_tasks' },
  { path: '#scan', icon: Scan, labelKey: 'home.scan_button', isScan: true },
  { path: '/picker/inventory', icon: Package, labelKey: 'home.inventory' },
  { path: '/offline-queue', icon: WifiOff, labelKey: 'home.offline_queue' },
]

type PickerBottomNavProps = {
  onScanClick: () => void
}

export function PickerBottomNav({ onScanClick }: PickerBottomNavProps) {
  const { t } = useTranslation('picker')
  const navigate = useNavigate()
  const location = useLocation()

  const handleNav = (item: NavItem) => {
    if (item.isScan) {
      onScanClick()
    } else if (item.path !== '#scan') {
      navigate(item.path)
    }
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="flex items-center justify-around px-2 sm:px-4 pb-safe pt-2 max-w-lg mx-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = !item.isScan && location.pathname === item.path

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
              className="flex flex-col items-center gap-1 px-3 py-1"
            >
              <Icon
                size={22}
                className={isActive ? 'text-violet-600' : 'text-slate-500 dark:text-slate-400'}
              />
              <span
                className={`text-xs ${
                  isActive ? 'font-medium text-violet-600' : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {t(item.labelKey)}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
