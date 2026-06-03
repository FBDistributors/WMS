import ExcelJS from 'exceljs'

import type { ReceiptExportContext } from './receiptExport'

const COL_COUNT = 8
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

export async function buildStyledReceiptWorkbook(ctx: ReceiptExportContext): Promise<ExcelJS.Workbook> {
  const { receipt, labels, lines, statusLabel, receivedAtFormatted } = ctx
  const wb = new ExcelJS.Workbook()
  wb.creator = 'WMS'
  const sheetName = labels.detailLines.slice(0, 31) || 'Receipt'
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 7 }],
  })

  ws.columns = [
    { width: 14 },
    { width: 18 },
    { width: 48 },
    { width: 10 },
    { width: 10 },
    { width: 16 },
    { width: 14 },
    { width: 12 },
  ]

  ws.mergeCells(1, 1, 1, COL_COUNT)
  const titleCell = ws.getCell(1, 1)
  titleCell.value = receipt.doc_no
  titleCell.font = { bold: true, size: 16, color: { argb: ARGB_TITLE } }
  titleCell.alignment = { vertical: 'middle' }
  ws.getRow(1).height = 28

  const metaRows: [string, string][] = [
    [labels.colDocNo, receipt.doc_no],
    [labels.status, statusLabel],
    [labels.receivedBy, receipt.created_by_username ?? '—'],
    [labels.receivedAt, receivedAtFormatted],
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

  const headerRowNum = 7
  const headers = [
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

  lines.forEach((row, lineIndex) => {
    const rowNum = headerRowNum + 1 + lineIndex
    const dataRow = ws.getRow(rowNum)
    dataRow.height = 20
    const values: (string | number)[] = [
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
      cell.value = val
      cell.font = { color: { argb: ARGB_TITLE } }
      cell.border = excelThinBorder()
      cell.alignment = {
        vertical: 'middle',
        horizontal: colIndex === 3 || colIndex === 4 ? 'right' : 'left',
        wrapText: colIndex === 2,
      }
      if (colIndex === 3 || colIndex === 4) {
        cell.numFmt = '0'
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
