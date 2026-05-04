import { useCallback, useEffect, useMemo, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'

import { Button } from '../../../components/ui/button'
import {
  IMPORT_QTY_MAX_LINES,
  importInventoryQty,
  importInventoryQtyRows,
  type ImportQtyLine,
  type ImportQtyResponse,
  type ImportQtyRowLine,
} from '../../../services/inventoryApi'
import { getLocations, type Location, type WarehouseFilter } from '../../../services/locationsApi'

type ImportInventoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  warehouse: WarehouseFilter
  onSuccess: () => void
}

type ImportMode = 'simple' | 'detailed'

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

function findCodeAndQtyColumnIndexes(headers: string[]): { codeIdx: number; qtyIdx: number } | null {
  const lower = headers.map((h) => normalizeHeader(h))
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
  let qtyIdx = lower.findIndex((h) => h === 'miqdor')
  if (qtyIdx < 0) {
    qtyIdx = lower.findIndex(
      (h) =>
        h === 'qty' ||
        h === 'quantity' ||
        (h.includes('miqdor') && !h.includes('jami')) ||
        ((h.includes('total') || h.includes('jami')) && h.includes('qty')),
    )
  }
  if (qtyIdx >= 0) {
    const h = lower[qtyIdx]
    if (h === 'qoldiq' || h === 'available' || (h.includes('qoldiq') && !h.includes('miqdor'))) {
      qtyIdx = -1
    }
  }
  if (codeIdx < 0 && lower.length >= 1) {
    codeIdx = 0
  }
  if (qtyIdx < 0 && lower.length >= 5) {
    qtyIdx = 4
  }
  if (codeIdx < 0 || qtyIdx < 0 || codeIdx === qtyIdx) {
    return null
  }
  return { codeIdx, qtyIdx }
}

type DetailedIdx = {
  codeIdx: number
  qtyIdx: number
  locationIdx: number
  expiryIdx: number
}

