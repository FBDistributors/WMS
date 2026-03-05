/**
 * Muddati kiritish: Yil keyin Oy. Value = YYYY-MM-01 (oyning 1-kuni).
 */
import { useMemo } from 'react'

const MIN_YEAR = 2020
const MAX_YEAR = 2050

const MONTHS = [
  '01', '02', '03', '04', '05', '06',
  '07', '08', '09', '10', '11', '12',
]

export type MonthYearInputProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  id?: string
  'aria-label'?: string
  disabled?: boolean
}

function parseValue(val: string): { year: number; month: number } | null {
  if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return null
  const [y, m] = val.split('-').map(Number)
  if (m < 1 || m > 12) return null
  return { year: y, month: m }
}

export function MonthYearInput({
  value,
  onChange,
  placeholder = 'YYYY-MM',
  className = '',
  id,
  'aria-label': ariaLabel,
  disabled = false,
}: MonthYearInputProps) {
  const parsed = useMemo(() => parseValue(value), [value])
  const year = parsed?.year ?? new Date().getFullYear()
  const month = parsed?.month ?? 1

  const years = useMemo(
    () => Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i),
    []
  )

  const handleYearChange = (y: number) => {
    onChange(`${y}-${String(month).padStart(2, '0')}-01`)
  }
  const handleMonthChange = (m: number) => {
    onChange(`${year}-${String(m).padStart(2, '0')}-01`)
  }

  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      role="group"
      aria-label={ariaLabel}
    >
      <select
        id={id}
        value={year}
        onChange={(e) => handleYearChange(Number(e.target.value))}
        disabled={disabled}
        className="flex-1 min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
        aria-label={ariaLabel ? `${ariaLabel} (yil)` : undefined}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <select
        value={month}
        onChange={(e) => handleMonthChange(Number(e.target.value))}
        disabled={disabled}
        className="flex-1 min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
        aria-label={ariaLabel ? `${ariaLabel} (oy)` : undefined}
      >
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
    </div>
  )
}
