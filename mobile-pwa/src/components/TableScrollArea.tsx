import type { ReactNode } from 'react'
import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from './ui/button'

type TableScrollAreaProps = {
  children: ReactNode
  className?: string
}

export function TableScrollArea({ children, className }: TableScrollAreaProps) {
  const { t } = useTranslation('common')
  const scrollRef = useRef<HTMLDivElement>(null)

  return (
    <>
      <div
        ref={scrollRef}
        className={`min-w-0 overflow-x-scroll overflow-y-hidden ${className ?? ''}`}
        style={{ scrollbarGutter: 'stable' }}
      >
        {children}
      </div>
      <div className="flex items-center justify-center gap-3 border-t border-slate-200 bg-slate-50/80 py-2.5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        <Button
          variant="ghost"
          className="p-2"
          onClick={() => scrollRef.current?.scrollBy({ left: -200 })}
          aria-label={t('scroll_left')}
        >
          <ChevronLeft size={18} />
        </Button>
        <span>{t('scroll_horizontal')}</span>
        <Button
          variant="ghost"
          className="p-2"
          onClick={() => scrollRef.current?.scrollBy({ left: 200 })}
          aria-label={t('scroll_right')}
        >
          <ChevronRight size={18} />
        </Button>
      </div>
    </>
  )
}
