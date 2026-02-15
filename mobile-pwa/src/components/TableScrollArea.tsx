import type { ReactNode } from 'react'

type TableScrollAreaProps = {
  children: ReactNode
  className?: string
  /** Parent handles overflow (both x,y) — scrollbar ko'rinadi */
  inline?: boolean
}

export function TableScrollArea({ children, className, inline }: TableScrollAreaProps) {
  if (inline) {
    return <div className={`min-w-0 ${className ?? ''}`}>{children}</div>
  }
  return (
    <div className="min-w-0">
      <div
        className={`overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable] ${className ?? ''}`}
      >
        {children}
      </div>
    </div>
  )
}
