import { useCallback, useEffect, useMemo, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'

import { Button } from '../../../components/ui/button'
import {
  IMPORT_QTY_MAX_LINES,
  importInventoryQtyRows,
  type ImportQtyResponse,
  type ImportQtyRowLine,
} from '../../../services/inventoryApi'
import type { WarehouseFilter } from '../../../services/locationsApi'

type ImportInventoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  warehouse: WarehouseFilter
  onSuccess: () => void
}

const parseCsv = (text: string) => {
  const rows: string[][] = []
  let current = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === ',' && !inQuotes) {
      row.push(current)
      current = ''
      continue
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i += 1
      }
      row.push(current)
      if (row.some((cell) => cell.trim() !== '')) {
        rows.push(row)
      }
      row = []
      current = ''
      continue
    }
    current += char
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current)
    if (row.some((cell) => cell.trim() !== '')) {
      rows.push(row)
    }
  }
  return rows
}

function sheetRowsFromWorkbook(wb: XLSX.WorkBook): string[][] {
  const name = wb.SheetNames[0]
  if (!name) return []
  const sheet = wb.Sheets[name]
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', raw: false }) as string[][]
}

function normalizeHeader(h: string): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
}

/** Excel serial sanadan ISO sana (YYYY-MM-DD), UTC. */
function excelSerialToIsoDate(serial: number): string {
  const utcDays = Math.floor(serial - 25569)
  const ms = utcDays * 86400 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

function parseExpiryCell(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10)
  }
  const s = String(raw).trim()
  if (!s) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const dmY = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (dmY) {
    const d = dmY[1].padStart(2, '0')
    const m = dmY[2].padStart(2, '0')
    const y = dmY[3]
    return `${y}-${m}-${d}`
  }
  const num = Number(s.replace(',', '.'))
  if (Number.isFinite(num) && num > 20000 && num < 60000) {
    try {
      return excelSerialToIsoDate(num)
    } catch {
      return undefined
    }
  }
  return undefined
}

type DetailedIdx = {
  codeIdx: number
  qtyIdx: number
  locationIdx: number
  expiryIdx: number
  barcodeIdx: number
  productIdx: number
  brandIdx: number
}

function findMetaColumnIndices(
  lower: string[],
  core: { codeIdx: number; qtyIdx: number; locationIdx: number; expiryIdx: number },
): Pick<DetailedIdx, 'barcodeIdx' | 'productIdx' | 'brandIdx'> {
  const used = new Set<number>([core.codeIdx, core.qtyIdx, core.locationIdx])
  if (core.expiryIdx >= 0) used.add(core.expiryIdx)

  const barcodeIdx = lower.findIndex(
    (h, i) =>
      !used.has(i) &&
      (h === 'barcode' ||
        h.includes('штрих') ||
        h.includes('shtrix') ||
        h === 'ean' ||
        h === 'upc'),
  )
  if (barcodeIdx >= 0) used.add(barcodeIdx)

  const productIdx = lower.findIndex(
    (h, i) =>
      !used.has(i) &&
      (h === 'товар' ||
        h === 'product' ||
        h === 'mahsulot' ||
        h.includes('номенклат') ||
        h === 'nomenclature' ||
        (h.includes('товар') && h.length < 60)),
  )
  if (productIdx >= 0) used.add(productIdx)

  const brandIdx = lower.findIndex(
    (h, i) =>
      !used.has(i) &&
      (h === 'brand' ||
        h === 'brend' ||
        h === 'бренд' ||
        (h.includes('бренд') && h.length < 40)),
  )

  return { barcodeIdx, productIdx, brandIdx }
}

