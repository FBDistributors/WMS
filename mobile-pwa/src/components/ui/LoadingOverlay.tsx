/**
 * Yuklanishda orqa fonni xiralashtiruvchi va markazda spinner ko'rsatadigan overlay.
 * SmartUp yuklash uslubida: backdrop dim + blur, markazda Loader2.
 * Parent container position: relative bo'lishi kerak (yoki fullScreen=true da fixed).
 */
import { PageSpinner } from './PageSpinner'

type LoadingOverlayProps = {
  label?: string
  /** To'liq ekran overlay (auth, sahifa yuklanish) — fixed inset-0 */
  fullScreen?: boolean
  className?: string
}

export function LoadingOverlay({
  label,
  fullScreen = false,
  className = '',
}: LoadingOverlayProps) {
  return (
    <div
      className={
        fullScreen
          ? `fixed inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm ${className}`
          : `absolute inset-0 z-10 flex items-center justify-center bg-white/70 dark:bg-slate-900/60 backdrop-blur-[2px] ${className}`
      }
      role="status"
      aria-label={label ?? 'Loading'}
    >
      <PageSpinner label={label} />
    </div>
  )
}
