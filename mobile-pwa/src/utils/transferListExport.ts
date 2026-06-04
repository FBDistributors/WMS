import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { TFunction } from 'i18next'

import type { WarehouseTransfer } from '../services/inventoryApi'
import { escapeCsvCell } from './receiptExport'
import { writeExcelJsFile } from './exportExcel'
import { applyUnicodeFontToPdf } from './jspdfUnicodeFont'
import { formatUnknownError } from '../lib/formatUnknownError'

export const MAX_TRANSFER_EXPORT_ROWS = 10_000

export type TransferListExportRow = {
  from: string
  to: string
  qty: number
  code: string
  barcode: string
  productName: string
  batch: string
  createdBy: string
  createdAt: string
}

export type TransferListExportLabels = {
  listTitle: string
  colFrom: string
  colTo: string
  colQty: string
  colCode: string
  colBarcode: string
  colProduct: string
  colBatch: string
  colCreatedBy: string
  colCreatedAt: string
  filterSummary: string
  rowsCount: string
}

export type TransferListExportContext = {
  title: string
  filterSummaryLines: string[]
  rows: TransferListExportRow[]
  labels: TransferListExportLabels
}

export class TransferExportTooLargeError extends Error {
  constructor() {
    super('TRANSFER_EXPORT_TOO_LARGE')
    this.name = 'TransferExportTooLargeError'
  }
}

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export function transferListExportBaseName(): string {
  const day = new Date().toISOString().slice(0, 10)
  return `warehouse_transfers_${day}`
}

export function formatTransferListDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function filterTransfersBySearch(
  rows: WarehouseTransfer[],
  q: string
): WarehouseTransfer[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter((row) => {
    const product = [row.product_code, row.product_name, row.product_barcode]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    const batch = (row.batch ?? row.lot_id ?? '').toString().toLowerCase()
    const fromLoc = (row.from_location_code ?? row.from_location_id ?? '').toString().toLowerCase()
    const toLoc = (row.to_location_code ?? row.to_location_id ?? '').toString().toLowerCase()
    const who = (row.created_by_username ?? row.created_by_user_id ?? '').toString().toLowerCase()
    return (
      product.includes(needle) ||
      batch.includes(needle) ||
      fromLoc.includes(needle) ||
      toLoc.includes(needle) ||
      who.includes(needle)
    )
  })
}

export function buildTransferListExportRows(rows: WarehouseTransfer[]): TransferListExportRow[] {
  return rows.map((row) => ({
    from: row.from_location_code ?? row.from_location_id,
    to: row.to_location_code ?? row.to_location_id,
    qty: Math.round(Number(row.qty)),
    code: row.product_code ?? '—',
    barcode: row.product_barcode ?? '—',
    productName: row.product_name ?? row.product_id,
    batch: row.batch ?? row.lot_id ?? '—',
    createdBy: row.created_by_username ?? row.created_by_user_id ?? '—',
    createdAt: formatTransferListDate(row.created_at),
  }))
}

export function buildTransferListExportLabels(t: TFunction): TransferListExportLabels {
  return {
    listTitle: t('admin:movement_page.export_list_title'),
    colFrom: t('admin:movement_page.from'),
    colTo: t('admin:movement_page.to'),
    colQty: t('admin:movement_page.qty'),
    colCode: t('admin:movement_page.col_code'),
    colBarcode: t('admin:movement_page.col_barcode'),
    colProduct: t('admin:movement_page.col_product'),
    colBatch: t('inventory:columns.lot'),
    colCreatedBy: t('inventory:columns.created_by'),
    colCreatedAt: t('inventory:columns.created_at'),
    filterSummary: t('admin:movement_page.export_filter_applied'),
    rowsCount: t('admin:movement_page.export_rows_count'),
  }
}

function headerRow(labels: TransferListExportLabels): string[] {
  return [
    labels.colFrom,
    labels.colTo,
    labels.colQty,
    labels.colCode,
    labels.colBarcode,
    labels.colProduct,
    labels.colBatch,
    labels.colCreatedBy,
    labels.colCreatedAt,
  ]
}

function dataRowValues(row: TransferListExportRow): (string | number)[] {
  return [
    row.from,
    row.to,
    row.qty,
    row.code,
    row.barcode,
    row.productName,
    row.batch,
    row.createdBy,
    row.createdAt,
  ]
}

function buildSheetAoA(ctx: TransferListExportContext): (string | number)[][] {
  const { labels, filterSummaryLines, rows } = ctx
  const meta: (string | number)[][] = [
    [labels.listTitle],
    [labels.filterSummary, filterSummaryLines.join('; ') || '—'],
    [labels.rowsCount, rows.length],
    [],
    headerRow(labels),
  ]
  return [...meta, ...rows.map((row) => dataRowValues(row))]
}

export async function downloadTransferListExcel(ctx: TransferListExportContext): Promise<void> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Transfers')
  const aoa = buildSheetAoA(ctx)
  for (const row of aoa) {
    ws.addRow(row)
  }
  const buffer = await wb.xlsx.writeBuffer()
  await writeExcelJsFile(buffer, `${transferListExportBaseName()}.xlsx`)
}

export function downloadTransferListCsv(ctx: TransferListExportContext): void {
  const aoa = buildSheetAoA(ctx)
  const csv = aoa.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  downloadBlob(`${transferListExportBaseName()}.csv`, blob)
}

export async function downloadTransferListPdf(ctx: TransferListExportContext): Promise<void> {
  const { labels, filterSummaryLines, rows } = ctx
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const fontFamily = await applyUnicodeFontToPdf(doc)

  doc.setFontSize(14)
  doc.text(labels.listTitle, 14, 16)
  doc.setFontSize(9)
  let y = 24
  const metaLines = [
    `${labels.filterSummary}: ${filterSummaryLines.join('; ') || '—'}`,
    `${labels.rowsCount}: ${rows.length}`,
  ]
  for (const line of metaLines) {
    doc.text(line, 14, y)
    y += 5
  }

  const tableFont = { font: fontFamily, fontStyle: 'normal' as const }

  autoTable(doc, {
    startY: y + 4,
    head: [headerRow(labels)],
    body: rows.map((row) => dataRowValues(row).map(String)),
    styles: { fontSize: 7, cellPadding: 1.5, ...tableFont },
    headStyles: { fillColor: [30, 64, 175], ...tableFont },
    bodyStyles: tableFont,
    margin: { left: 10, right: 10 },
  })

  doc.save(`${transferListExportBaseName()}.pdf`)
}

export async function runTransferListExport(
  kind: 'excel' | 'csv' | 'pdf',
  ctx: TransferListExportContext
): Promise<void> {
  if (ctx.rows.length > MAX_TRANSFER_EXPORT_ROWS) {
    throw new TransferExportTooLargeError()
  }
  try {
    if (kind === 'excel') {
      await downloadTransferListExcel(ctx)
    } else if (kind === 'csv') {
      downloadTransferListCsv(ctx)
    } else {
      await downloadTransferListPdf(ctx)
    }
  } catch (err) {
    throw new Error(formatUnknownError(err) || 'Export failed')
  }
}
