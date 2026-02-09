import { useEffect, useMemo, useState } from 'react'
import { Download, Upload, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../../components/ui/button'
import { importProducts, type ProductImportFailure, type ProductImportItem } from '../../../services/productsApi'

type ImportProductsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}

type ParsedRow = {
  rowNumber: number
  data: ProductImportItem
}

const TEMPLATE_HEADERS = ['sku', 'name', 'brand', 'category', 'status', 'barcode']
const CHUNK_SIZE = 200

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

const normalizeStatus = (value: string) => {
  const cleaned = value.trim().toLowerCase()
  if (!cleaned) return 'active' as const
  if (cleaned === 'active' || cleaned === 'inactive') return cleaned as 'active' | 'inactive'
  return 'active' as const
}

export function ImportProductsDialog({
  open,
  onOpenChange,
  onImported,
}: ImportProductsDialogProps) {
  const { t } = useTranslation(['products', 'common'])
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [errors, setErrors] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [summary, setSummary] = useState<{ inserted: number; failed: ProductImportFailure[] } | null>(null)

  const reset = () => {
    setFileName(null)
    setParsedRows([])
    setErrors(null)
    setIsImporting(false)
    setProgress(0)
    setSummary(null)
  }

  useEffect(() => {
    if (open) {
      reset()
    }
  }, [open])

  const previewRows = useMemo(() => parsedRows.slice(0, 20), [parsedRows])

  if (!open) return null

  const downloadTemplate = () => {
    const csv = `${TEMPLATE_HEADERS.join(',')}\n`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'products_template.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleFile = async (file: File) => {
    setErrors(null)
    setSummary(null)
    setFileName(file.name)
    const text = await file.text()
    const rows = parseCsv(text)
    if (rows.length === 0) {
      setErrors(t('products:import.empty'))
      setParsedRows([])
      return
    }
    const headers = rows[0].map((header) => header.trim().toLowerCase())
    const missing = TEMPLATE_HEADERS.filter((header) => !headers.includes(header))
    if (missing.length > 0) {
      setErrors(t('products:import.missing_columns'))
      setParsedRows([])
      return
    }
    const index = TEMPLATE_HEADERS.reduce<Record<string, number>>((acc, header) => {
      acc[header] = headers.indexOf(header)
      return acc
    }, {})

    const parsed: ParsedRow[] = rows.slice(1).map((row, idx) => {
      const barcodes = row[index.barcode] || ''
      const barcodeList = barcodes
        .split('|')
        .map((value) => value.trim())
        .filter(Boolean)
      return {
        rowNumber: idx + 2,
        data: {
          sku: row[index.sku]?.trim() || '',
          name: row[index.name]?.trim() || '',
          brand: row[index.brand]?.trim() || undefined,
          category: row[index.category]?.trim() || undefined,
          status: normalizeStatus(row[index.status] || ''),
          barcodes: barcodeList,
        },
      }
    })

    setParsedRows(parsed.filter((row) => row.data.sku || row.data.name))
    setFileName(file.name)
  }

  const handleImport = async () => {
    if (parsedRows.length === 0) return
    setIsImporting(true)
    setSummary(null)
    setProgress(0)
    let inserted = 0
    const failed: ProductImportFailure[] = []

    const totalChunks = Math.ceil(parsedRows.length / CHUNK_SIZE)
    for (let i = 0; i < parsedRows.length; i += CHUNK_SIZE) {
      const chunk = parsedRows.slice(i, i + CHUNK_SIZE)
      try {
        const result = await importProducts(chunk.map((row) => row.data))
        inserted += result.inserted
        result.failed.forEach((item) => {
          const rowNumber = chunk[item.row - 1]?.rowNumber ?? item.row
          failed.push({ ...item, row: rowNumber })
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t('products:import.failed')
        setErrors(message)
        setIsImporting(false)
        return
      }
      const chunkIndex = Math.floor(i / CHUNK_SIZE) + 1
      setProgress(Math.round((chunkIndex / totalChunks) * 100))
    }
    setSummary({ inserted, failed })
    setIsImporting(false)
    onImported()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-label={t('common:buttons.close')}
        type="button"
      />
      <div className="relative w-full max-w-3xl rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('products:import.title')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('products:import.subtitle')}
            </p>
          </div>
          <Button variant="ghost" className="rounded-full px-3 py-3" onClick={() => onOpenChange(false)}>
            <X size={18} />
          </Button>
        </div>
        <div className="space-y-4 px-6 py-5">
          {errors ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
              {errors}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={downloadTemplate}>
              <Download size={16} />
              {t('products:import.download_template')}
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
              <Upload size={16} />
              {fileName ? fileName : t('products:import.choose_file')}
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    void handleFile(file)
                  }
                }}
              />
            </label>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            {t('products:import.template_hint')}
          </div>
          {previewRows.length > 0 ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    {TEMPLATE_HEADERS.map((header) => (
                      <th key={header} className="px-3 py-2 text-left">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={row.rowNumber} className="border-t border-slate-200 dark:border-slate-800">
                      <td className="px-3 py-2">{row.rowNumber}</td>
                      <td className="px-3 py-2">{row.data.sku}</td>
                      <td className="px-3 py-2">{row.data.name}</td>
                      <td className="px-3 py-2">{row.data.brand ?? '—'}</td>
                      <td className="px-3 py-2">{row.data.category ?? '—'}</td>
                      <td className="px-3 py-2">{row.data.status ?? 'active'}</td>
                      <td className="px-3 py-2">{row.data.barcodes?.join('|') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {summary ? (
            <div className="space-y-2">
              <div className="text-sm text-slate-700 dark:text-slate-200">
                {t('products:import.summary', { inserted: summary.inserted, failed: summary.failed.length })}
              </div>
              {summary.failed.length > 0 ? (
                <div className="max-h-40 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  {summary.failed.map((item) => (
                    <div key={`${item.row}-${item.sku ?? 'unknown'}`}>
                      {t('products:import.row_error', { row: item.row, sku: item.sku ?? '-', reason: item.reason })}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {isImporting ? (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t('products:import.progress', { progress })}
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-3 pt-2">
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
            <Button
              type="button"
              disabled={parsedRows.length === 0 || isImporting}
              onClick={() => void handleImport()}
            >
              {isImporting ? t('products:import.importing') : t('products:import.import')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
