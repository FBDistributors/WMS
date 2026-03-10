/**
 * Yuklanmoqda / refresh bo'layotganini ko'rsatish uchun kichik badge.
 * Jadval yoki sahifa orqa fonda yangilanganda foydalanuvchiga signal beradi.
 */
import { Loader2 } from 'lucide-react'

type LoadingBadgeProps = {
  label?: string
  className?: string
}

export function LoadingBadge({ label = 'Yuklanmoqda', className = '' }: LoadingBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900/50 dark:text-blue-200 ${className}`}
    >
      <Loader2 size={14} className="animate-spin shrink-0" />
      {label}
    </span>
  )
}
