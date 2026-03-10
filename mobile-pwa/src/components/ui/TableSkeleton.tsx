/**
 * Jadval yuklanayotganda ko'rsatiladigan skeleton.
 * Admin sahifalarda API ma'lumot yuklanayotganini animatsiya bilan ko'rsatish uchun.
 */
type TableSkeletonProps = {
  /** Qatorlar soni (default 6) */
  rows?: number
  /** Ustunlar soni (default 4) */
  columns?: number
  /** Qator balandligi (Tailwind class yoki number px). Default h-12 */
  rowHeight?: string
  className?: string
}

export function TableSkeleton({
  rows = 6,
  columns = 4,
  rowHeight = 'h-12',
  className = '',
}: TableSkeletonProps) {
  return (
    <div className={`w-full min-w-0 ${className}`}>
      <div className="space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className={`flex w-full gap-2 ${rowHeight} items-center rounded-xl bg-slate-200/80 dark:bg-slate-800/80 px-3`}
          >
            {Array.from({ length: columns }, (_, j) => (
              <div
                key={j}
                className="h-5 flex-1 min-w-0 animate-pulse rounded-lg bg-slate-300 dark:bg-slate-700"
                style={{ maxWidth: j === columns - 1 ? '20%' : undefined }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
