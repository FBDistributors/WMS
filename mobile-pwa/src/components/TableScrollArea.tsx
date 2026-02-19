import type { ReactNode } from 'react'

type TableScrollAreaProps = {
  children: ReactNode
  className?: string
  /** Parent handles overflow (both x,y) — scrollbar ko'rinadi */
  inline?: boolean
}

/** Mobil/planshet: gorizontal scroll qilib, jadval siqilmasdan qoladi. */
export function TableScrollArea({ children, className, inline }: TableScrollAreaProps) {
  if (inline) {
    return <div className={`min-w-0 ${className ?? ''}`}>{children}</div>
  }
  return (
    <div className="min-w-0 -mx-1 px-1 md:mx-0 md:px-0">
      <div
        className={`overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable] overscroll-x-contain touch-pan-x ${className ?? ''}`}
        style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
      >
        {children}
      </div>
    </div>
  )
}
