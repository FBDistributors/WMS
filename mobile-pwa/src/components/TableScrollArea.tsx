import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type TableScrollAreaProps = {
  children: ReactNode
  className?: string
}

export function TableScrollArea({ children, className }: TableScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const [contentWidth, setContentWidth] = useState(0)
  const isSyncing = useRef(false)

  // Jadval kontenti kengligini strip uchun yangilash
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const updateWidth = () => {
      setContentWidth(el.scrollWidth)
    }
    updateWidth()
    const ro = new ResizeObserver(updateWidth)
    ro.observe(el)
    return () => ro.disconnect()
  }, [children])

  // Jadval va sticky strip scrollLeft ni sinxronlash
  useEffect(() => {
    const table = scrollRef.current
    const strip = stripRef.current
    if (!table || !strip) return

    const syncTableToStrip = () => {
      if (isSyncing.current) return
      isSyncing.current = true
      strip.scrollLeft = table.scrollLeft
      requestAnimationFrame(() => {
        isSyncing.current = false
      })
    }
    const syncStripToTable = () => {
      if (isSyncing.current) return
      isSyncing.current = true
      table.scrollLeft = strip.scrollLeft
      requestAnimationFrame(() => {
        isSyncing.current = false
      })
    }

    table.addEventListener('scroll', syncTableToStrip)
    strip.addEventListener('scroll', syncStripToTable)
    return () => {
      table.removeEventListener('scroll', syncTableToStrip)
      strip.removeEventListener('scroll', syncStripToTable)
    }
  }, [])

  const stripEl = (
    <div
      ref={stripRef}
      className="fixed bottom-0 left-0 right-0 z-50 flex h-5 min-w-0 items-center overflow-x-auto overflow-y-hidden border-t border-slate-300 bg-slate-200 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] dark:border-slate-600 dark:bg-slate-700 dark:shadow-[0_-2px_8px_rgba(0,0,0,0.3)]"
      aria-hidden
      style={{ scrollbarGutter: 'stable' }}
    >
      <div style={{ width: contentWidth, height: 1, minWidth: '100%', flexShrink: 0 }} />
    </div>
  )

  return (
    <div className="min-w-0">
      <div
        ref={scrollRef}
        className={`scrollbar-hide overflow-x-scroll overflow-y-hidden ${className ?? ''}`}
      >
        {children}
      </div>
      {typeof document !== 'undefined' && createPortal(stripEl, document.body)}
    </div>
  )
}
