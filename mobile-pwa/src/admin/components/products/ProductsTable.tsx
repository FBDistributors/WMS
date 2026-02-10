import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '../../../components/ui/badge'
import { Card } from '../../../components/ui/card'
import type { Product } from '../../../services/productsApi'

type ProductRow = Product & {
  category?: string
  brand?: string
  group?: string
  manufacturer?: string
  created_by?: string
  article_code?: string
  internal_id?: string
  qty_cases?: number
  qty_units?: number
  on_hand_total?: number
  available_total?: number
  quantity_summary?: string | number
  photo_url?: string
  photoUrl?: string
}

type Column = {
  id: string
  label: string
  className?: string
  render: (item: ProductRow) => ReactNode
}

type ProductsTableProps = {
  items: ProductRow[]
  columnOrder: string[]
  visibleColumns: string[]
  onRowClick?: (item: ProductRow) => void
  onInventoryClick?: (item: ProductRow) => void
}

const statusVariant = (isActive: boolean) => (isActive ? 'success' : 'neutral')

export function ProductsTable({
  items,
  columnOrder,
  visibleColumns,
  onRowClick,
  onInventoryClick,
}: ProductsTableProps) {
  const { t } = useTranslation(['products', 'common'])

  const columns = useMemo<Column[]>(
    () => [
      {
        id: 'sku',
        label: t('products:columns.sku'),
        className: 'w-[140px] font-medium',
        render: (item) => item.sku || '—',
      },
      {
        id: 'photo',
        label: t('products:columns.photo'),
        className: 'w-[80px]',
        render: (item) => {
          const src = item.photo_url ?? item.photoUrl
          return (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800">
              {src ? (
                <img
                  src={src}
                  alt={item.name}
                  loading="lazy"
                  decoding="async"
                  className="h-10 w-10 rounded-lg object-cover"
                />
              ) : (
                <Package size={18} />
              )}
            </div>
          )
        },
      },
      {
        id: 'name',
        label: t('products:columns.name'),
        className: 'min-w-[240px] font-semibold text-slate-900 dark:text-slate-100',
        render: (item) => item.name || '—',
      },
      {
        id: 'category',
        label: t('products:columns.category'),
        className: 'min-w-[180px] text-slate-600 dark:text-slate-300',
        render: (item) => item.category || '—',
      },
      {
        id: 'brand',
        label: t('products:columns.brand'),
        className: 'min-w-[160px] text-slate-600 dark:text-slate-300',
        render: (item) => item.brand_display_name || item.brand_name || item.brand || '—',
      },
      {
        id: 'status',
        label: t('products:columns.status'),
        className: 'w-[140px]',
        render: (item) => (
          <Badge variant={statusVariant(item.is_active)}>
            {item.is_active ? t('common:status.active') : t('common:status.inactive')}
          </Badge>
        ),
      },
      {
        id: 'quantity',
        label: t('products:columns.quantity'),
        className: 'w-[140px] text-slate-600 dark:text-slate-300',
        render: (item) => {
          const summary = item.quantity_summary ?? '—'
          return <span>{summary}</span>
        },
      },
      {
        id: 'on_hand_total',
        label: t('products:columns.on_hand_total'),
        className: 'w-[140px] text-slate-600 dark:text-slate-300',
        render: (item) => item.on_hand_total ?? '—',
      },
      {
        id: 'available_total',
        label: t('products:columns.available_total'),
        className: 'w-[140px] text-slate-600 dark:text-slate-300',
        render: (item) => item.available_total ?? '—',
      },
      {
        id: 'inventory_link',
        label: t('products:columns.inventory'),
        className: 'w-[160px]',
        render: (item) => (
          <button
            type="button"
            className="text-sm font-semibold text-blue-600 hover:text-blue-700"
            onClick={(event) => {
              event.stopPropagation()
              onInventoryClick?.(item)
            }}
          >
            {t('products:view_inventory')}
          </button>
        ),
      },
      {
        id: 'created_by',
        label: t('products:columns.created_by'),
        className: 'min-w-[160px] text-slate-600 dark:text-slate-300',
        render: (item) => item.created_by || '—',
      },
      {
        id: 'article_code',
        label: t('products:columns.article_code'),
        className: 'min-w-[160px] text-slate-600 dark:text-slate-300',
        render: (item) => item.article_code || '—',
      },
      {
        id: 'barcode',
        label: t('products:columns.barcode'),
        className: 'min-w-[180px] text-slate-600 dark:text-slate-300',
        render: (item) => {
          const primary = item.barcode ?? item.barcodes?.[0]
          if (!primary) return '—'
          const extra = item.barcodes && item.barcodes.length > 1 ? ` +${item.barcodes.length - 1}` : ''
          return `${primary}${extra}`
        },
      },
      {
        id: 'internal_id',
        label: t('products:columns.internal_id'),
        className: 'min-w-[140px] text-slate-600 dark:text-slate-300',
        render: (item) => item.internal_id || item.id || '—',
      },
      {
        id: 'manufacturer',
        label: t('products:columns.manufacturer'),
        className: 'min-w-[160px] text-slate-600 dark:text-slate-300',
        render: (item) => item.manufacturer || '—',
      },
      {
        id: 'group',
        label: t('products:columns.group'),
        className: 'min-w-[160px] text-slate-600 dark:text-slate-300',
        render: (item) => item.group || '—',
      },
      {
        id: 'qty_cases',
        label: t('products:columns.qty_cases'),
        className: 'w-[140px] text-slate-600 dark:text-slate-300',
        render: (item) => item.qty_cases ?? '—',
      },
      {
        id: 'qty_units',
        label: t('products:columns.qty_units'),
        className: 'w-[140px] text-slate-600 dark:text-slate-300',
        render: (item) => item.qty_units ?? '—',
      },
    ],
    [t]
  )

  const columnsById = useMemo(() => new Map(columns.map((col) => [col.id, col])), [columns])
  const visibleSet = useMemo(() => new Set(visibleColumns), [visibleColumns])

  const orderedColumns = useMemo(() => {
    const base = columnOrder.length > 0 ? columnOrder : columns.map((col) => col.id)
    const unique = base.filter((id) => columnsById.has(id))
    const missing = columns.map((col) => col.id).filter((id) => !unique.includes(id))
    return [...unique, ...missing]
  }, [columnOrder, columns, columnsById])

  const displayColumns = useMemo(
    () => orderedColumns.filter((id) => visibleSet.has(id)).map((id) => columnsById.get(id)!),
    [columnsById, orderedColumns, visibleSet]
  )

  if (displayColumns.length === 0) {
    return (
      <Card className="flex items-center justify-center py-10 text-sm text-slate-500">
        {t('products:table.no_columns')}
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950/40 dark:text-slate-400">
            <tr>
              {displayColumns.map((column) => (
                <th
                  key={column.id}
                  className={`border-b border-slate-200 px-4 py-3 text-left font-semibold dark:border-slate-800 ${column.className ?? ''}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/40"
                role={onRowClick ? 'button' : undefined}
                tabIndex={onRowClick ? 0 : -1}
                onClick={() => onRowClick?.(item)}
                onKeyDown={(event) => {
                  if (!onRowClick) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onRowClick(item)
                  }
                }}
              >
                {displayColumns.map((column) => (
                  <td
                    key={`${item.id}-${column.id}`}
                    className={`border-b border-slate-100 px-4 py-3 align-middle dark:border-slate-800 ${column.className ?? ''}`}
                  >
                    {column.render(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
