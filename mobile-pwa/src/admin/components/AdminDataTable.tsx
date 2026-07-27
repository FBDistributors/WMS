import type { ReactNode } from 'react'

import { TableScrollArea } from '../../components/TableScrollArea'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import {
  adminDataTableClass,
  adminTableBodyRowClass,
  adminTableTdClass,
  adminTableThClass,
  ADMIN_TABLE_HEAD_CLASS,
  ADMIN_TABLE_HEAD_ROW_CLASS,
} from './AdminDataTable.styles'

export type AdminDataTableColumn<T> = {
  id: string
  header: ReactNode
  /** CSS width, masalan `8rem` yoki `120px` */
  width?: string
  align?: 'left' | 'right'
  cell: (row: T, rowIndex: number) => ReactNode
}

export type AdminDataTableProps<T> = {
  columns: AdminDataTableColumn<T>[]
  rows: T[]
  getRowKey: (row: T, rowIndex: number) => string
  /** Masalan `min-w-[64rem]` */
  minWidth?: string
  onRowClick?: (row: T) => void
  zebra?: boolean
  /** Ma'lumot yangilanganda jadval yashirilmaydi, ustiga overlay */
  refreshing?: boolean
  refreshingLabel?: string
  /**
   * Masalan `max-h-[65vh]` — shundan uzun ro'yxat jadval ichida aylantiriladi.
   *
   * Yopishqoq sarlavha shu bilan birga ishlaydi: `TableScrollArea` da
   * `overflow-y-hidden` bor, ya'ni sticky element unga bog'lanib qoladi va
   * sahifa aylanganda qimirlamaydi. Balandlik berilganda o'z scroll qutisi
   * yaratiladi. Qatorlar kam bo'lsa quti kontent bo'yicha qisqaradi — hech narsa
   * o'zgarmaydi.
   */
  maxHeight?: string
  /** Sarlavha aylantirishda tepada qolsin (`maxHeight` bilan birga). */
  stickyHeader?: boolean
}

/**
 * Admin panelidagi standart jadval (Qabul / Ko'chirish ko'rinishi).
 * Yangi ro'yxat jadvallari uchun shu komponentdan foydalaning.
 */
export function AdminDataTable<T>({
  columns,
  rows,
  getRowKey,
  minWidth = 'min-w-[48rem]',
  onRowClick,
  zebra = true,
  refreshing = false,
  refreshingLabel,
  maxHeight,
  stickyHeader = false,
}: AdminDataTableProps<T>) {
  const thExtra = stickyHeader
    ? ' sticky top-0 z-10 bg-slate-50 dark:bg-slate-800'
    : ''
  const table = (
    <table className={adminDataTableClass(minWidth)}>
          {columns.some((c) => c.width) ? (
            <colgroup>
              {columns.map((col) => (
                <col key={col.id} style={col.width ? { width: col.width } : undefined} />
              ))}
            </colgroup>
          ) : null}
          <thead className={ADMIN_TABLE_HEAD_CLASS}>
            <tr className={ADMIN_TABLE_HEAD_ROW_CLASS}>
              {columns.map((col) => (
                <th key={col.id} className={adminTableThClass(col.align ?? 'left') + thExtra}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={getRowKey(row, rowIndex)}
                className={adminTableBodyRowClass(rowIndex, {
                  clickable: Boolean(onRowClick),
                  zebra,
                })}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td key={col.id} className={adminTableTdClass(col.align ?? 'left')}>
                    {col.cell(row, rowIndex)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
    </table>
  )

  return (
    <div className="relative">
      {refreshing ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center bg-white/40 pt-8 dark:bg-slate-950/40">
          <LoadingOverlay label={refreshingLabel} />
        </div>
      ) : null}
      {maxHeight ? (
        <div
          className={`min-w-0 overflow-auto overscroll-contain [scrollbar-gutter:stable] ${maxHeight}`}
        >
          {table}
        </div>
      ) : (
        <TableScrollArea>{table}</TableScrollArea>
      )}
    </div>
  )
}
