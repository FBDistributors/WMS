import type { HTMLAttributes } from 'react'

import { cn } from '../../lib/utils'

type CardProps = HTMLAttributes<HTMLDivElement>

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm',
        'dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100',
        className
      )}
      {...props}
    />
  )
}
