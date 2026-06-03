import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'

type FloatingSnackBarProps = {
  message: string | null
  variant?: 'success' | 'error'
  durationMs?: number
  onDismiss?: () => void
}

export function FloatingSnackBar({
  message,
  variant = 'success',
  durationMs = 3000,
  onDismiss,
}: FloatingSnackBarProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!message) {
      setVisible(false)
      return
    }
    setVisible(false)
    const showTimer = window.setTimeout(() => setVisible(true), 16)
    const hideTimer = window.setTimeout(() => setVisible(false), durationMs)
    const clearTimer = window.setTimeout(() => onDismiss?.(), durationMs + 320)
    return () => {
      window.clearTimeout(showTimer)
      window.clearTimeout(hideTimer)
      window.clearTimeout(clearTimer)
    }
  }, [message, durationMs, onDismiss])

  if (!message) {
    return null
  }

  const isSuccess = variant === 'success'
  const Icon = isSuccess ? CheckCircle2 : XCircle

  return (
    <div
      role={isSuccess ? 'status' : 'alert'}
      aria-live="polite"
      className={`pointer-events-none fixed left-1/2 top-4 z-[200] w-[min(92vw,28rem)] -translate-x-1/2 transition-all duration-300 ease-out ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'
      }`}
    >
      <div
        className={`pointer-events-auto flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${
          isSuccess
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100'
            : 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950 dark:text-rose-100'
        }`}
      >
        <Icon size={20} className="shrink-0" aria-hidden />
        <span className="flex-1">{message}</span>
      </div>
    </div>
  )
}
