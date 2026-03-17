import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { SmartupBalanceView } from './SmartupBalancePage'
import { FILIAL_LIST } from '../../constants/filialCodes'

const DEFAULT_FILIAL_ID = '3788131'

export function SmartupCustomPage() {
  const { t } = useTranslation('inventory')
  const [searchParams, setSearchParams] = useSearchParams()
  const filialId = searchParams.get('filial_id')?.trim() || DEFAULT_FILIAL_ID

  const handleFilialChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = new URLSearchParams(searchParams)
    const v = e.target.value
    if (v) next.set('filial_id', v)
    else next.delete('filial_id')
    setSearchParams(next)
  }

  const dropdown = (
    <div className="flex items-center gap-2 shrink-0">
      <label htmlFor="filial-select" className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
        {t('filial_label')}:
      </label>
      <select
        id="filial-select"
        value={filialId}
        onChange={handleFilialChange}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 min-w-[200px]"
        aria-label={t('filial_label')}
      >
        <option value="all">{t('filial_all')}</option>
        {FILIAL_LIST.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <SmartupBalanceView
      warehouseCode="001"
      filialId={filialId}
      customHeaderSlot={dropdown}
    />
  )
}
