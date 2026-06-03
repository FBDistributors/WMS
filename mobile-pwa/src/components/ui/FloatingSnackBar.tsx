import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

type FloatingSnackBarProps = {
  message: string | null
  variant?: ToastVariant
  durationMs?: number
  onDismiss?: () => void
}

const VARIANT_STYLES: Record<
  ToastVariant,
  { box: string; role: 'status' | 'alert'; Icon: typeof CheckCircle2 }
> = {
  success: {
    box: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
    role: 'status',
    Icon: CheckCircle2,
  },
  error: {
    box: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950 dark:text-rose-100',
    role: 'alert',
    Icon: XCircle,
  },
  warning: {
    box: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950 dark:text-amber-100',
    role: 'alert',
    Icon: AlertTriangle,
  },
  info: {
    box: 'border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-800/60 dark:bg-blue-950 dark:text-blue-100',
    role: 'status',
    Icon: Info,
  },
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

  const { box, role, Icon } = VARIANT_STYLES[variant]

  return (
    <div
      role={role}
      aria-live="polite"
      className={`pointer-events-none fixed left-1/2 top-4 z-[200] w-[min(92vw,28rem)] -translate-x-1/2 transition-all duration-300 ease-out ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'
      }`}
    >
      <div
        className={`pointer-events-auto flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${box}`}
      >
        <Icon size={20} className="shrink-0" aria-hidden />
        <span className="flex-1">{message}</span>
      </div>
    </div>
  )
}