function findDetailedColumns(headers: string[]): DetailedIdx | null {
  const lower = headers.map((h) => normalizeHeader(h))
  const locationIdx = lower.findIndex(
    (h) =>
      h === 'joylashuv' ||
      h === 'location' ||
      h.includes('joylashuv') ||
      (h.includes('joylash') && !h.includes('code')) ||
      h === 'локация' ||
      h === 'место' ||
      h.includes('локац') ||
      h.includes('место'),
  )
  let qtyIdx = lower.findIndex((h) => h === 'miqdor')
  if (qtyIdx < 0) {
    qtyIdx = lower.findIndex(
      (h) =>
        h === 'qty' ||
        h === 'quantity' ||
        h === 'кол-во' ||
        h === 'количество' ||
        (h.includes('total') && h.includes('qty')),
    )
  }
  if (qtyIdx >= 0) {
    const h = lower[qtyIdx]
    if (h === 'qoldiq' || h === 'available' || (h.includes('qoldiq') && !h.includes('miqdor'))) {
      qtyIdx = -1
    }
  }
  let codeIdx = lower.findIndex(
    (h) =>
      h === 'sku' ||
      h === 'code' ||
      h === 'product_code' ||
      h === 'kod' ||
      h === 'код' ||
      h === 'barcode' ||
      h.includes('shtrix') ||
      h.includes('штрих'),
  )
  if (codeIdx < 0) codeIdx = 0
  const expiryIdx = lower.findIndex(
    (h) =>
      h === 'yaroqlilik' ||
      h === 'expiry' ||
      h.includes('yaroqlilik') ||
      h.includes('expiry') ||
      h.includes('годен') ||
      h.includes('годности') ||
      (h.includes('срок') && h.includes('год')),
  )
  if (locationIdx < 0 || qtyIdx < 0) return null
  const uniq = new Set([codeIdx, qtyIdx, locationIdx])
  if (uniq.size !== 3) return null
  const meta = findMetaColumnIndices(lower, {
    codeIdx,
    qtyIdx,
    locationIdx,
    expiryIdx,
  })
  return {
    codeIdx,
    qtyIdx,
    locationIdx,
    expiryIdx,
    ...meta,
  }
}

function parseRowsToDetailedLines(
  rows: string[][],
  idx: DetailedIdx,
): { lines: ImportQtyRowLine[]; error: string | null } {
  if (rows.length < 2) {
    return { lines: [], error: 'no_rows' }
  }
  const out: ImportQtyRowLine[] = []
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r]
    const code = String(row[idx.codeIdx] ?? '')
      .trim()
      .replace(/^'+|'+$/g, '')
    const location_code = String(row[idx.locationIdx] ?? '').trim()
    const qtyRaw = row[idx.qtyIdx]
    const qtyNum = Math.floor(Number(String(qtyRaw ?? '').replace(/,/g, '.').trim()))
    let expiry_date: string | undefined
    if (idx.expiryIdx >= 0) {
      expiry_date = parseExpiryCell(row[idx.expiryIdx])
    }
    if (!code || !location_code) continue
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) continue
    const line: ImportQtyRowLine = {
      code,
      qty: qtyNum,
      location_code,
      ...(expiry_date ? { expiry_date } : {}),
    }
    if (idx.barcodeIdx >= 0) {
      line.barcode = String(row[idx.barcodeIdx] ?? '').trim()
    }
    if (idx.productIdx >= 0) {
      line.product_name = String(row[idx.productIdx] ?? '').trim()
    }
    if (idx.brandIdx >= 0) {
      line.brand = String(row[idx.brandIdx] ?? '').trim()
    }
    out.push(line)
  }
  if (out.length === 0) {
    return { lines: [], error: 'no_rows' }
  }
  return { lines: out, error: null }
}

