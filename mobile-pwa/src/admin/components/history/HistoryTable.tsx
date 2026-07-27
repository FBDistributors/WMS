import { AdminDataTable, type AdminDataTableColumn } from '../AdminDataTable'

type HistoryTableProps<T> = {
  columns: AdminDataTableColumn<T>[]
  rows: T[] | null | undefined
  loading?: boolean
  emptyText: string
  getRowKey?: (row: T, index: number) => string
  /** Masalan `min-w-[60rem]` — ustunlar siqilmasin, kerak bo'lsa scroll bo'lsin. */
  minWidth?: string
  /** Uzun ro'yxat jadval ichida aylantiriladi; qatorlar kam bo'lsa ta'siri yo'q. */
  maxHeight?: string
}

/**
 * Mahsulot tarixi tablaridagi jadval: yuklanish / bo'sh holat / jadval.
 *
 * `AdminDataTable` ustidagi yupqa qatlam — u yerda `table-fixed` va gorizontal
 * scroll bor, ya'ni uzun matn qo'shni ustunlarni siqib qo'ymaydi.
 */
export function HistoryTable<T>({
  columns,
  rows,
  loading = false,
  emptyText,
  getRowKey,
  minWidth,
  maxHeight = 'max-h-[65vh]',
}: HistoryTableProps<T>) {
  if (loading) {
    return <div className="h-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
  }
  if (!rows || rows.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{emptyText}</p>
  }
  return (
    <AdminDataTable
      columns={columns}
      rows={rows}
      getRowKey={getRowKey ?? ((_row, index) => String(index))}
      minWidth={minWidth}
      maxHeight={maxHeight}
      stickyHeader
      zebra={false}
    />
  )
}