function findDetailedColumns(headers: string[]): DetailedIdx | null {
  const lower = headers.map((h) => normalizeHeader(h))
  const locationIdx = lower.findIndex(
    (h) =>
      h === 'joylashuv' ||
      h === 'location' ||
      h.includes('joylashuv') ||
      (h.includes('joylash') && !h.includes('code')),
  )
  let qtyIdx = lower.findIndex((h) => h === 'miqdor')
  if (qtyIdx < 0) {
    qtyIdx = lower.findIndex(
      (h) =>
        h === 'qty' ||
        h === 'quantity' ||
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
      h.includes('годен'),
  )
  if (locationIdx < 0 || qtyIdx < 0) return null
  const uniq = new Set([codeIdx, qtyIdx, locationIdx])
  if (uniq.size !== 3) return null
  return {
    codeIdx,
    qtyIdx,
    locationIdx,
    expiryIdx,
  }
}

function parseRowsToLines(rows: string[][]): { lines: ImportQtyLine[]; error: string | null } {
  if (rows.length < 2) {
    return { lines: [], error: 'no_rows' }
  }
  const headers = rows[0].map((c) => String(c ?? ''))
  const idx = findCodeAndQtyColumnIndexes(headers)
  if (!idx) {
    return { lines: [], error: 'missing_columns' }
  }
  const out: ImportQtyLine[] = []
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r]
    const code = String(row[idx.codeIdx] ?? '')
      .trim()
      .replace(/^'+|'+$/g, '')
    const qtyRaw = row[idx.qtyIdx]
    const qtyNum = Math.floor(Number(String(qtyRaw ?? '').replace(/,/g, '.').trim()))
    if (!code) continue
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) continue
    out.push({ code, qty: qtyNum })
  }
  if (out.length === 0) {
    return { lines: [], error: 'no_rows' }
  }
  return { lines: out, error: null }
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
    out.push({
      code,
      qty: qtyNum,
      location_code,
      ...(expiry_date ? { expiry_date } : {}),
    })
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
  const [mode, setMode] = useState<ImportMode>('simple')
  const [simpleLines, setSimpleLines] = useState<ImportQtyLine[]>([])
  const [detailedLines, setDetailedLines] = useState<ImportQtyRowLine[]>([])
  const [locationId, setLocationId] = useState('')
  const [locations, setLocations] = useState<Location[]>([])
  const [locationsLoading, setLocationsLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportQtyResponse | null>(null)

  const reset = useCallback(() => {
    setFileName(null)
    setMode('simple')
    setSimpleLines([])
    setDetailedLines([])
    setLocationId('')
    setFormError(null)
    setResult(null)
  }, [])

  useEffect(() => {
    if (!open) return
    reset()
  }, [open, reset])

  useEffect(() => {
    if (!open) return
    setLocationsLoading(true)
    getLocations(false, warehouse)
      .then(setLocations)
      .catch(() => setLocations([]))
      .finally(() => setLocationsLoading(false))
  }, [open, warehouse])

  const previewSimple = useMemo(() => simpleLines.slice(0, 15), [simpleLines])
  const previewDetailed = useMemo(() => detailedLines.slice(0, 15), [detailedLines])

  const parseErrorMessage = (key: string | null) => {
    if (!key) return null
    if (key === 'missing_columns') return t('inventory:import_missing_columns')
    return t('inventory:import_no_rows')
  }

  const handleFile = async (file: File) => {
    setFormError(null)
    setResult(null)
    setFileName(file.name)
    setMode('simple')
    setSimpleLines([])
    setDetailedLines([])
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
      if (detailedIdx) {
        const parsedD = parseRowsToDetailedLines(rows, detailedIdx)
        if (parsedD.error) {
          setFormError(parseErrorMessage(parsedD.error))
          return
        }
        if (parsedD.lines.length > IMPORT_QTY_MAX_LINES) {
          setFormError(t('inventory:import_max_rows', { max: IMPORT_QTY_MAX_LINES }))
          return
        }
        setMode('detailed')
        setDetailedLines(parsedD.lines)
        return
      }
      const parsed = parseRowsToLines(rows)
      if (parsed.error) {
        setFormError(parseErrorMessage(parsed.error))
        return
      }
      if (parsed.lines.length > IMPORT_QTY_MAX_LINES) {
        setFormError(t('inventory:import_max_rows', { max: IMPORT_QTY_MAX_LINES }))
        return
      }
      setSimpleLines(parsed.lines)
    } catch {
      setFormError(t('inventory:import_parse_error'))
    }
  }

  const handleSubmit = async () => {
    if (mode === 'simple') {
      if (!locationId || simpleLines.length === 0) return
    } else {
      if (detailedLines.length === 0) return
    }
    setSubmitting(true)
    setFormError(null)
    setResult(null)
    try {
      let applied = 0
      let skipped = 0
      const allErrors: { code: string; message: string }[] = []
      if (mode === 'simple') {
        for (let i = 0; i < simpleLines.length; i += IMPORT_QTY_MAX_LINES) {
          const chunk = simpleLines.slice(i, i + IMPORT_QTY_MAX_LINES)
          const res = await importInventoryQty({
            location_id: locationId,
            lines: chunk,
            warehouse,
          })
          applied += res.applied_rows
          skipped += res.skipped_rows
          allErrors.push(...res.errors)
        }
      } else {
        for (let i = 0; i < detailedLines.length; i += IMPORT_QTY_MAX_LINES) {
          const chunk = detailedLines.slice(i, i + IMPORT_QTY_MAX_LINES)
          const res = await importInventoryQtyRows({
            lines: chunk,
            warehouse,
          })
          applied += res.applied_rows
          skipped += res.skipped_rows
          allErrors.push(...res.errors)
        }
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

  const canSubmit =
    mode === 'simple'
      ? Boolean(locationId && simpleLines.length > 0 && !submitting)
      : Boolean(detailedLines.length > 0 && !submitting)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-label={t('common:buttons.close')}
      />
      <div className="relative w-full max-w-lg rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('inventory:import_title')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {mode === 'detailed' ? t('inventory:import_hint_detailed') : t('inventory:import_hint')}
            </p>
          </div>
          <Button variant="ghost" className="rounded-full px-3 py-3" onClick={() => onOpenChange(false)}>
            <X size={18} />
          </Button>
        </div>
        <div className="space-y-3 px-6 py-5">
          {formError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {formError}
            </div>
          ) : null}

          {mode === 'simple' ? (
            <>
              <label className="text-sm text-slate-600 dark:text-slate-300">{t('inventory:import_location')}</label>
              <select
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                disabled={locationsLoading}
              >
                <option value="">{t('inventory:import_location_placeholder')}</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.code} — {loc.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              {t('inventory:import_location_from_file')}
            </p>
          )}

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

          {mode === 'simple' && previewSimple.length > 0 ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">{t('inventory:columns.code')}</th>
                    <th className="px-3 py-2 text-right">{t('inventory:columns.qty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {previewSimple.map((row, i) => (
                    <tr key={`${row.code}-${i}`} className="border-t border-slate-200 dark:border-slate-800">
                      <td className="px-3 py-2">{i + 1}</td>
                      <td className="px-3 py-2 font-mono">{row.code}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {simpleLines.length > previewSimple.length ? (
                <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-800">
                  {t('inventory:import_and_more', { count: simpleLines.length - previewSimple.length })}
                </div>
              ) : null}
            </div>
          ) : null}

          {mode === 'detailed' && previewDetailed.length > 0 ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">{t('inventory:columns.code')}</th>
                    <th className="px-3 py-2 text-left">{t('inventory:columns.location')}</th>
                    <th className="px-3 py-2 text-right">{t('inventory:columns.qty')}</th>
                    <th className="px-3 py-2 text-left">{t('inventory:columns.expiry')}</th>
                  </tr>
                </thead>
                <tbody>
                  {previewDetailed.map((row, i) => (
                    <tr key={`${row.code}-${row.location_code}-${i}`} className="border-t border-slate-200 dark:border-slate-800">
                      <td className="px-3 py-2">{i + 1}</td>
                      <td className="px-3 py-2 font-mono">{row.code}</td>
                      <td className="px-3 py-2 font-mono">{row.location_code}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.qty}</td>
                      <td className="px-3 py-2">{row.expiry_date ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detailedLines.length > previewDetailed.length ? (
                <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-800">
                  {t('inventory:import_and_more', { count: detailedLines.length - previewDetailed.length })}
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

          <div className="flex items-center justify-end gap-2 pt-2">
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
    </div>
  )
}
