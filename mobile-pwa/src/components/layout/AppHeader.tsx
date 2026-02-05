import type { ReactNode } from 'react'

import { ArrowLeft, RefreshCcw } from 'lucide-react'
import { Button } from '../ui/button'

type AppHeaderProps = {
  title: string
  onBack?: () => void
  onRefresh?: () => void
  actionSlot?: ReactNode
}

export function AppHeader({ title, onBack, onRefresh, actionSlot }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-10 -mx-4 mb-4 bg-slate-50/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {onBack ? (
            <Button variant="ghost" onClick={onBack} aria-label="Back">
              <ArrowLeft size={18} />
            </Button>
          ) : null}
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          {actionSlot}
          {onRefresh ? (
            <Button variant="ghost" onClick={onRefresh} aria-label="Refresh">
              <RefreshCcw size={18} />
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  )
}
