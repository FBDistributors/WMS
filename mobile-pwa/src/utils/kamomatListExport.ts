import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { TFunction } from 'i18next'

import type { InventoryMovement } from '../services/inventoryApi'
import { escapeCsvCell } from './receiptExport'
import { writeExcelJsFile } from './exportExcel'
import { applyUnicodeFontToPdf } from './jspdfUnicodeFont'
import { formatUnknownError } from '../lib/formatUnknownError'

export const MAX_KAMOMAT_EXPORT_ROWS = 10_000

export type KamomatListExportRow = {
  movementType: string
  qty: number
  code: string
  barcode: string
  productName: string
  batch: string
  location: string
  createdBy: string
  createdAt: string
}

export type KamomatListExportLabels = {
  listTitle: string
  colMovement: string
  colQty: string
  colCode: string
  colBarcode: string
  colProduct: string
  colBatch: string
  colLocation: string
  colCreatedBy: string
  colCreatedAt: string
  filterSummary: string
  rowsCount: string
}

export type KamomatListExportContext = {
  title: string
  filterSummaryLines: string[]
  rows: KamomatListExportRow[]
  labels: KamomatListExportLabels
}

export class KamomatExportTooLargeError extends Error {
  constructor() {
    super('KAMOMAT_EXPORT_TOO_LARGE')
    this.name = 'KamomatExportTooLargeError'
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

export function kamomatListExportBaseName(): string {
  const day = new Date().toISOString().slice(0, 10)
  return `inventory_history_${day}`
}

export function formatKamomatListDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

export function movementTypeLabelForExport(row: InventoryMovement, t: TFunction): string {
  if (row.reason_code === 'inventory_overage') {
    return t('admin:movement_page.reason_overage')
  }
  if (row.reason_code === 'inventory_shortage') {
    return t('admin:movement_page.reason_shortage')
  }
  return t(`inventory:movement_types.${row.movement_type}`, row.movement_type)
}

export function filterKamomatBySearch(rows: InventoryMovement[], q: string): InventoryMovement[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter((row) => {
    const code = (row.product_code ?? '').toLowerCase()
    const barcode = (row.product_barcode ?? '').toLowerCase()
    const name = (row.product_name ?? '').toLowerCase()
    const batch = (row.batch ?? row.lot_id ?? '').toString().toLowerCase()
    const location = (row.location_code ?? row.location_id ?? '').toString().toLowerCase()
    const who = (row.created_by_username ?? row.created_by_user_id ?? '').toString().toLowerCase()
    return (
      code.includes(needle) ||
      barcode.includes(needle) ||
      name.includes(needle) ||
      batch.includes(needle) ||
      location.includes(needle) ||
      who.includes(needle)
    )
  })
}

export function buildKamomatListExportRows(
  rows: InventoryMovement[],
  t: TFunction
): KamomatListExportRow[] {
  return rows.map((row) => {
    const n = Math.round(Number(row.qty_change))
    return {
      movementType: movementTypeLabelForExport(row, t),
      qty: n,
      code: row.product_code ?? '—',
      barcode: row.product_barcode ?? '—',
      productName: row.product_name ?? row.product_id,
      batch: row.batch ?? row.lot_id ?? '—',
      location: row.location_code ?? row.location_id ?? '—',
      createdBy: row.created_by_username ?? row.created_by_user_id ?? '—',
      createdAt: formatKamomatListDate(row.created_at),
    }
  })
}

export function buildKamomatListExportLabels(t: TFunction): KamomatListExportLabels {
  return {
    listTitle: t('kamomat:export.list_title'),
    colMovement: t('inventory:columns.movement_type'),
    colQty: t('inventory:columns.qty'),
    colCode: t('inventory:columns.code'),
    colBarcode: t('inventory:columns.barcode'),
    colProduct: t('inventory:columns.product'),
    colBatch: t('inventory:columns.lot'),
    colLocation: t('inventory:columns.location'),
    colCreatedBy: t('inventory:columns.created_by'),
    colCreatedAt: t('inventory:columns.created_at'),
    filterSummary: t('kamomat:export.filter_applied'),
    rowsCount: t('kamomat:export.rows_count'),
  }
}

function headerRow(labels: KamomatListExportLabels): string[] {
  return [
    labels.colMovement,
    labels.colQty,
    labels.colCode,
    labels.colBarcode,
    labels.colProduct,
    labels.colBatch,
    labels.colLocation,
    labels.colCreatedBy,
    labels.colCreatedAt,
  ]
}

function dataRowValues(row: KamomatListExportRow): (string | number)[] {
  return [
    row.movementType,
    row.qty,
    row.code,
    row.barcode,
    row.productName,
    row.batch,
    row.location,
    row.createdBy,
    row.createdAt,
  ]
}

function buildSheetAoA(ctx: KamomatListExportContext): (string | number)[][] {
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

export async function downloadKamomatListExcel(ctx: KamomatListExportContext): Promise<void> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Inventory')
  const aoa = buildSheetAoA(ctx)
  for (const row of aoa) {
    ws.addRow(row)
  }
  const buffer = await wb.xlsx.writeBuffer()
  await writeExcelJsFile(buffer, `${kamomatListExportBaseName()}.xlsx`)
}

export function downloadKamomatListCsv(ctx: KamomatListExportContext): void {
  const aoa = buildSheetAoA(ctx)
  const csv = aoa.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  downloadBlob(`${kamomatListExportBaseName()}.csv`, blob)
}

export async function downloadKamomatListPdf(ctx: KamomatListExportContext): Promise<void> {
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

  doc.save(`${kamomatListExportBaseName()}.pdf`)
}

export async function runKamomatListExport(
  kind: 'excel' | 'csv' | 'pdf',
  ctx: KamomatListExportContext
): Promise<void> {
  if (ctx.rows.length > MAX_KAMOMAT_EXPORT_ROWS) {
    throw new KamomatExportTooLargeError()
  }
  try {
    if (kind === 'excel') {
      await downloadKamomatListExcel(ctx)
    } else if (kind === 'csv') {
      downloadKamomatListCsv(ctx)
    } else {
      await downloadKamomatListPdf(ctx)
    }
  } catch (err) {
    throw new Error(formatUnknownError(err) || 'Export failed')
  }
}
