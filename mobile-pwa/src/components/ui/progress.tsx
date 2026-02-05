import type { HTMLAttributes } from 'react'

import { cn } from '../../lib/utils'

type ProgressProps = HTMLAttributes<HTMLDivElement> & {
  value: number
}

export function Progress({ className, value, ...props }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div
      className={cn('h-2 w-full rounded-full bg-slate-200', className)}
      {...props}
    >
      <div
        className="h-full rounded-full bg-blue-600 transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
