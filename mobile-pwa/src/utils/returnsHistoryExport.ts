import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { TFunction } from 'i18next'

import type { CustomerReturnOut } from '../services/ordersApi'
import { CustomerReturnsExportTooLargeError } from '../services/ordersApi'
import { escapeCsvCell } from './receiptExport'
import { writeExcelJsFile } from './exportExcel'
import { applyUnicodeFontToPdf } from './jspdfUnicodeFont'
import { formatUnknownError } from '../lib/formatUnknownError'

export type ReturnsHistoryExportRow = {
  docNo: string
  customer: string
  status: string
  controller: string
  picker: string
  assignedAt: string
  createdAt: string
  updatedAt: string
}

export type ReturnsHistoryExportLabels = {
  listTitle: string
  colDocNo: string
  colCustomer: string
  colStatus: string
  colController: string
  colPicker: string
  colAssignedAt: string
  colCreatedAt: string
  colUpdatedAt: string
  filterSummary: string
  rowsCount: string
}

export type ReturnsHistoryExportContext = {
  title: string
  filterSummaryLines: string[]
  rows: ReturnsHistoryExportRow[]
  labels: ReturnsHistoryExportLabels
}

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export function returnsHistoryExportBaseName(): string {
  const day = new Date().toISOString().slice(0, 10)
  return `returns_history_${day}`
}

export function formatReturnsDateTime(value?: string | null): string {
  if (!value) return '—'
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return value
    return d.toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return value ?? '—'
  }
}

export function returnStatusLabel(status: string, t: TFunction): string {
  const key = `admin:returns_history.status_${status}`
  const translated = t(key)
  return translated === key ? status : translated
}

export function buildReturnsHistoryExportRows(
  items: CustomerReturnOut[],
  t: TFunction
): ReturnsHistoryExportRow[] {
  return items.map((item) => ({
    docNo: item.doc_no,
    customer: item.customer_name || item.customer_id || '—',
    status: returnStatusLabel(item.status, t),
    controller: item.assigned_by_user_name || item.approved_by_user_name || item.assigned_by_user_id || '—',
    picker: item.assigned_picker_user_name || item.assigned_picker_user_id || '—',
    assignedAt: formatReturnsDateTime(item.assigned_at),
    createdAt: formatReturnsDateTime(item.created_at),
    updatedAt: formatReturnsDateTime(item.updated_at),
  }))
}

export function buildReturnsHistoryExportLabels(t: TFunction): ReturnsHistoryExportLabels {
  return {
    listTitle: t('admin:returns_history.export_list_title'),
    colDocNo: t('admin:returns_history.columns.doc_no'),
    colCustomer: t('admin:returns_history.columns.customer'),
    colStatus: t('admin:returns_history.columns.status'),
    colController: t('admin:returns_history.columns.controller'),
    colPicker: t('admin:returns_history.columns.picker'),
    colAssignedAt: t('admin:returns_history.columns.assigned_at'),
    colCreatedAt: t('admin:returns_history.columns.created_at'),
    colUpdatedAt: t('admin:returns_history.columns.updated_at'),
    filterSummary: t('admin:returns_history.export_filter_applied'),
    rowsCount: t('admin:returns_history.export_rows_count'),
  }
}

function headerRow(labels: ReturnsHistoryExportLabels): string[] {
  return [
    labels.colDocNo,
    labels.colCustomer,
    labels.colStatus,
    labels.colController,
    labels.colPicker,
    labels.colAssignedAt,
    labels.colCreatedAt,
    labels.colUpdatedAt,
  ]
}

function dataRowValues(row: ReturnsHistoryExportRow): (string | number)[] {
  return [
    row.docNo,
    row.customer,
    row.status,
    row.controller,
    row.picker,
    row.assignedAt,
    row.createdAt,
    row.updatedAt,
  ]
}

function buildSheetAoA(ctx: ReturnsHistoryExportContext): (string | number)[][] {
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

export async function downloadReturnsHistoryExcel(ctx: ReturnsHistoryExportContext): Promise<void> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Returns')
  for (const row of buildSheetAoA(ctx)) {
    ws.addRow(row)
  }
  const buffer = await wb.xlsx.writeBuffer()
  await writeExcelJsFile(buffer, `${returnsHistoryExportBaseName()}.xlsx`)
}

export function downloadReturnsHistoryCsv(ctx: ReturnsHistoryExportContext): void {
  const aoa = buildSheetAoA(ctx)
  const csv = aoa.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  downloadBlob(`${returnsHistoryExportBaseName()}.csv`, blob)
}

export async function downloadReturnsHistoryPdf(ctx: ReturnsHistoryExportContext): Promise<void> {
  const { labels, filterSummaryLines, rows } = ctx
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const fontFamily = await applyUnicodeFontToPdf(doc)

  doc.setFontSize(14)
  doc.text(labels.listTitle, 14, 16)
  doc.setFontSize(9)
  let y = 24
  for (const line of [
    `${labels.filterSummary}: ${filterSummaryLines.join('; ') || '—'}`,
    `${labels.rowsCount}: ${rows.length}`,
  ]) {
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

  doc.save(`${returnsHistoryExportBaseName()}.pdf`)
}

export async function runReturnsHistoryExport(
  kind: 'excel' | 'csv' | 'pdf',
  ctx: ReturnsHistoryExportContext
): Promise<void> {
  if (ctx.rows.length > 10_000) {
    throw new CustomerReturnsExportTooLargeError()
  }
  try {
    if (kind === 'excel') {
      await downloadReturnsHistoryExcel(ctx)
    } else if (kind === 'csv') {
      downloadReturnsHistoryCsv(ctx)
    } else {
      await downloadReturnsHistoryPdf(ctx)
    }
  } catch (err) {
    if (err instanceof CustomerReturnsExportTooLargeError) {
      throw err
    }
    throw new Error(formatUnknownError(err))
  }
}
