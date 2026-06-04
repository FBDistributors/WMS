import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'

export type AdminTablePaginationProps = {
  offset: number
  pageSize: number
  total: number
  onPrev: () => void
  onNext: () => void
  prevDisabled?: boolean
  nextDisabled?: boolean
}

/** Qabul/Ko'chirish bilan bir xil pagination paneli. */
export function AdminTablePagination({
  offset,
  pageSize,
  total,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
}: AdminTablePaginationProps) {
  const { t } = useTranslation(['receiving', 'common'])
  if (total <= 0) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 dark:border-slate-700">
      <span className="text-sm text-slate-600 dark:text-slate-400">
        {t('receiving:pagination_range', {
          from: offset + 1,
          to: Math.min(offset + pageSize, total),
          total,
        })}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={onPrev}
          disabled={prevDisabled ?? offset === 0}
          className="gap-1"
        >
          <ChevronLeft size={16} />
          {t('receiving:prev_page')}
        </Button>
        <Button
          variant="outline"
          onClick={onNext}
          disabled={nextDisabled ?? offset + pageSize >= total}
          className="gap-1"
        >
          {t('receiving:next_page')}
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  )
}
