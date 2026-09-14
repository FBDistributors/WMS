import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, FileSpreadsheet, ListPlus, LockOpen, Plus, Save, Send, Store, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { DealerCountImportDialog } from '../../admin/components/dealerCounts/DealerCountImportDialog'
import { TableScrollArea } from '../../components/TableScrollArea'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { LoadingOverlay } from '../../components/ui/LoadingOverlay'
import { useAppToast } from '../../feedback/useAppToast'
import { useAuth } from '../../rbac/AuthProvider'
import { getApiErrorMessage } from '../../services/apiClient'
import {
  createDealerCount,
  deleteDealerCount,
  getDealerCount,
  getDealers,
  listDealerCounts,
  prefillDealerCount,
  releaseDealerCount,
  submitDealerCount,
  updateDealerCount,
  type DealerCountOut,
  type DealerCountStatus,
  type DealerOut,
  type PrefillSource,
} from '../../services/dealerCountsApi'
import { getProducts, type Product } from '../../services/productsApi'
import { resolveBarcode } from '../../services/scannerApi'
import {
  emptyRow,
  mergeResolvedRow,
  parseQty,
  rowsFromCount,
  rowsToApiLines,
  totals,
  type EditRow,
} from '../../utils/dealerCountRows'

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

const CLIENT_UUID_KEY = 'dealer_count_new_client_uuid'

function clientUuid(): string {
  try {
    const existing = sessionStorage.getItem(CLIENT_UUID_KEY)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    sessionStorage.setItem(CLIENT_UUID_KEY, fresh)
    return fresh
  } catch {
    return crypto.randomUUID()
  }
}

function fmtUnits(v: number) {
  return v.toLocaleString('en-US')
}

/**
 * Diller sanovini web'da jadvalda kiritish (yangi yoki draft tahriri).
 * Serverdagi qoidalar mobil bilan bir xil; draft serverda saqlanadi.
 */
