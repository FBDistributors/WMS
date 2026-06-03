import ExcelJS from 'exceljs'

import type { ReceiptListExportContext } from './receiptListExport'

const COL_COUNT = 12
const ARGB_BLUE = 'FF1E40AF'
const ARGB_WHITE = 'FFFFFFFF'
const ARGB_LABEL_BG = 'FFF1F5F9'
const ARGB_BORDER = 'FFCBD5E1'
const ARGB_TITLE = 'FF0F172A'
const ARGB_META = 'FF475569'

function excelThinBorder(): Partial<ExcelJS.Borders> {
  const edge: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: ARGB_BORDER } }
  return { top: edge, left: edge, bottom: edge, right: edge }
}

function safeSheetName(title: string): string {
  const cleaned = title.replace(/[\\/*?:[\]]/g, '_').trim()
  return (cleaned || 'Receipts').slice(0, 31)
}

function setDataCell(cell: ExcelJS.Cell, colIndex: number, val: string | number): void {
  if (colIndex === 7) {
    const n = typeof val === 'number' ? val : Number(val)
    cell.value = Number.isFinite(n) ? n : val
    if (typeof cell.value === 'number') cell.numFmt = '0'
    return
  }
  if (colIndex === 8) {
    if (typeof val === 'number' && Number.isFinite(val)) {
      cell.value = val
      cell.numFmt = '0'
    } else {
      cell.value = val === null || val === undefined ? '' : String(val)
    }
    return
  }
  cell.value = val === null || val === undefined ? '' : val
}

export async function buildStyledReceiptListWorkbook(
  ctx: ReceiptListExportContext
): Promise<ExcelJS.Workbook> {
  const { labels, filterSummaryLines, rows, receiptCount, lineCount } = ctx
  const wb = new ExcelJS.Workbook()
  wb.creator = 'WMS'
  const ws = wb.addWorksheet(safeSheetName(labels.listTitle), {
    views: [{ state: 'frozen', ySplit: 6 }],
  })

  ws.columns = [
    { width: 18 },
    { width: 12 },
    { width: 16 },
    { width: 18 },
    { width: 12 },
    { width: 16 },
    { width: 40 },
    { width: 8 },
    { width: 8 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
  ]

  ws.mergeCells(1, 1, 1, COL_COUNT)
  const titleCell = ws.getCell(1, 1)
  titleCell.value = labels.listTitle
  titleCell.font = { bold: true, size: 16, color: { argb: ARGB_TITLE } }
  titleCell.alignment = { vertical: 'middle' }
  ws.getRow(1).height = 28

  const metaRows: [string, string][] = [
    [labels.filterSummary, filterSummaryLines.join('; ') || '—'],
    [labels.receiptsCount, String(receiptCount)],
    [labels.linesCount, String(lineCount)],
  ]
  metaRows.forEach(([label, value], i) => {
    const rowNum = 2 + i
    const labelCell = ws.getCell(rowNum, 1)
    labelCell.value = label
    labelCell.font = { bold: true, color: { argb: ARGB_META } }
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB_LABEL_BG } }
    labelCell.border = excelThinBorder()
    labelCell.alignment = { vertical: 'middle' }

    ws.mergeCells(rowNum, 2, rowNum, COL_COUNT)
    const valueCell = ws.getCell(rowNum, 2)
    valueCell.value = value
    valueCell.font = { color: { argb: ARGB_TITLE } }
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB_WHITE } }
    valueCell.border = excelThinBorder()
    valueCell.alignment = { vertical: 'middle', wrapText: true }
    ws.getRow(rowNum).height = 20
  })

  const headerRowNum = 6
  const headers = [
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
  const headerRow = ws.getRow(headerRowNum)
  headerRow.height = 22
  headers.forEach((text, colIndex) => {
    const cell = headerRow.getCell(colIndex + 1)
    cell.value = text
    cell.font = { bold: true, color: { argb: ARGB_WHITE } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB_BLUE } }
    cell.border = excelThinBorder()
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
  })

  rows.forEach((row, lineIndex) => {
    const rowNum = headerRowNum + 1 + lineIndex
    const dataRow = ws.getRow(rowNum)
    dataRow.height = 20
    const values: (string | number)[] = [
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
    values.forEach((val, colIndex) => {
      const cell = dataRow.getCell(colIndex + 1)
      setDataCell(cell, colIndex, val)
      cell.font = { color: { argb: ARGB_TITLE } }
      cell.border = excelThinBorder()
      cell.alignment = {
        vertical: 'middle',
        horizontal: colIndex === 7 || colIndex === 8 ? 'right' : 'left',
        wrapText: colIndex === 6,
      }
    })
    if (lineIndex % 2 === 1) {
      for (let c = 1; c <= COL_COUNT; c++) {
        const cell = dataRow.getCell(c)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
      }
    }
  })

  return wb
}
