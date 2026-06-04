import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'

export type AdminTablePaginationProps = {
  offset: number
  pageSize: number
  /** Umumiy son noma'lum bo'lsa (masalan, keyingi sahifa bor-yo'qligi bilan) `to` + `rangeSuffix` ishlating. */
  total?: number
  to?: number
  rangeSuffix?: string
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
  to,
  rangeSuffix = '',
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
}: AdminTablePaginationProps) {
  const { t } = useTranslation(['receiving', 'common'])
  const from = offset + 1
  const rangeTo = to ?? (total != null ? Math.min(offset + pageSize, total) : offset + pageSize)
  if (total != null && total <= 0) return null
  if (total == null && rangeTo < from) return null

  const rangeLabel =
    total != null
      ? t('receiving:pagination_range', { from, to: rangeTo, total })
      : `${from}–${rangeTo}${rangeSuffix}`

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 dark:border-slate-700">
      <span className="text-sm text-slate-600 dark:text-slate-400">{rangeLabel}</span>
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
          disabled={nextDisabled ?? (total != null ? offset + pageSize >= total : false)}
          className="gap-1"
        >
          {t('receiving:next_page')}
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  )
}
