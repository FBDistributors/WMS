/**
 * Sahifa yoki blok yuklanayotganda markaziy spinner.
 * Loader2 + ixtiyoriy label; className orqali o'lcham/min-height berish mumkin.
 */
import { Loader2 } from 'lucide-react'

type PageSpinnerProps = {
  label?: string
  className?: string
  iconSize?: number
}

export function PageSpinner({
  label,
  className = '',
  iconSize = 36,
}: PageSpinnerProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 text-slate-600 dark:text-slate-400 ${className}`}
      role="status"
      aria-label={label ?? 'Loading'}
    >
      <Loader2 size={iconSize} className="animate-spin shrink-0" />
      {label ? <span className="text-sm font-medium">{label}</span> : null}
    </div>
  )
}
