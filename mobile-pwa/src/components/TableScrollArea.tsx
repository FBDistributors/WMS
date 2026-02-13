import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

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

  return (
    <div className="min-w-0">
      <div
        ref={scrollRef}
        className={`overflow-x-scroll overflow-y-hidden ${className ?? ''}`}
      >
        {children}
      </div>
      {/* Ekranning eng pastida gorizontal scrollbar — fixed pastga */}
      <div
        ref={stripRef}
        className="fixed bottom-0 left-0 right-0 z-10 h-3 min-w-0 overflow-x-scroll overflow-y-hidden border-t border-slate-200 bg-slate-100/95 dark:border-slate-700 dark:bg-slate-800/95"
        aria-hidden
      >
        <div style={{ width: contentWidth, height: 1, minWidth: '100%' }} />
      </div>
    </div>
  )
}
