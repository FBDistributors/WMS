import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { AdminDataTableColumn } from '../AdminDataTable'
import type {
  ProductHistoryAdjustment,
  ProductHistoryPick,
  ProductHistoryReceiving,
} from '../../../services/productsApi'
import type { InventorySummaryWithLocationRow } from '../../../services/inventoryApi'

/** Sana + vaqt; noto'g'ri qiymat kelsa xom holicha ko'rsatiladi. */
export function formatHistoryDate(iso: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
  } catch {
    return iso
  }
}

/** Sinmaydigan qisqa qiymat (sana, kod, raqam). */
function nowrap(value: string) {
  return <span className="whitespace-nowrap">{value}</span>
}

function mono(value: string) {
  return <span className="whitespace-nowrap font-mono text-xs">{value}</span>
}

/** Uzun matn: kesiladi, to'liq qiymati sichqoncha ostida ko'rinadi. */
function truncated(value: string) {
  return (
    <span className="block truncate" title={value}>
      {value}
    </span>
  )
}

/**
 * Mahsulot tarixi jadvallarining ustunlari.
 *
 * Mahsulot va Qoldiq tafsilotlari sahifalari aynan shu jadvallarni ko'rsatadi —
 * ta'rif bir joyda tursin, aks holda ustun qo'shilganda bittasi eskirib qoladi.
 */
export function useProductHistoryColumns() {
  const { t } = useTranslation(['products'])

  return useMemo(() => {
    const receiving: AdminDataTableColumn<ProductHistoryReceiving>[] = [
      {
        id: 'date',
        header: t('products:history.date'),
        width: '11rem',
        cell: (row) => nowrap(formatHistoryDate(row.date)),
      },
      {
        id: 'received_by',
        header: t('products:history.received_by'),
        width: '12rem',
        cell: (row) => truncated(row.received_by ?? '—'),
      },
      {
        id: 'doc_no',
        header: t('products:history.doc_no'),
        width: '10rem',
        cell: (row) => truncated(row.doc_no),
      },
      {
        id: 'qty',
        header: t('products:history.qty'),
        width: '6rem',
        align: 'right',
        cell: (row) => nowrap(String(row.qty)),
      },
      {
        id: 'batch',
        header: t('products:history.batch'),
        width: '8rem',
        cell: (row) => truncated(row.batch),
      },
      {
        id: 'location',
        header: t('products:history.location'),
        cell: (row) => truncated(row.location_name ?? '—'),
      },
    ]

    const picks: AdminDataTableColumn<ProductHistoryPick>[] = [
      {
        id: 'date',
        header: t('products:history.date'),
        width: '11rem',
        cell: (row) => nowrap(formatHistoryDate(row.date)),
      },
      {
        id: 'picked_by',
        header: t('products:history.picked_by'),
        width: '12rem',
        cell: (row) => truncated(row.picked_by ?? '—'),
      },
      {
        id: 'location',
        header: t('products:history.location'),
        width: '8rem',
        cell: (row) => mono(row.location_code ?? '—'),
      },
      {
        id: 'order',
        header: t('products:history.order_number'),
        width: '7rem',
        cell: (row) => nowrap(row.order_number ?? row.document_doc_no ?? '—'),
      },
      {
        id: 'customer',
        header: t('products:history.customer'),
        cell: (row) => truncated(row.customer_name ?? '—'),
      },
      {
        id: 'qty',
        header: t('products:history.qty'),
        width: '6rem',
        align: 'right',
        cell: (row) => nowrap(String(row.qty)),
      },
    ]

    const adjustments: AdminDataTableColumn<ProductHistoryAdjustment>[] = [
      {
        id: 'date',
        header: t('products:history.date'),
        width: '11rem',
        cell: (row) => nowrap(formatHistoryDate(row.date)),
      },
      {
        id: 'adjusted_by',
        header: t('products:history.adjusted_by'),
        width: '14rem',
        cell: (row) => truncated(row.adjusted_by ?? '—'),
      },
      {
        id: 'location_code',
        header: t('products:history.location_code'),
        width: '10rem',
        cell: (row) => mono(row.location_code ?? '—'),
      },
      {
        id: 'qty_change',
        header: t('products:history.qty_change'),
        width: '8rem',
        align: 'right',
        cell: (row) => (
          <span
            className={`whitespace-nowrap font-medium ${
              row.qty_change < 0 ? 'text-amber-600 dark:text-amber-400' : ''
            }`}
          >
            {row.qty_change > 0 ? '+' : ''}
            {row.qty_change}
          </span>
        ),
      },
    ]

    const stock: AdminDataTableColumn<InventorySummaryWithLocationRow>[] = [
      {
        id: 'location_code',
        header: t('products:history.location_code'),
        width: '12rem',
        cell: (row) => mono(row.location_code),
      },
      {
        id: 'available',
        header: t('products:history.available'),
        width: '8rem',
        align: 'right',
        cell: (row) => nowrap(String(Math.round(Number(row.available)))),
      },
    ]

    return { receiving, picks, adjustments, stock }
  }, [t])
}
