/** Admin ro'yxat jadvallari (Qabul / Ko'chirish) — standart klasslar. */

export const ADMIN_TABLE_TH_CLASS =
  'text-left py-2.5 px-3 text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300 align-middle whitespace-nowrap'

export const ADMIN_TABLE_TD_CLASS =
  'py-2.5 px-3 align-middle text-sm text-slate-900 dark:text-slate-100'

export const ADMIN_TABLE_HEAD_ROW_CLASS = 'border-b border-slate-200 dark:border-slate-700'

export const ADMIN_TABLE_HEAD_CLASS = 'bg-slate-50 dark:bg-slate-800/60'

export function adminDataTableClass(minWidth = 'min-w-[48rem]'): string {
  return `w-full ${minWidth} border-collapse text-sm table-fixed`
}

export function adminTableThClass(align: 'left' | 'right' = 'left'): string {
  return `${ADMIN_TABLE_TH_CLASS}${align === 'right' ? ' text-right' : ''}`
}

export function adminTableTdClass(align: 'left' | 'right' = 'left'): string {
  return `${ADMIN_TABLE_TD_CLASS}${align === 'right' ? ' text-right' : ''}`
}

export function adminTableBodyRowClass(
  rowIndex: number,
  options?: { clickable?: boolean; zebra?: boolean }
): string {
  const clickable = options?.clickable ?? false
  const zebra = options?.zebra ?? true
  return [
    'border-b border-slate-100 dark:border-slate-800',
    clickable
      ? 'cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50'
      : '',
    zebra && rowIndex % 2 === 1 ? 'bg-slate-50/50 dark:bg-slate-800/30' : '',
  ]
    .filter(Boolean)
    .join(' ')
}
