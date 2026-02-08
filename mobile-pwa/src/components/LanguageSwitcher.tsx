import { useTranslation } from 'react-i18next'

const OPTIONS = [
  { value: 'uz', label: 'UZ' },
  { value: 'en', label: 'EN' },
  { value: 'ru', label: 'RU' },
]

type LanguageSwitcherProps = {
  compact?: boolean
}

export function LanguageSwitcher({ compact }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation('common')

  return (
    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
      {compact ? null : <span>{t('labels.language')}</span>}
      <select
        className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
        value={i18n.language}
        onChange={(event) => {
          void i18n.changeLanguage(event.target.value)
        }}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
