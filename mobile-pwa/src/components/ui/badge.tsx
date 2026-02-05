import type { HTMLAttributes } from 'react'

import { cn } from '../../lib/utils'

type BadgeVariant = 'neutral' | 'primary' | 'success' | 'danger'

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant
}

const badgeStyles: Record<BadgeVariant, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  primary: 'bg-blue-100 text-blue-700',
  success: 'bg-green-100 text-green-700',
  danger: 'bg-red-100 text-red-700',
}

export function Badge({ className, variant = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide',
        badgeStyles[variant],
        className
      )}
      {...props}
    />
  )
}
