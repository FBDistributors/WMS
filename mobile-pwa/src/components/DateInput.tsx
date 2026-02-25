import { Calendar } from 'lucide-react'

const PLACEHOLDER = 'dd/mm/yyyy'

function formatForDisplay(isoOrEmpty: string): string {
  if (!isoOrEmpty || !isoOrEmpty.trim()) return ''
  const match = isoOrEmpty.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return isoOrEmpty
  const [, y, m, d] = match
  return `${d}/${m}/${y}`
}

export type DateInputProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  id?: string
  'aria-label'?: string
  disabled?: boolean
}

export function DateInput({
  value,
  onChange,
  placeholder = PLACEHOLDER,
  className = '',
  id,
  'aria-label': ariaLabel,
  disabled = false,
}: DateInputProps) {
  const displayValue = formatForDisplay(value)

  return (
    <div
      className={`relative flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors hover:border-slate-300 focus-within:ring-2 focus-within:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 ${
        disabled ? 'cursor-not-allowed opacity-60' : ''
      } ${className}`}
    >
      <span
        className={`pointer-events-none min-h-[1.25rem] flex-1 ${displayValue ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}
      >
        {displayValue || placeholder}
      </span>
      <Calendar
        size={18}
        className="pointer-events-none shrink-0 text-slate-400 dark:text-slate-500"
        aria-hidden
      />
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        id={id}
        aria-label={ariaLabel}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        tabIndex={0}
      />
    </div>
  )
}
