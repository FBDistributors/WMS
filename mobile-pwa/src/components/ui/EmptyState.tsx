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
    <div className={cn('flex flex-col items-center gap-3 rounded-2xl bg-white p-6', className)}>
      {icon ? <div className="text-slate-400">{icon}</div> : null}
      <div className="text-base font-semibold text-slate-900">{title}</div>
      {description ? (
        <div className="text-sm text-slate-500 text-center">{description}</div>
      ) : null}
      {actionLabel && onAction ? (
        <Button variant="secondary" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}