export function DealerCountEditPage() {
  const { t } = useTranslation(['admin', 'common'])
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showError, showSuccess } = useAppToast()
  const { has } = useAuth()

  const [dealers, setDealers] = useState<DealerOut[]>([])
  const [dealerId, setDealerId] = useState('')
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<EditRow[]>(() => [emptyRow()])
  const [countId, setCountId] = useState<string | null>(id ?? null)
  const [status, setStatus] = useState<DealerCountStatus>('draft')
  const [assignedName, setAssignedName] = useState<string | null>(null)
  // Yangi sanovda tanlangan dillerning ochiq ro'yxati — bitta diller, bitta ochiq ro'yxat.
  const [openExisting, setOpenExisting] = useState<DealerCountOut | null>(null)
  const [prefillOpen, setPrefillOpen] = useState(false)
  const [prefillSources, setPrefillSources] = useState<PrefillSource[]>(['smartup'])
  // Yuborishda sanalmagan qatorlar: 0 deb yozish (standart) yoki bo'sh qoldirish.
  const [uncountedPolicy, setUncountedPolicy] = useState<'zero' | 'keep'>('zero')
  const [loading, setLoading] = useState(Boolean(id))
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [suggest, setSuggest] = useState<{ key: string; items: Product[] } | null>(null)
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const codeRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const sum = useMemo(() => totals(rows), [rows])

  useEffect(() => {
    getDealers()
      .then(setDealers)
      .catch(() => setDealers([]))
  }, [])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    getDealerCount(id)
      .then((c: DealerCountOut) => {
        setDealerId(c.dealer_org_id)
        setNote(c.note ?? '')
        setStatus(c.status)
        setAssignedName(c.assigned_to_name)
        setRows([...rowsFromCount(c), emptyRow()])
      })
      .catch((err) => showError(getApiErrorMessage(err, t('admin:dealer_counts.load_failed'))))
      .finally(() => setLoading(false))
  }, [id, showError, t])

  useEffect(() => {
    if (countId || !dealerId) {
      setOpenExisting(null)
      return
    }
    let cancelled = false
    listDealerCounts({ dealer_org_id: dealerId, status: 'draft,in_progress', limit: 1 })
      .then((r) => {
        if (!cancelled) setOpenExisting(r.items[0] ?? null)
      })
      .catch(() => {
        if (!cancelled) setOpenExisting(null)
      })
    return () => {
      cancelled = true
    }
  }, [countId, dealerId])

  const openExistingList = () => {
    if (!openExisting) return
    // Yangi va tahrir sahifasi bitta komponent — holat qo'lda almashtiriladi.
    setDirty(false)
    setCountId(openExisting.id)
    navigate(`/admin/dealer-counts/${openExisting.id}/edit`, { replace: true })
  }

  // Saqlanmagan o'zgarish bilan sahifani yopish/yangilashdan ogohlantirish.
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const patchRow = useCallback((key: string, patch: Partial<EditRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    setDirty(true)
  }, [])

  const ensureTrailingEmpty = useCallback((list: EditRow[]) => {
    const last = list[list.length - 1]
    return last && last.status === 'empty' && !last.code ? list : [...list, emptyRow()]
  }, [])

  const focusQty = (key: string) => {
    requestAnimationFrame(() => qtyRefs.current[key]?.focus())
  }

  /** Kod → mahsulot: skaner (quti kodi ham), keyin SKU/nom bo'yicha aniq mos. */
  const resolveRow = async (row: EditRow, codeOverride?: string) => {
    const code = (codeOverride ?? row.code).trim()
    if (!code) return
    setSuggest(null)
    patchRow(row.key, { code, status: 'resolving' })
    // Fakt qoldiqni xodim o'zi yozadi — "1" yoki quti hajmi avtomatik qo'yilmaydi
    // (tasodifan saqlab yuborish xavfi). Quti kodi bo'lsa hajm faqat maslahat tugmasi.
    let resolved: EditRow = { ...row, code, status: 'unknown', productId: null, sku: null, name: null, boxUnits: undefined }
    try {
      const r = await resolveBarcode(code)
      if (r.type === 'PRODUCT' && r.product) {
        resolved = { ...resolved, productId: r.product.id, name: r.product.name, status: 'ok' }
        if (r.scan_kind === 'box' && (r.units_per_scan ?? 0) > 0) resolved = { ...resolved, boxUnits: r.units_per_scan as number }
      } else {
        const list = await getProducts({ search: code, limit: 5 })
        const exact = list.items.find((p) => p.sku.toLowerCase() === code.toLowerCase() || p.barcode === code)
        if (exact) resolved = { ...resolved, productId: exact.id, sku: exact.sku, name: exact.name, status: 'ok' }
      }
    } catch {
      // internet yo'q / xato — tanilmagan sifatida qoladi, server yuborishda yana urinadi
    }
    setRows((prev) => {
      const { rows: next, mergedInto } = mergeResolvedRow(prev, resolved)
      if (mergedInto) {
        setHighlight(mergedInto)
        setTimeout(() => setHighlight(null), 1500)
        const withEmpty = ensureTrailingEmpty(next)
        const emptyKey = withEmpty[withEmpty.length - 1].key
        requestAnimationFrame(() => codeRefs.current[emptyKey]?.focus())
        return withEmpty
      }
      focusQty(resolved.key)
      return ensureTrailingEmpty(next)
    })
    setDirty(true)
  }

  const onCodeChange = (row: EditRow, value: string) => {
    patchRow(row.key, { code: value, status: value.trim() ? row.status : 'empty' })
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    const q = value.trim()
    if (q.length < 2) {
      setSuggest(null)
      return
    }
    suggestTimer.current = setTimeout(() => {
      getProducts({ search: q, limit: 8 })
        .then((res) => setSuggest({ key: row.key, items: res.items }))
        .catch(() => setSuggest(null))
    }, 300)
  }

  const pickSuggestion = (row: EditRow, p: Product) => {
    setSuggest(null)
    const resolved: EditRow = { ...row, code: p.sku, productId: p.id, sku: p.sku, name: p.name, status: 'ok', boxUnits: undefined }
    setRows((prev) => {
      const { rows: next, mergedInto } = mergeResolvedRow(prev, resolved)
      if (mergedInto) {
        setHighlight(mergedInto)
        setTimeout(() => setHighlight(null), 1500)
        return ensureTrailingEmpty(next)
      }
      focusQty(resolved.key)
      return ensureTrailingEmpty(next)
    })
    setDirty(true)
  }

  const onQtyEnter = (row: EditRow) => {
    setRows((prev) => {
      const next = ensureTrailingEmpty(prev)
      const idx = next.findIndex((r) => r.key === row.key)
      const target = next[idx + 1] ?? next[next.length - 1]
      requestAnimationFrame(() => codeRefs.current[target.key]?.focus())
      return next
    })
  }

  const removeRow = (key: string) => {
    setRows((prev) => ensureTrailingEmpty(prev.filter((r) => r.key !== key)))
    setDirty(true)
  }

  const addImported = (imported: EditRow[]) => {
    setRows((prev) => {
      let next = prev.filter((r) => r.status !== 'empty' || r.code)
      for (const r of imported) next = mergeResolvedRow(next, r).rows
      return ensureTrailingEmpty(next)
    })
    setDirty(true)
  }

  /** Saqlash: birinchi marta POST (client_uuid), keyin PUT. Qaytaradi: server id. */
  const save = async (): Promise<string | null> => {
    if (!dealerId) {
      showError(t('admin:dealer_counts.dealer_required'))
      return null
    }
    const lines = rowsToApiLines(rows)
    setBusy(true)
    try {
      let saved: DealerCountOut
      if (countId) {
        saved = await updateDealerCount(countId, { note: note.trim() || undefined, lines })
      } else {
        saved = await createDealerCount({ client_uuid: clientUuid(), dealer_org_id: dealerId, note: note.trim() || undefined, lines, submit: false, source: 'web' })
        setCountId(saved.id)
        try {
          sessionStorage.removeItem(CLIENT_UUID_KEY)
        } catch {
          /* ignore */
        }
        navigate(`/admin/dealer-counts/${saved.id}/edit`, { replace: true })
      }
      setRows([...rowsFromCount(saved), emptyRow()])
      setDirty(false)
      showSuccess(t('admin:dealer_counts.saved'))
      return saved.id
    } catch (err) {
      showError(getApiErrorMessage(err, t('admin:dealer_counts.save_failed')))
      return null
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    setConfirmSubmit(false)
    const savedId = await save()
    if (!savedId) return
    setBusy(true)
    try {
      const res = await submitDealerCount(savedId, uncountedPolicy)
      setDirty(false)
      showSuccess(res.warning ? `${t('admin:dealer_counts.submit_ok')} — ${res.warning}` : t('admin:dealer_counts.submit_ok'))
      navigate(`/admin/dealer-counts/${savedId}`)
    } catch (err) {
      showError(getApiErrorMessage(err, t('admin:dealer_counts.save_failed')))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setConfirmDelete(false)
    if (!countId) {
      navigate('/admin/dealer-counts')
      return
    }
    setBusy(true)
    try {
      await deleteDealerCount(countId)
      setDirty(false)
      navigate('/admin/dealer-counts')
    } catch (err) {
      showError(getApiErrorMessage(err, t('admin:dealer_counts.save_failed')))
    } finally {
      setBusy(false)
    }
  }

  /** Ro'yxatni manbalardan to'ldirish (serverda) — mavjud qatorlarga tegmaydi. */
  const prefill = async () => {
    setPrefillOpen(false)
    let cid = countId
    if (!cid) {
      // Avval hujjat bo'lishi kerak — bo'sh draft yaratiladi.
      cid = await save()
      if (!cid) return
    }
    setBusy(true)
    try {
      const r = await prefillDealerCount(cid, prefillSources)
      setStatus(r.count.status)
      setRows([...rowsFromCount(r.count), emptyRow()])
      setDirty(false)
      showSuccess(t('admin:dealer_counts.prefill_result', { added: r.added, skipped: r.skipped, missing: r.not_in_catalog }))
    } catch (err) {
      showError(getApiErrorMessage(err, t('admin:dealer_counts.save_failed')))
    } finally {
      setBusy(false)
    }
  }

  /** Telefon qulfini ochish (admin): in_progress → draft. */
  const release = async () => {
    if (!countId) return
    setBusy(true)
    try {
      const c = await releaseDealerCount(countId)
      setStatus(c.status)
      setAssignedName(null)
      setRows([...rowsFromCount(c), emptyRow()])
    } catch (err) {
      showError(getApiErrorMessage(err, t('admin:dealer_counts.save_failed')))
    } finally {
      setBusy(false)
    }
  }

  const dealerName = dealers.find((d) => d.org_id === dealerId)?.name ?? ''
  const locked = status === 'in_progress'
  const frozen = status === 'submitted' || locked
  // Bu dillerda ochiq ro'yxat bor — ikkinchisi yaratilmaydi (server ham rad etadi).
  const blocked = !countId && openExisting !== null

  return (
    <AdminLayout
      titleSlot={
        <div className="flex items-center gap-2">
          <Store size={18} />
          <span className="text-sm font-semibold">
            {countId ? t('admin:dealer_counts.edit_title') : t('admin:dealer_counts.new_title')}
          </span>
        </div>
      }
      backTo="/admin/dealer-counts"
      actionSlot={
        <div className="flex flex-wrap gap-2">
          {locked && has('admin:access') ? (
            <Button variant="ghost" disabled={busy} onClick={() => void release()}>
              <LockOpen size={16} className="mr-1" />
              {t('admin:dealer_counts.release')}
            </Button>
          ) : null}
          {!frozen ? (
            <>
              <Button variant="ghost" disabled={busy || !dealerId || blocked} onClick={() => setPrefillOpen(true)}>
                <ListPlus size={16} className="mr-1" />
                {t('admin:dealer_counts.prefill_button')}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setImportOpen(true)}>
                <FileSpreadsheet size={16} className="mr-1" />
                {t('admin:dealer_counts.import_excel')}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>
                <Trash2 size={16} className="mr-1" />
                {t('admin:dealer_counts.delete_draft')}
              </Button>
              {/* To'ldirish/saqlashdan keyin hujjat serverda — o'chiq tugma "ishlamayapti" deb o'qilmasin. */}
              <Button variant="ghost" disabled={busy || !dirty || blocked} onClick={() => void save()}>
                {countId && !dirty ? <Check size={16} className="mr-1" /> : <Save size={16} className="mr-1" />}
                {countId && !dirty ? t('admin:dealer_counts.saved') : t('admin:dealer_counts.save')}
              </Button>
              <Button disabled={busy || sum.lines === 0 || !dealerId || blocked} onClick={() => setConfirmSubmit(true)}>
                <Send size={16} className="mr-1" />
                {t('admin:dealer_counts.submit')}
              </Button>
            </>
          ) : null}
        </div>
      }
    >
      <div className="relative">
        {loading || busy ? <LoadingOverlay label={t('common:messages.loading')} /> : null}

        {locked ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            {t('admin:dealer_counts.locked_banner', { name: assignedName ?? '—' })}
          </div>
        ) : null}

        <Card className="mb-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              {t('admin:dealer_counts.col_dealer')}
              <select
                className={inputCls}
                value={dealerId}
                disabled={Boolean(countId) || frozen}
                onChange={(e) => {
                  setDealerId(e.target.value)
                  setDirty(true)
                }}
              >
                <option value="">—</option>
                {dealers.map((d) => (
                  <option key={d.org_id} value={d.org_id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500 sm:col-span-2">
              {t('admin:dealer_counts.note')}
              <input
                className={inputCls}
                value={note}
                disabled={frozen}
                onChange={(e) => {
                  setNote(e.target.value)
                  setDirty(true)
                }}
              />
            </label>
          </div>
          <div className="mt-3 text-xs text-slate-500">
            {t('admin:dealer_counts.col_lines')}: <b>{sum.lines}</b> · {t('admin:dealer_counts.col_units')}:{' '}
            <b>{fmtUnits(sum.units)}</b>
            {sum.unknown > 0 ? (
              <span className="ml-2 text-amber-700 dark:text-amber-300">
                {t('admin:dealer_counts.unknown_hint', { count: sum.unknown })}
              </span>
            ) : null}
            {sum.missingQty > 0 ? (
              <span className="ml-2 text-amber-700 dark:text-amber-300">
                {t('admin:dealer_counts.uncounted_rows', { count: sum.missingQty, total: sum.sheet })}
              </span>
            ) : null}
            {/* Yangi hujjatda diller tanlash — birinchi qadam, xato emas: keyingi qadamni aytamiz. */}
            {dirty && countId ? (
              <span className="ml-2 text-amber-700 dark:text-amber-300">{t('admin:dealer_counts.unsaved')}</span>
            ) : null}
            {!dirty && countId && status === 'draft' ? (
              <span className="ml-2 text-emerald-700 dark:text-emerald-300">{t('admin:dealer_counts.saved_on_server')}</span>
            ) : null}
          </div>
          {blocked && openExisting ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
              <span>
                {t('admin:dealer_counts.open_exists', {
                  done: openExisting.counted_lines,
                  total: openExisting.sheet_lines,
                  status:
                    openExisting.status === 'in_progress'
                      ? `${t('admin:dealer_counts.status_in_progress')} · ${openExisting.assigned_to_name ?? ''}`
                      : t('admin:dealer_counts.status_draft'),
                })}
              </span>
              <Button variant="ghost" onClick={openExistingList}>
                {t('admin:dealer_counts.open_exists_button')}
              </Button>
            </div>
          ) : !countId ? (
            <div className="mt-2 text-xs text-indigo-600 dark:text-indigo-300">
              {dealerId ? t('admin:dealer_counts.new_next_step') : t('admin:dealer_counts.new_pick_dealer')}
            </div>
          ) : null}
        </Card>

        <Card className="p-0">
          <TableScrollArea>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="w-10 px-2 py-2 text-left">#</th>
                  <th className="w-56 px-2 py-2 text-left">{t('admin:dealer_counts.col_code')}</th>
                  <th className="px-2 py-2 text-left">{t('admin:dealer_counts.col_product')}</th>
                  <th className="w-24 px-2 py-2 text-right" title={t('admin:dealer_counts.col_snapshot_hint')}>
                    {t('admin:dealer_counts.col_snapshot')}
                  </th>
                  <th className="w-28 px-2 py-2 text-left">{t('admin:dealer_counts.col_qty')}</th>
                  <th className="w-40 px-2 py-2 text-left">{t('admin:dealer_counts.col_expiry')}</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.key}
                    className={
                      'border-b border-slate-100 dark:border-slate-800 ' +
                      (highlight === r.key ? 'bg-emerald-50 dark:bg-emerald-900/20 ' : '') +
                      (r.status === 'unknown' ? 'bg-amber-50/60 dark:bg-amber-900/10' : '')
                    }
                  >
                    <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                    <td className="relative px-2 py-1.5">
                      <input
                        ref={(el) => {
                          codeRefs.current[r.key] = el
                        }}
                        className={inputCls + ' font-mono'}
                        value={r.code}
                        disabled={frozen}
                        placeholder={t('admin:dealer_counts.code_placeholder')}
                        onChange={(e) => onCodeChange(r, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void resolveRow(r)
                          }
                          if (e.key === 'Escape') setSuggest(null)
                        }}
                        onBlur={() => {
                          if (r.code.trim() && r.status !== 'ok' && r.status !== 'resolving') {
                            setTimeout(() => void resolveRow(r), 150)
                          }
                        }}
                      />
                      {suggest && suggest.key === r.key && suggest.items.length > 0 ? (
                        <div className="absolute left-2 top-full z-20 mt-1 w-[28rem] max-w-[80vw] rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                          {suggest.items.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => pickSuggestion(r, p)}
                            >
                              <span className="font-mono text-xs text-slate-500">{p.sku}</span> {p.name}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.status === 'resolving' ? (
                        <span className="text-xs text-slate-400">{t('admin:dealer_counts.resolving')}</span>
                      ) : r.status === 'unknown' ? (
                        <span className="text-amber-700 dark:text-amber-300">{t('admin:dealer_counts.unknown_barcode')}</span>
                      ) : (
                        <span>
                          {r.name ?? ''}
                          {r.sku ? <span className="ml-2 font-mono text-xs text-slate-400">{r.sku}</span> : null}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">
                      {r.snapshotQty != null ? fmtUnits(r.snapshotQty) : ''}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        ref={(el) => {
                          qtyRefs.current[r.key] = el
                        }}
                        className={inputCls + ' text-right tabular-nums'}
                        inputMode="numeric"
                        value={r.qty}
                        disabled={frozen || r.status === 'empty'}
                        onChange={(e) => patchRow(r.key, { qty: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            onQtyEnter(r)
                          }
                        }}
                      />
                      {r.boxUnits && !frozen ? (
                        <button
                          type="button"
                          className="mt-1 text-xs text-indigo-600 hover:underline dark:text-indigo-300"
                          title={t('admin:dealer_counts.box_units_hint', { n: r.boxUnits })}
                          onClick={() => patchRow(r.key, { qty: String(parseQty(r.qty) + (r.boxUnits ?? 0)) })}
                        >
                          +{r.boxUnits}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="month"
                        className={inputCls}
                        value={r.expiry}
                        disabled={frozen || r.status === 'empty'}
                        onChange={(e) => patchRow(r.key, { expiry: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {r.status !== 'empty' && !frozen ? (
                        <button type="button" className="p-1 text-slate-400 hover:text-rose-600" onClick={() => removeRow(r.key)} aria-label={t('common:buttons.close')}>
                          <X size={16} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollArea>
          {!frozen ? (
            <div className="border-t border-slate-100 px-3 py-2 dark:border-slate-800">
              <Button variant="ghost" onClick={() => setRows((prev) => [...prev, emptyRow()])}>
                <Plus size={16} className="mr-1" />
                {t('admin:dealer_counts.add_row')}
              </Button>
            </div>
          ) : null}
        </Card>
      </div>

      <DealerCountImportDialog open={importOpen} onClose={() => setImportOpen(false)} onAdd={addImported} />
      {prefillOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <button type="button" className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setPrefillOpen(false)} aria-label={t('common:buttons.close')} />
          <div className="relative w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100" role="dialog" aria-modal="true">
            <div className="text-base font-semibold">{t('admin:dealer_counts.prefill_title')}</div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('admin:dealer_counts.prefill_hint')}</p>
            <div className="mt-4 space-y-2 text-sm">
              {(['smartup', 'shipped', 'all'] as PrefillSource[]).map((src) => (
                <label key={src} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={prefillSources.includes(src)}
                    onChange={(e) =>
                      setPrefillSources((prev) => (e.target.checked ? [...prev, src] : prev.filter((s) => s !== src)))
                    }
                  />
                  <span>{t(`admin:dealer_counts.prefill_src_${src}`)}</span>
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPrefillOpen(false)}>
                {t('common:buttons.cancel')}
              </Button>
              <Button disabled={prefillSources.length === 0} onClick={() => void prefill()}>
                {t('admin:dealer_counts.prefill_button')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmSubmit && sum.missingQty > 0 ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <button type="button" className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setConfirmSubmit(false)} aria-label={t('common:buttons.close')} />
          <div className="relative w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100" role="dialog" aria-modal="true">
            <div className="text-base font-semibold">{t('admin:dealer_counts.submit')}</div>
            <p className="mt-2 text-sm">
              {t('admin:dealer_counts.submit_confirm', { dealer: dealerName, lines: sum.lines, units: fmtUnits(sum.units) })}
            </p>
            <p className="mt-3 text-sm font-medium text-amber-700 dark:text-amber-300">
              {t('admin:dealer_counts.uncounted_question', { count: sum.missingQty })}
            </p>
            <div className="mt-2 space-y-2 text-sm">
              <label className="flex items-start gap-2">
                <input type="radio" name="uncounted" checked={uncountedPolicy === 'zero'} onChange={() => setUncountedPolicy('zero')} />
                <span>{t('admin:dealer_counts.uncounted_zero')}</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="uncounted" checked={uncountedPolicy === 'keep'} onChange={() => setUncountedPolicy('keep')} />
                <span>{t('admin:dealer_counts.uncounted_keep')}</span>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmSubmit(false)}>
                {t('common:buttons.cancel')}
              </Button>
              <Button disabled={busy} onClick={() => void submit()}>
                {t('admin:dealer_counts.submit')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmSubmit && sum.missingQty === 0}
        title={t('admin:dealer_counts.submit')}
        message={t('admin:dealer_counts.submit_confirm', { dealer: dealerName, lines: sum.lines, units: fmtUnits(sum.units) })}
        confirmLabel={t('admin:dealer_counts.submit')}
        cancelLabel={t('common:buttons.cancel')}
        onConfirm={submit}
        onCancel={() => setConfirmSubmit(false)}
        loading={busy}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={t('admin:dealer_counts.delete_draft')}
        message={t('admin:dealer_counts.delete_confirm')}
        confirmLabel={t('admin:dealer_counts.delete_draft')}
        cancelLabel={t('common:buttons.cancel')}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
        variant="danger"
        loading={busy}
      />
    </AdminLayout>
  )
}
