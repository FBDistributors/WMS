import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export function InventoryHeaderTabs() {
  const { t } = useTranslation('inventory')

  const base =
    'rounded-full px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap'
  const active =
    'bg-blue-600 text-white dark:bg-blue-500'
  const inactive =
    'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'

  return (
    <div className="flex items-center gap-1">
      <NavLink
        to="/admin/inventory"
        end
        className={({ isActive }) =>
          [base, isActive ? active : inactive].join(' ')
        }
      >
        {t('title')}
      </NavLink>
      <NavLink
        to="/admin/inventory/smartup-balance"
        end
        className={({ isActive }) =>
          [base, isActive ? active : inactive].join(' ')
        }
      >
        {t('smartup_balance_short')}
      </NavLink>
      <NavLink
        to="/admin/inventory/smartup-bron"
        end
        className={({ isActive }) =>
          [base, isActive ? active : inactive].join(' ')
        }
      >
        {t('smartup_bron_short')}
      </NavLink>
      <NavLink
        to="/admin/inventory/smartup-custom"
        end
        className={({ isActive }) =>
          [base, isActive ? active : inactive].join(' ')
        }
      >
        {t('smartup_custom_tab')}
      </NavLink>
    </div>
  )
}
