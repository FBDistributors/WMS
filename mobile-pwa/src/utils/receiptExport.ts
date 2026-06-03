import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

import type { Receipt } from '../services/receivingApi'
import { writeExcelJsFile } from './exportExcel'
import { formatExpiryDate } from './expiry'
import { applyUnicodeFontToPdf } from './jspdfUnicodeFont'

export type ReceiptExportLabels = {
  colDocNo: string
  status: string
  receivedBy: string
  receivedAt: string
  detailLines: string
  colCode: string
  colBarcode: string
  colProduct: string
  colQty: string
  colQoldiq: string
  colBatch: string
  colExpiry: string
  colLocation: string
}

export type ReceiptExportLineRow = {
  code: string
  barcode: string
  productName: string
  qty: number
  qoldiq: string | number
  batch: string
  expiry: string
  location: string
}

export type ReceiptExportContext = {
  receipt: Receipt
  statusLabel: string
  receivedAtFormatted: string
  lines: ReceiptExportLineRow[]
  labels: ReceiptExportLabels
}

function sanitizeFileToken(value: string): string {
  return value.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'receipt'
}

export function receiptExportBaseName(docNo: string): string {
  const day = new Date().toISOString().slice(0, 10)
  return `receipt_${sanitizeFileToken(docNo)}_${day}`
}

export function escapeCsvCell(value: string | number): string {
  const s = String(value)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function buildSheetAoA(ctx: ReceiptExportContext): (string | number)[][] {
  const { receipt, labels, lines, statusLabel, receivedAtFormatted } = ctx
  const meta: (string | number)[][] = [
    [labels.colDocNo, receipt.doc_no],
    [labels.status, statusLabel],
    [labels.receivedBy, receipt.created_by_username ?? '—'],
    [labels.receivedAt, receivedAtFormatted],
    [],
    [
      labels.colCode,
      labels.colBarcode,
      labels.colProduct,
      labels.colQty,
      labels.colQoldiq,
      labels.colBatch,
      labels.colExpiry,
      labels.colLocation,
    ],
  ]
  const dataRows = lines.map((row) => [
    row.code,
    row.barcode,
    row.productName,
    row.qty,
    row.qoldiq,
    row.batch,
    row.expiry,
    row.location,
  ])
  return [...meta, ...dataRows]
}

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadReceiptExcel(ctx: ReceiptExportContext): Promise<void> {
  const { buildStyledReceiptWorkbook } = await import('./receiptExcelStyled')
  const wb = await buildStyledReceiptWorkbook(ctx)
  const buffer = await wb.xlsx.writeBuffer()
  await writeExcelJsFile(buffer, `${receiptExportBaseName(ctx.receipt.doc_no)}.xlsx`)
}

export function downloadReceiptCsv(ctx: ReceiptExportContext): void {
  const aoa = buildSheetAoA(ctx)
  const csv = aoa.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  downloadBlob(`${receiptExportBaseName(ctx.receipt.doc_no)}.csv`, blob)
}

export async function downloadReceiptPdf(ctx: ReceiptExportContext): Promise<void> {
  const { receipt, labels, lines, statusLabel, receivedAtFormatted } = ctx
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const fontFamily = await applyUnicodeFontToPdf(doc)

  doc.setFontSize(14)
  doc.text(receipt.doc_no, 14, 16)
  doc.setFontSize(10)
  const metaLines = [
    `${labels.colDocNo}: ${receipt.doc_no}`,
    `${labels.status}: ${statusLabel}`,
    `${labels.receivedBy}: ${receipt.created_by_username ?? '—'}`,
    `${labels.receivedAt}: ${receivedAtFormatted}`,
  ]
  let y = 24
  for (const line of metaLines) {
    doc.text(line, 14, y)
    y += 6
  }

  const tableFont = { font: fontFamily, fontStyle: 'normal' as const }

  autoTable(doc, {
    startY: y + 4,
    head: [
      [
        labels.colCode,
        labels.colBarcode,
        labels.colProduct,
        labels.colQty,
        labels.colQoldiq,
        labels.colBatch,
        labels.colExpiry,
        labels.colLocation,
      ],
    ],
    body: lines.map((row) => [
      row.code,
      row.barcode,
      row.productName,
      String(row.qty),
      String(row.qoldiq),
      row.batch,
      row.expiry,
      row.location,
    ]),
    styles: { fontSize: 8, cellPadding: 2, ...tableFont },
    headStyles: { fillColor: [30, 64, 175], ...tableFont },
    bodyStyles: tableFont,
    margin: { left: 14, right: 14 },
  })

  doc.save(`${receiptExportBaseName(receipt.doc_no)}.pdf`)
}

export type BuildReceiptExportLineInput = {
  productSku?: string | null
  productName?: string | null
  barcode: string
  qty: number
  qoldiq: string | number
  batch: string
  expiryDate?: string | null
  locationCode: string
  productIdFallback?: string
}

export function buildReceiptExportLineRow(input: BuildReceiptExportLineInput): ReceiptExportLineRow {
  return {
    code: input.productSku ?? input.productIdFallback ?? '—',
    barcode: input.barcode,
    productName: input.productName ?? '—',
    qty: Math.round(Number(input.qty)),
    qoldiq: input.qoldiq,
    batch: input.batch || '—',
    expiry: formatExpiryDate(input.expiryDate),
    location: input.locationCode,
  }
}
