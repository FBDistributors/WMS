import type { ReactNode } from 'react'

import { Button } from './button'
import { cn } from '../../lib/utils'

type EmptyStateProps = {
  icon?: ReactNode
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-2xl bg-white p-6',
        'dark:bg-slate-900',
        className
      )}
    >
      {icon ? <div className="text-slate-400 dark:text-slate-500">{icon}</div> : null}
      <div className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</div>
      {description ? (
        <div className="text-sm text-slate-500 text-center dark:text-slate-400">
          {description}
        </div>
      ) : null}
      {actionLabel && onAction ? (
        <Button variant="secondary" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}