export function ImportInventoryDialog({
  open,
  onOpenChange,
  warehouse,
  onSuccess,
}: ImportInventoryDialogProps) {
  const { t } = useTranslation(['inventory', 'common'])
  const [fileName, setFileName] = useState<string | null>(null)
  const [lines, setLines] = useState<ImportQtyRowLine[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportQtyResponse | null>(null)
  const [columnFlags, setColumnFlags] = useState({ barcode: false, product: false, brand: false })

  const reset = useCallback(() => {
    setFileName(null)
    setLines([])
    setFormError(null)
    setResult(null)
    setColumnFlags({ barcode: false, product: false, brand: false })
  }, [])

  useEffect(() => {
    if (!open) return
    reset()
  }, [open, reset])

  const preview = useMemo(() => lines.slice(0, 15), [lines])

  const parseErrorMessage = (key: string | null) => {
    if (!key) return null
    if (key === 'missing_columns') return t('inventory:import_missing_columns')
    return t('inventory:import_no_rows')
  }

  const handleFile = async (file: File) => {
    setFormError(null)
    setResult(null)
    setFileName(file.name)
    setLines([])
    setColumnFlags({ barcode: false, product: false, brand: false })
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    try {
      let rows: string[][] = []
      if (ext === 'csv') {
        const text = await file.text()
        rows = parseCsv(text)
      } else if (ext === 'xlsx' || ext === 'xls') {
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array', cellDates: true })
        rows = sheetRowsFromWorkbook(wb)
      } else {
        setFormError(t('inventory:import_invalid_type'))
        return
      }
      if (rows.length < 2) {
        setFormError(t('inventory:import_no_rows'))
        return
      }
      const headers = rows[0].map((c) => String(c ?? ''))
      const detailedIdx = findDetailedColumns(headers)
      if (!detailedIdx) {
        setFormError(t('inventory:import_requires_location_column'))
        return
      }
      setColumnFlags({
        barcode: detailedIdx.barcodeIdx >= 0,
        product: detailedIdx.productIdx >= 0,
        brand: detailedIdx.brandIdx >= 0,
      })
      const parsed = parseRowsToDetailedLines(rows, detailedIdx)
      if (parsed.error) {
        setFormError(parseErrorMessage(parsed.error))
        setColumnFlags({ barcode: false, product: false, brand: false })
        return
      }
      if (parsed.lines.length > IMPORT_QTY_MAX_LINES) {
        setFormError(t('inventory:import_max_rows', { max: IMPORT_QTY_MAX_LINES }))
        setColumnFlags({ barcode: false, product: false, brand: false })
        return
      }
      setLines(parsed.lines)
    } catch {
      setFormError(t('inventory:import_parse_error'))
    }
  }

  const handleSubmit = async () => {
    if (lines.length === 0) return
    setSubmitting(true)
    setFormError(null)
    setResult(null)
    try {
      let applied = 0
      let skipped = 0
      const allErrors: { code: string; message: string }[] = []
      for (let i = 0; i < lines.length; i += IMPORT_QTY_MAX_LINES) {
        const chunk = lines.slice(i, i + IMPORT_QTY_MAX_LINES)
        const res = await importInventoryQtyRows({
          lines: chunk,
          warehouse,
        })
        applied += res.applied_rows
        skipped += res.skipped_rows
        allErrors.push(...res.errors)
      }
      setResult({
        applied_rows: applied,
        skipped_rows: skipped,
        errors: allErrors.slice(0, 50),
      })
      onSuccess()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('inventory:import_failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = Boolean(lines.length > 0 && !submitting)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-label={t('common:buttons.close')}
      />
      <div
        className="relative flex max-h-[min(92dvh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-inventory-title"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-4 dark:border-slate-800">
          <div className="min-w-0 pr-2">
            <h2
              id="import-inventory-title"
              className="text-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              {t('inventory:import_title')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('inventory:import_hint')}</p>
          </div>
          <Button variant="ghost" className="shrink-0 rounded-full px-3 py-3" onClick={() => onOpenChange(false)}>
            <X size={18} />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          {formError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {formError}
            </div>
          ) : null}

          <p className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            {t('inventory:import_location_from_file')}
          </p>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
            <Upload size={16} />
            {fileName ?? t('inventory:import_choose_file')}
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
              }}
            />
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('inventory:import_file_hint_full')}</p>
          {columnFlags.barcode || columnFlags.product || columnFlags.brand ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('inventory:import_extra_columns_preview')}</p>
          ) : null}

          {preview.length > 0 ? (
            <div className="max-h-[min(45vh,380px)] overflow-auto rounded-2xl border border-slate-200 dark:border-slate-800">
              <table className="w-max min-w-full text-xs">
                <thead className="sticky top-0 z-10 bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="whitespace-nowrap px-2 py-2 text-left sm:px-3">#</th>
                    <th className="whitespace-nowrap px-2 py-2 text-left sm:px-3">
                      {t('inventory:columns.code')}
                    </th>
                    {columnFlags.barcode ? (
                      <th className="whitespace-nowrap px-2 py-2 text-left sm:px-3">
                        {t('inventory:columns.barcode')}
                      </th>
                    ) : null}
                    {columnFlags.product ? (
                      <th className="min-w-[8rem] whitespace-nowrap px-2 py-2 text-left sm:px-3 sm:min-w-[12rem]">
                        {t('inventory:columns.product')}
                      </th>
                    ) : null}
                    {columnFlags.brand ? (
                      <th className="whitespace-nowrap px-2 py-2 text-left sm:px-3">
                        {t('inventory:columns.brand')}
                      </th>
                    ) : null}
                    <th className="whitespace-nowrap px-2 py-2 text-left sm:px-3">
                      {t('inventory:columns.location')}
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 text-right sm:px-3">
                      {t('inventory:columns.qty')}
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 text-left sm:px-3">
                      {t('inventory:columns.expiry')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr
                      key={`import-preview-${i}`}
                      className="border-t border-slate-200 dark:border-slate-800"
                    >
                      <td className="px-2 py-2 sm:px-3">{i + 1}</td>
                      <td className="px-2 py-2 font-mono sm:px-3">{row.code}</td>
                      {columnFlags.barcode ? (
                        <td className="max-w-[9rem] truncate px-2 py-2 font-mono sm:max-w-[11rem] sm:px-3" title={row.barcode}>
                          {row.barcode || '—'}
                        </td>
                      ) : null}
                      {columnFlags.product ? (
                        <td
                          className="max-w-[10rem] truncate px-2 py-2 sm:max-w-[16rem] sm:px-3"
                          title={row.product_name}
                        >
                          {row.product_name || '—'}
                        </td>
                      ) : null}
                      {columnFlags.brand ? (
                        <td className="max-w-[7rem] truncate px-2 py-2 sm:px-3" title={row.brand}>
                          {row.brand || '—'}
                        </td>
                      ) : null}
                      <td className="px-2 py-2 font-mono sm:px-3">{row.location_code}</td>
                      <td className="px-2 py-2 text-right tabular-nums sm:px-3">{row.qty}</td>
                      <td className="whitespace-nowrap px-2 py-2 sm:px-3">{row.expiry_date ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lines.length > preview.length ? (
                <div className="border-t border-slate-200 px-2 py-2 text-xs text-slate-500 dark:border-slate-800 sm:px-3">
                  {t('inventory:import_and_more', { count: lines.length - preview.length })}
                </div>
              ) : null}
            </div>
          ) : null}

          {result ? (
            <div className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
              <div>
                {t('inventory:import_success', {
                  applied: result.applied_rows,
                  skipped: result.skipped_rows,
                })}
              </div>
              {result.errors.length > 0 ? (
                <div className="max-h-32 overflow-y-auto text-xs">
                  <div className="font-medium">{t('inventory:import_errors')}</div>
                  {result.errors.map((e, idx) => (
                    <div key={`${e.code}-${idx}`}>
                      {e.code}: {e.message}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 sm:px-6 dark:border-slate-800">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              reset()
              onOpenChange(false)
            }}
          >
            {t('common:buttons.cancel')}
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={() => void handleSubmit()}>
            {submitting ? t('inventory:import_importing') : t('inventory:import_submit')}
          </Button>
        </div>
      </div>
    </div>
  )
}
