import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'

import { Button } from '../../../components/ui/button'
import { resolveBarcode } from '../../../services/scannerApi'
import { newRowKey, parseExcelRows, type EditRow, type ImportedRow } from '../../../utils/dealerCountRows'

type Props = {
  open: boolean
  onClose: () => void
  onAdd: (rows: EditRow[]) => void
}

type Resolved = ImportedRow & { row: EditRow }

/**
 * Excel'dan diller sanovi qatorlarini yuklash: `SKU yoki shtrix-kod | dona | muddat`.
 * Har kod serverda resolve qilinadi; topilmaganlar ham (tanlov bilan) xom kod
 * sifatida qo'shiladi — server yuborishda yana urinadi, admin tafsilotda ko'radi.
 */
export function DealerCountImportDialog({ open, onClose, onAdd }: Props) {
  const { t } = useTranslation(['admin', 'common'])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [total, setTotal] = useState(0)
  const [resolved, setResolved] = useState<Resolved[]>([])
  const [error, setError] = useState<string | null>(null)
  const [includeUnknown, setIncludeUnknown] = useState(true)

  if (!open) return null

  const reset = () => {
    setResolved([])
    setProgress(0)
    setTotal(0)
    setError(null)
  }

  const onFile = async (file: File | null) => {
    if (!file) return
    reset()
    setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const name = wb.SheetNames[0]
      const sheet = name
        ? (XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, defval: '', raw: false }) as string[][])
        : []
      const parsed = parseExcelRows(sheet)
      if (parsed.length === 0) {
        setError(t('admin:dealer_counts.import_empty'))
        return
      }
      setTotal(parsed.length)
      const out: Resolved[] = []
      // Ketma-ket — 4 ta parallel: serverga to'lqin bo'lmasin, jarayon ko'rinib tursin.
      const queue = [...parsed]
      const worker = async () => {
        for (;;) {
          const item = queue.shift()
          if (!item) return
          let row: EditRow = {
            key: newRowKey(),
            code: item.code,
            productId: null,
            sku: null,
            name: null,
            qty: String(item.qty),
            expiry: item.expiry,
            location: item.location,
            status: 'unknown',
          }
          try {
            const r = await resolveBarcode(item.code)
            if (r.type === 'PRODUCT' && r.product) {
              const units = r.scan_kind === 'box' && (r.units_per_scan ?? 0) > 0 ? item.qty * (r.units_per_scan as number) : item.qty
              row = { ...row, productId: r.product.id, name: r.product.name, qty: String(units), status: 'ok' }
            }
          } catch {
            // tarmoq/xato — tanilmagan sifatida qoladi
          }
          out.push({ ...item, row })
          setProgress(out.length)
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()])
      out.sort((a, b) => a.rowNo - b.rowNo)
      setResolved(out)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin:dealer_counts.import_failed'))
    } finally {
      setBusy(false)
    }
  }

  const known = resolved.filter((r) => r.row.status === 'ok')
  const unknown = resolved.filter((r) => r.row.status !== 'ok')

  const add = () => {
    const rows = (includeUnknown ? resolved : known).map((r) => r.row)
    onAdd(rows)
    reset()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <button type="button" className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={onClose} aria-label={t('common:buttons.close')} />
      <div
        className="relative flex max-h-[min(92dvh,800px)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
        role="dialog"
        aria-modal="true"
      >
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="text-base font-semibold">{t('admin:dealer_counts.import_title')}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('admin:dealer_counts.import_hint')}</div>
        </div>
        <div className="flex-1 overflow-auto px-6 py-4 text-sm">
          <input
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
          {busy ? (
            <p className="mt-3 text-slate-500">
              {t('admin:dealer_counts.import_parsing')} {progress}/{total}
            </p>
          ) : null}
          {error ? <p className="mt-3 text-rose-600">{error}</p> : null}
          {resolved.length > 0 && !busy ? (
            <div className="mt-4 space-y-3">
              <p>
                {t('admin:dealer_counts.import_found', { known: known.length, unknown: unknown.length })}
              </p>
              {unknown.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-900/10">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={includeUnknown} onChange={(e) => setIncludeUnknown(e.target.checked)} />
                    <span>{t('admin:dealer_counts.import_include_unknown')}</span>
                  </label>
                  <ul className="mt-2 max-h-40 overflow-auto font-mono text-xs text-amber-800 dark:text-amber-300">
                    {unknown.map((r) => (
                      <li key={r.row.key}>
                        #{r.rowNo} {r.code} × {r.qty}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <Button variant="ghost" onClick={onClose}>
            {t('common:buttons.cancel')}
          </Button>
          <Button disabled={busy || resolved.length === 0} onClick={add}>
            {t('admin:dealer_counts.import_add', { count: (includeUnknown ? resolved : known).length })}
          </Button>
        </div>
      </div>
    </div>
  )
}
