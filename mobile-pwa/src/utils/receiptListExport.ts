import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { TFunction } from 'i18next'

import type { Receipt } from '../services/receivingApi'
import type { Location } from '../services/locationsApi'
import type { Product } from '../services/productsApi'
import { escapeCsvCell } from './receiptExport'
import { writeExcelJsFile } from './exportExcel'
import { applyUnicodeFontToPdf } from './jspdfUnicodeFont'
import { buildReceiptExportLineRow } from './receiptExport'

export type ReceiptListExportLabels = {
  listTitle: string
  colDocNo: string
  status: string
  receivedBy: string
  receivedAt: string
  colCode: string
  colBarcode: string
  colProduct: string
  colQty: string
  colQoldiq: string
  colBatch: string
  colExpiry: string
  colLocation: string
  filterSummary: string
  receiptsCount: string
  linesCount: string
}

export type ReceiptListExportRow = {
  docNo: string
  status: string
  receivedBy: string
  receivedAt: string
  code: string
  barcode: string
  productName: string
  qty: number
  qoldiq: string | number
  batch: string
  expiry: string
  location: string
}

export type ReceiptListExportContext = {
  title: string
  filterSummaryLines: string[]
  rows: ReceiptListExportRow[]
  receiptCount: number
  lineCount: number
  labels: ReceiptListExportLabels
}

export function receiptListExportBaseName(): string {
  const day = new Date().toISOString().slice(0, 10)
  return `receipts_list_${day}`
}

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export function formatReceiptListDate(iso: string): string {
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

export function filterReceiptsBySearch(receipts: Receipt[], q: string): Receipt[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return receipts
  return receipts.filter((r) => {
    const matchDoc = r.doc_no?.toLowerCase().includes(needle)
    const matchUser = r.created_by_username?.toLowerCase().includes(needle)
    return matchDoc || matchUser
  })
}

export function buildReceiptListExportRows(
  receipts: Receipt[],
  productLookup: Map<string, Product>,
  locationLookup: Map<string, Location>,
  inventoryMap: Map<string, number>,
  statusLabel: (status: Receipt['status']) => string
): ReceiptListExportRow[] {
  const rows: ReceiptListExportRow[] = []
  for (const receipt of receipts) {
    const receivedAt = receipt.created_at
      ? formatReceiptListDate(receipt.created_at)
      : '—'
    const status = statusLabel(receipt.status)
    const receivedBy = receipt.created_by_username ?? '—'
    for (const line of receipt.lines) {
      const product = productLookup.get(line.product_id)
      const loc = locationLookup.get(line.location_id)
      const barcode =
        product?.barcode || (product?.barcodes && product.barcodes[0]) || '—'
      const qoldiq = inventoryMap.get(line.product_id) ?? '—'
      const lineRow = buildReceiptExportLineRow({
        productSku: product?.sku,
        productName: product?.name,
        barcode,
        qty: line.qty,
        qoldiq,
        batch: line.batch,
        expiryDate: line.expiry_date,
        locationCode: loc?.code ?? line.location_id,
        productIdFallback: line.product_id,
      })
      rows.push({
        docNo: receipt.doc_no,
        status,
        receivedBy,
        receivedAt,
        ...lineRow,
      })
    }
  }
  return rows
}

export function buildReceiptListExportLabels(t: TFunction): ReceiptListExportLabels {
  return {
    listTitle: t('receiving:export_list_title'),
    colDocNo: t('receiving:col_doc_no'),
    status: t('receiving:status'),
    receivedBy: t('receiving:received_by'),
    receivedAt: t('receiving:received_at'),
    colCode: t('receiving:detail_col_code'),
    colBarcode: t('receiving:detail_col_barcode'),
    colProduct: t('receiving:detail_col_product'),
    colQty: t('receiving:fields.qty'),
    colQoldiq: t('receiving:detail_col_qoldiq'),
    colBatch: t('receiving:fields.batch'),
    colExpiry: t('receiving:fields.expiry_date'),
    colLocation: t('receiving:fields.location'),
    filterSummary: t('receiving:export_filter_applied'),
    receiptsCount: t('receiving:export_receipts_count'),
    linesCount: t('receiving:export_lines_count'),
  }
}

function headerRow(labels: ReceiptListExportLabels): string[] {
  return [
    labels.colDocNo,
    labels.status,
    labels.receivedBy,
    labels.receivedAt,
    labels.colCode,
    labels.colBarcode,
    labels.colProduct,
    labels.colQty,
    labels.colQoldiq,
    labels.colBatch,
    labels.colExpiry,
    labels.colLocation,
  ]
}

function dataRowValues(row: ReceiptListExportRow): (string | number)[] {
  return [
    row.docNo,
    row.status,
    row.receivedBy,
    row.receivedAt,
    row.code,
    row.barcode,
    row.productName,
    row.qty,
    row.qoldiq,
    row.batch,
    row.expiry,
    row.location,
  ]
}

function buildSheetAoA(ctx: ReceiptListExportContext): (string | number)[][] {
  const { labels, filterSummaryLines, rows, receiptCount, lineCount } = ctx
  const meta: (string | number)[][] = [
    [labels.listTitle],
    [labels.filterSummary, filterSummaryLines.join('; ') || '—'],
    [labels.receiptsCount, receiptCount],
    [labels.linesCount, lineCount],
    [],
    headerRow(labels),
  ]
  const dataRows = rows.map((row) => dataRowValues(row))
  return [...meta, ...dataRows]
}

export async function downloadReceiptListExcel(ctx: ReceiptListExportContext): Promise<void> {
  const { buildStyledReceiptListWorkbook } = await import('./receiptListExcelStyled')
  const wb = await buildStyledReceiptListWorkbook(ctx)
  const buffer = await wb.xlsx.writeBuffer()
  await writeExcelJsFile(buffer, `${receiptListExportBaseName()}.xlsx`)
}

export function downloadReceiptListCsv(ctx: ReceiptListExportContext): void {
  const aoa = buildSheetAoA(ctx)
  const csv = aoa.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  downloadBlob(`${receiptListExportBaseName()}.csv`, blob)
}

export async function downloadReceiptListPdf(ctx: ReceiptListExportContext): Promise<void> {
  const { labels, filterSummaryLines, rows, receiptCount, lineCount } = ctx
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const fontFamily = await applyUnicodeFontToPdf(doc)

  doc.setFontSize(14)
  doc.text(labels.listTitle, 14, 16)
  doc.setFontSize(9)
  let y = 24
  const metaLines = [
    `${labels.filterSummary}: ${filterSummaryLines.join('; ') || '—'}`,
    `${labels.receiptsCount}: ${receiptCount}`,
    `${labels.linesCount}: ${lineCount}`,
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

  doc.save(`${receiptListExportBaseName()}.pdf`)
}
