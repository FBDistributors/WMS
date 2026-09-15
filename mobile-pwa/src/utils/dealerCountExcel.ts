import type { TFunction } from 'i18next'
import * as XLSX from 'xlsx'

import type { DealerCountOut } from '../services/dealerCountsApi'
import { writeExcelFile } from './exportExcel'

function fmtTime(v: string | null | undefined): string {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

/**
 * Diller sanovini Excel'ga: har qator — mahsulot, joy, Smartup soni, sanalgan son,
 * kiritishlar ("12 + 5"), kim va qachon sanagani. Sanov va ko'rish sahifalari bir xil faylni beradi.
 */
export async function exportDealerCountExcel(item: DealerCountOut, t: TFunction): Promise<void> {
  const rows = item.lines.map((ln) => ({
    [t('admin:dealer_counts.col_seq')]: ln.seq,
    SKU: ln.sku ?? '',
    [t('admin:dealer_counts.col_product')]: ln.product_name ?? t('admin:dealer_counts.unknown_barcode'),
    [t('admin:dealer_counts.col_barcode')]: ln.scanned_barcode,
    [t('admin:dealer_counts.col_location')]: ln.location_code ?? '',
    [t('admin:dealer_counts.col_snapshot')]: ln.snapshot_qty == null ? '' : Number(ln.snapshot_qty),
    [t('admin:dealer_counts.col_qty')]: ln.qty == null ? '' : Number(ln.qty),
    [t('admin:dealer_counts.col_entries')]: ln.entries_brief ?? '',
    [t('admin:dealer_counts.col_state')]: ln.counted_at
      ? t('admin:dealer_counts.state_counted')
      : ln.qty == null
        ? t('admin:dealer_counts.state_uncounted')
        : t('admin:dealer_counts.state_zeroed'),
    [t('admin:dealer_counts.col_expiry')]: ln.expiry_date ? ln.expiry_date.slice(0, 7) : '',
    [t('admin:dealer_counts.col_counted_by')]: ln.counted_by_name ?? '',
    [t('admin:dealer_counts.col_counted_at')]: fmtTime(ln.counted_at),
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sanov')
  await writeExcelFile(wb, `diller_sanov_${item.dealer_org_id}_${item.created_at.slice(0, 10)}.xlsx`)
}
