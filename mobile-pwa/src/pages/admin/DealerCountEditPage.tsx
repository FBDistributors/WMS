import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Eye, FileSpreadsheet, History, ListPlus, Plus, RefreshCw, Store, Trash2, X } from 'lucide-react'
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
import { getApiErrorMessage } from '../../services/apiClient'
import {
  addDealerCountLines,
  createDealerCount,
  deleteDealerCount,
  deleteDealerCountLine,
  getDealerCount,
  getDealerCountLineEntries,
  getDealers,
  listDealerCounts,
  patchDealerCountLine,
  prefillDealerCount,
  type DealerCountEntryOut,
  type DealerCountLineIn,
  type DealerCountLinePatch,
  type DealerCountOut,
  type DealerOut,
  type PrefillSource,
} from '../../services/dealerCountsApi'
import { getProducts, type Product } from '../../services/productsApi'
import { resolveBarcode } from '../../services/scannerApi'
import {
  emptyRow,
  expiryToApi,
  normLocation,
  parseQty,
  qtyValue,
  rowToLineIn,
  rowsFromCount,
  totals,
  type EditRow,
} from '../../utils/dealerCountRows'
import { exportDealerCountExcel } from '../../utils/dealerCountExcel'
import { useDealerCountAutoRefresh } from './dealerCountAutoRefresh'

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

function fmtUnits(v: number | string) {
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—'
}

function fmtTime(v: string | null | undefined) {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

/** Serverdagi qiymat — o'zgargan-o'zgarmaganini bilish uchun. */
type Saved = { qty: number | null; expiry: string | null; location: string }

function savedOf(c: DealerCountOut | null): Map<string, Saved> {
  const m = new Map<string, Saved>()
  for (const ln of c?.lines ?? []) {
    m.set(ln.id, {
      qty: ln.qty == null ? null : Number(ln.qty),
      expiry: ln.expiry_date ?? null,
      location: ln.location_code ?? '',
    })
  }
  return m
}

/**
 * Diller sanovi sahifasi (yangi yoki mavjud). Holat yo'q: ro'yxat shu yerda tuziladi,
 * xodimlar telefonda sanaydi. Har qator o'zgarishi darhol serverga alohida yoziladi —
 * telefon sanagan boshqa qatorlarga tegilmaydi.
 */
export function DealerCountEditPage() {
  const { t } = useTranslation(['admin', 'common'])
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showError, showSuccess } = useAppToast()

  const [dealers, setDealers] = useState<DealerOut[]>([])
  const [dealerId, setDealerId] = useState('')
  const [note, setNote] = useState('')
  const [countId, setCountId] = useState<string | null>(id ?? null)
  const [count, setCount] = useState<DealerCountOut | null>(null)
  const [rows, setRows] = useState<EditRow[]>(() => [emptyRow()])
  // Yangi sanovda tanlangan dillerning faol sanovi — yangisi yaratilsa u yopiladi.
  const [activeExisting, setActiveExisting] = useState<DealerCountOut | null>(null)
  const [loading, setLoading] = useState(Boolean(id))
  const [busy, setBusy] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [prefillOpen, setPrefillOpen] = useState(false)
  const [prefillSources, setPrefillSources] = useState<PrefillSource[]>(['smartup'])
  const [importOpen, setImportOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const pendingAction = useRef<((cid: string) => Promise<void>) | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  // Qator kiritishlari tarixi (kim qancha sanadi / qo'shdi / tuzatdi).
  const [history, setHistory] = useState<{ title: string; items: DealerCountEntryOut[] | null } | null>(null)
  const [suggest, setSuggest] = useState<{ key: string; items: Product[] } | null>(null)
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const codeRefs = useRef<Record<string, HTMLInputElement | null>>({})
  // Har saqlash oshiradi: fonda kelgan eskiroq server javobi yangi o'zgarish ustidan yozilmasin.
  const mutationSeq = useRef(0)

  const sum = useMemo(() => totals(rows), [rows])
  const saved = useMemo(() => savedOf(count), [count])

  /** Server javobini jadvalga: qatorlar kaliti — server id, shuning uchun fokus saqlanadi. */
  const apply = useCallback((c: DealerCountOut) => {
    setCount(c)
    setRows((prev) => {
      const editing = new Map(prev.filter((r) => r.lineId && r.editing).map((r) => [r.lineId as string, r]))
      const fresh = rowsFromCount(c).map((r) => {
        const e = r.lineId ? editing.get(r.lineId) : undefined
        // Hali saqlanmagan (yozilayotgan) qiymat ustidan yozilmasin.
        return { ...r, key: r.lineId as string, ...(e ? { qty: e.qty, location: e.location, editing: true } : {}) }
      })
      const pendingNew = prev.filter((r) => !r.lineId && (r.code.trim() || r.status === 'resolving'))
      return [...fresh, ...(pendingNew.length ? pendingNew : [emptyRow()])]
    })
  }, [])

  useEffect(() => {
    getDealers()
      .then(setDealers)
      .catch(() => setDealers([]))
  }, [])

  useEffect(() => {
    if (!id) return
    setCountId(id)
    setLoading(true)
    getDealerCount(id)
      .then((c) => {
        setDealerId(c.dealer_org_id)
        setNote(c.note ?? '')
        apply(c)
      })
      .catch((err) => showError(getApiErrorMessage(err, t('admin:dealer_counts.load_failed'))))
      .finally(() => setLoading(false))
  }, [id, apply, showError, t])

  useEffect(() => {
    if (countId || !dealerId) {
      setActiveExisting(null)
      return
    }
    let cancelled = false
    listDealerCounts({ dealer_org_id: dealerId, active: true, limit: 1 })
      .then((r) => {
        if (!cancelled) setActiveExisting(r.items[0] ?? null)
      })
      .catch(() => {
        if (!cancelled) setActiveExisting(null)
      })
    return () => {
      cancelled = true
    }
  }, [countId, dealerId])

  const run = async (fn: () => Promise<void>) => {
    mutationSeq.current += 1
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      showError(getApiErrorMessage(err, t('admin:dealer_counts.save_failed')))
    } finally {
      setBusy(false)
    }
  }

  const create = async (replace: boolean): Promise<string> => {
    const c = await createDealerCount({
      client_uuid: clientUuid(),
      dealer_org_id: dealerId,
      note: note.trim() || undefined,
      replace,
      source: 'web',
    })
    try {
      sessionStorage.removeItem(CLIENT_UUID_KEY)
    } catch {
      /* ignore */
    }
    setCountId(c.id)
    apply(c)
    navigate(`/admin/dealer-counts/${c.id}/edit`, { replace: true })
    return c.id
  }

  /** Hujjat kerak bo'lgan amal: yangi sanovda avval yaratiladi (faol sanov bo'lsa — tasdiq bilan). */
  const withCount = async (action: (cid: string) => Promise<void>) => {
    if (countId) {
      await run(() => action(countId))
      return
    }
    if (!dealerId) {
      showError(t('admin:dealer_counts.dealer_required'))
      return
    }
    if (activeExisting) {
      pendingAction.current = action
      setConfirmReplace(true)
      return
    }
    await run(async () => action(await create(false)))
  }

  const confirmReplaceGo = async () => {
    setConfirmReplace(false)
    const action = pendingAction.current
    pendingAction.current = null
    await run(async () => {
      const cid = await create(true)
      if (action) await action(cid)
    })
  }

  const focusLine = (pred: (r: EditRow) => boolean) => {
    requestAnimationFrame(() => {
      setRows((prev) => {
        const hit = prev.find((r) => r.lineId && pred(r))
        if (hit) {
          qtyRefs.current[hit.key]?.focus()
          setHighlight(hit.key)
          setTimeout(() => setHighlight(null), 1500)
        }
        return prev
      })
    })
  }

  /** Yangi (pastki) qator tanildi → serverga qo'shiladi; shu mahsulot+muddat+joy bor bo'lsa — o'shanga o'tiladi. */
  const addResolved = async (resolved: EditRow) => {
    // "Qidirilmoqda" holatidan chiqariladi — tasdiq bekor qilinsa ham qator tahrirlanadigan qoladi.
    setRows((prev) => prev.map((r) => (r.key === resolved.key ? resolved : r)))
    const same = (r: EditRow) =>
      r.productId === resolved.productId &&
      r.expiry === resolved.expiry &&
      normLocation(r.location) === normLocation(resolved.location)
    if (resolved.productId && rows.some((r) => r.lineId && same(r))) {
      setRows((prev) => prev.map((r) => (r.key === resolved.key ? emptyRow() : r)))
      focusLine(same)
      return
    }
    const line = rowToLineIn(resolved)
    if (!line) return
    await withCount(async (cid) => {
      const res = await addDealerCountLines(cid, [line])
      setRows((prev) => prev.filter((r) => r.key !== resolved.key))
      apply(res.count)
      if (resolved.productId) focusLine(same)
    })
  }

  /** Kod → mahsulot: skaner (quti kodi ham), keyin SKU/nom bo'yicha aniq mos. */
  const resolveRow = async (row: EditRow, codeOverride?: string) => {
    const code = (codeOverride ?? row.code).trim()
    if (!code || row.lineId) return
    setSuggest(null)
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, code, status: 'resolving' } : r)))
    let resolved: EditRow = { ...row, code, status: 'unknown', productId: null, sku: null, name: null }
    try {
      const r = await resolveBarcode(code)
      if (r.type === 'PRODUCT' && r.product) {
        resolved = { ...resolved, productId: r.product.id, name: r.product.name, status: 'ok' }
      } else {
        const list = await getProducts({ search: code, limit: 5 })
        const exact = list.items.find((p) => p.sku.toLowerCase() === code.toLowerCase() || p.barcode === code)
        if (exact) resolved = { ...resolved, productId: exact.id, sku: exact.sku, name: exact.name, status: 'ok' }
      }
    } catch {
      // internet yo'q / xato — tanilmagan sifatida qo'shiladi, server ham urinib ko'radi
    }
    await addResolved(resolved)
  }

  const onCodeChange = (row: EditRow, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.key === row.key ? { ...r, code: value, status: value.trim() ? r.status : 'empty' } : r)),
    )
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
    void addResolved({ ...row, code: p.sku, productId: p.id, sku: p.sku, name: p.name, status: 'ok' })
  }

  const editRow = (key: string, patch: Partial<EditRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch, editing: true } : r)))

  /** Saqlangan qatorni o'zgartirish — faqat haqiqatan o'zgargan maydon yuboriladi. */
  const commitRow = async (row: EditRow, field: 'qty' | 'expiry' | 'location', value?: string) => {
    if (!countId || !row.lineId) return
    const s = saved.get(row.lineId)
    const patch: DealerCountLinePatch = {}
    if (field === 'qty') {
      const q = qtyValue(row.qty)
      if (q === undefined) {
        showError(t('admin:dealer_counts.invalid_qty'))
        return
      }
      if (q !== s?.qty) patch.qty = q
    } else if (field === 'expiry') {
      const e = expiryToApi(value ?? row.expiry) ?? null
      if (e !== s?.expiry) patch.expiry_date = e
    } else {
      const l = normLocation(row.location)
      if (l !== (s?.location ?? '')) patch.location_code = l || null
    }
    if (Object.keys(patch).length === 0) {
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, editing: false } : r)))
      return
    }
    mutationSeq.current += 1
    setSavingKey(row.key)
    try {
      const c = await patchDealerCountLine(countId, row.lineId, patch)
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, editing: false } : r)))
      apply(c)
    } catch (err) {
      showError(getApiErrorMessage(err, t('admin:dealer_counts.save_failed')))
    } finally {
      setSavingKey(null)
    }
  }

  const removeRow = async (row: EditRow) => {
    if (!row.lineId) {
      setRows((prev) => prev.filter((r) => r.key !== row.key))
      return
    }
    if (!countId) return
    mutationSeq.current += 1
    setSavingKey(row.key)
    try {
      apply(await deleteDealerCountLine(countId, row.lineId))
    } catch (err) {
      showError(getApiErrorMessage(err, t('admin:dealer_counts.save_failed')))
    } finally {
      setSavingKey(null)
    }
  }

  const addImported = (imported: EditRow[]) => {
    const lines = imported.map(rowToLineIn).filter((x): x is DealerCountLineIn => x !== null)
    if (lines.length === 0) return
    void withCount(async (cid) => {
      const res = await addDealerCountLines(cid, lines)
      apply(res.count)
      showSuccess(t('admin:dealer_counts.lines_added', { added: res.added, updated: res.updated }))
    })
  }

  const prefill = () => {
    setPrefillOpen(false)
    void withCount(async (cid) => {
      const r = await prefillDealerCount(cid, prefillSources)
      apply(r.count)
      showSuccess(t('admin:dealer_counts.prefill_result', { added: r.added, skipped: r.skipped, missing: r.not_in_catalog }))
    })
  }

  /** Excel'ga — telefonlarda hozirgina sanalganlar ham tushishi uchun serverdan yangi holat olinadi. */
  const exportExcel = () => {
    if (!countId) return
    void run(async () => {
      const fresh = await getDealerCount(countId)
      apply(fresh)
      await exportDealerCountExcel(fresh, t)
    })
  }

  const refresh = () => {
    if (!countId) return
    void run(async () => apply(await getDealerCount(countId)))
  }

  const remove = async () => {
    setConfirmDelete(false)
    if (!countId) {
      navigate('/admin/dealer-counts')
      return
    }
    await run(async () => {
      await deleteDealerCount(countId)
      navigate('/admin/dealer-counts')
    })
  }

  const openHistory = async (row: EditRow) => {
    if (!countId || !row.lineId) return
    setHistory({ title: row.name ?? row.code, items: null })
    try {
      const items = await getDealerCountLineEntries(countId, row.lineId)
      setHistory({ title: row.name ?? row.code, items })
    } catch (err) {
      setHistory(null)
      showError(getApiErrorMessage(err, t('admin:dealer_counts.load_failed')))
    }
  }

  const openActive = () => {
    if (!activeExisting) return
    navigate(`/admin/dealer-counts/${activeExisting.id}/edit`, { replace: true })
  }

  const closed = count !== null && !count.is_active

  // Telefonlarda sanalayotganini kuzatish: saqlash yoki oyna ochiq paytida kutib turadi.
  const checkedAt = useDealerCountAutoRefresh({
    count,
    enabled: !busy && savingKey === null && !importOpen && !prefillOpen && !confirmDelete && !confirmReplace && history === null,
    onChanged: apply,
    mutationSeq,
  })

  return (
    <AdminLayout
      titleSlot={
        <div className="flex items-center gap-2">
          <Store size={18} />
          <span className="text-sm font-semibold">
            {countId ? (count?.dealer_name ?? t('admin:dealer_counts.edit_title')) : t('admin:dealer_counts.new_title')}
          </span>
        </div>
      }
      backTo="/admin/dealer-counts"
      actionSlot={
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" disabled={busy || !dealerId} onClick={() => setPrefillOpen(true)}>
            <ListPlus size={16} className="mr-1" />
            {t('admin:dealer_counts.prefill_button')}
          </Button>
          <Button variant="ghost" disabled={busy || !dealerId} onClick={() => setImportOpen(true)}>
            <FileSpreadsheet size={16} className="mr-1" />
            {t('admin:dealer_counts.import_excel')}
          </Button>
          {countId ? (
            <>
              <Button variant="ghost" disabled={busy} onClick={refresh} title={t('admin:dealer_counts.refresh_hint')}>
                <RefreshCw size={16} className="mr-1" />
                {t('admin:dealer_counts.refresh')}
              </Button>
              <Button variant="ghost" onClick={() => navigate(`/admin/dealer-counts/${countId}`)}>
                <Eye size={16} className="mr-1" />
                {t('admin:dealer_counts.view_compare')}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={exportExcel} title={t('admin:dealer_counts.export_excel_hint')}>
                <Download size={16} className="mr-1" />
                {t('admin:dealer_counts.export_excel')}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>
                <Trash2 size={16} className="mr-1" />
                {t('admin:dealer_counts.delete')}
              </Button>
            </>
          ) : null}
        </div>
      }
    >
      <div className="relative">
        {loading || busy ? <LoadingOverlay label={t('common:messages.loading')} /> : null}

        {closed ? (
          <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
            {t('admin:dealer_counts.closed_banner')}
          </div>
        ) : null}

        <Card className="mb-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              {t('admin:dealer_counts.col_dealer')}
              <select className={inputCls} value={dealerId} disabled={Boolean(countId)} onChange={(e) => setDealerId(e.target.value)}>
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
              <input className={inputCls} value={note} disabled={Boolean(countId)} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <div className="mt-3 text-xs text-slate-500">
            {t('admin:dealer_counts.col_counted_lines')}: <b>{count ? `${count.counted_lines}/${count.sheet_lines}` : '0/0'}</b> ·{' '}
            {t('admin:dealer_counts.col_units')}: <b>{fmtUnits(count?.total_units ?? 0)}</b>
            {count?.last_counted_at ? (
              <span className="ml-2">
                · {t('admin:dealer_counts.last_counted', { time: fmtTime(count.last_counted_at), name: count.last_counted_by_name ?? '—' })}
              </span>
            ) : null}
            {sum.unknown > 0 ? (
              <span className="ml-2 text-amber-700 dark:text-amber-300">
                {t('admin:dealer_counts.unknown_hint', { count: sum.unknown })}
              </span>
            ) : null}
            {countId ? <span className="ml-2 text-emerald-700 dark:text-emerald-300">{t('admin:dealer_counts.autosave_hint')}</span> : null}
            {countId ? (
              <span className="ml-2 text-slate-400" title={t('admin:dealer_counts.auto_refresh_title')}>
                · {t('admin:dealer_counts.auto_refresh_hint', { time: checkedAt ? checkedAt.toLocaleTimeString() : '—' })}
              </span>
            ) : null}
          </div>
          {!countId && activeExisting ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
              <span>
                {t('admin:dealer_counts.active_exists', {
                  done: activeExisting.counted_lines,
                  total: activeExisting.sheet_lines,
                })}
              </span>
              <Button variant="ghost" onClick={openActive}>
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
                  <th className="w-48 px-2 py-2 text-left">{t('admin:dealer_counts.col_code')}</th>
                  <th className="px-2 py-2 text-left">{t('admin:dealer_counts.col_product')}</th>
                  <th className="w-20 px-2 py-2 text-right" title={t('admin:dealer_counts.col_snapshot_hint')}>
                    {t('admin:dealer_counts.col_snapshot')}
                  </th>
                  <th className="w-28 px-2 py-2 text-left">{t('admin:dealer_counts.col_location')}</th>
                  <th className="w-24 px-2 py-2 text-left">{t('admin:dealer_counts.col_qty')}</th>
                  <th className="w-36 px-2 py-2 text-left">{t('admin:dealer_counts.col_expiry')}</th>
                  <th className="w-40 px-2 py-2 text-left">{t('admin:dealer_counts.col_counted_by')}</th>
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
                      (r.status === 'unknown' ? 'bg-amber-50/60 dark:bg-amber-900/10 ' : '') +
                      (savingKey === r.key ? 'opacity-60' : '')
                    }
                  >
                    <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                    <td className="relative px-2 py-1.5">
                      {r.lineId ? (
                        <span className="font-mono text-xs text-slate-500">{r.code}</span>
                      ) : (
                        <input
                          ref={(el) => {
                            codeRefs.current[r.key] = el
                          }}
                          className={inputCls + ' font-mono'}
                          value={r.code}
                          disabled={!dealerId || r.status === 'resolving'}
                          placeholder={t('admin:dealer_counts.code_placeholder')}
                          onChange={(e) => onCodeChange(r, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void resolveRow(r)
                            }
                            if (e.key === 'Escape') setSuggest(null)
                          }}
                        />
                      )}
                      {suggest && suggest.key === r.key && suggest.items.length > 0 ? (
                        <div className="absolute left-2 top-full z-20 mt-1 w-[28rem] max-w-[80vw] rounded-xl border border-slate-200 bg-white text-slate-900 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
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
                        className={inputCls + ' font-mono uppercase'}
                        value={r.location ?? ''}
                        disabled={!r.lineId}
                        maxLength={32}
                        onChange={(e) => editRow(r.key, { location: e.target.value })}
                        onBlur={() => void commitRow(r, 'location')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        ref={(el) => {
                          qtyRefs.current[r.key] = el
                        }}
                        className={inputCls + ' text-right tabular-nums'}
                        inputMode="decimal"
                        value={r.qty}
                        disabled={!r.lineId}
                        placeholder="—"
                        onChange={(e) => editRow(r.key, { qty: e.target.value })}
                        onBlur={() => void commitRow(r, 'qty')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            ;(e.target as HTMLInputElement).blur()
                            const next = rows[i + 1]
                            if (next) requestAnimationFrame(() => (next.lineId ? qtyRefs.current[next.key] : codeRefs.current[next.key])?.focus())
                          }
                        }}
                      />
                      {r.lineId && (r.entriesCount ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="mt-1 flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-300"
                          title={t('admin:dealer_counts.history_title')}
                          onClick={() => void openHistory(r)}
                        >
                          <History size={12} />
                          {r.entriesBrief ?? t('admin:dealer_counts.history_button')}
                        </button>
                      ) : null}
                      {r.boxUnits && r.lineId ? (
                        <button
                          type="button"
                          className="mt-1 text-xs text-indigo-600 hover:underline dark:text-indigo-300"
                          title={t('admin:dealer_counts.box_units_hint', { n: r.boxUnits })}
                          onClick={() => editRow(r.key, { qty: String(parseQty(r.qty) + (r.boxUnits ?? 0)) })}
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
                        disabled={!r.lineId}
                        onChange={(e) => {
                          editRow(r.key, { expiry: e.target.value })
                          void commitRow(r, 'expiry', e.target.value)
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-xs text-slate-500">
                      {r.countedAt ? (
                        <>
                          <div className="text-slate-700 dark:text-slate-200">{r.countedBy ?? '—'}</div>
                          <div>{fmtTime(r.countedAt)}</div>
                        </>
                      ) : r.lineId ? (
                        <span className="text-amber-700 dark:text-amber-300">{t('admin:dealer_counts.state_uncounted')}</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.status !== 'empty' ? (
                        <button
                          type="button"
                          className="p-1 text-slate-400 hover:text-rose-600"
                          disabled={savingKey === r.key}
                          onClick={() => void removeRow(r)}
                          aria-label={t('admin:dealer_counts.remove_line')}
                          title={t('admin:dealer_counts.remove_line')}
                        >
                          <X size={16} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollArea>
          <div className="border-t border-slate-100 px-3 py-2 dark:border-slate-800">
            <Button
              variant="ghost"
              disabled={!dealerId}
              onClick={() => {
                const row = emptyRow()
                setRows((prev) => [...prev, row])
                requestAnimationFrame(() => codeRefs.current[row.key]?.focus())
              }}
            >
              <Plus size={16} className="mr-1" />
              {t('admin:dealer_counts.add_row')}
            </Button>
          </div>
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
              <Button disabled={prefillSources.length === 0} onClick={prefill}>
                {t('admin:dealer_counts.prefill_button')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {history ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <button type="button" className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setHistory(null)} aria-label={t('common:buttons.close')} />
          <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100" role="dialog" aria-modal="true">
            <div className="text-base font-semibold">{t('admin:dealer_counts.history_title')}</div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{history.title}</p>
            {history.items === null ? (
              <p className="mt-4 text-sm text-slate-500">{t('common:messages.loading')}</p>
            ) : (
              <ul className="mt-4 space-y-2 text-sm">
                {history.items.map((en) => (
                  <li key={en.id} className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2 dark:border-slate-800">
                    <span>
                      <span
                        className={
                          en.kind === 'add'
                            ? 'font-semibold text-emerald-700 dark:text-emerald-300'
                            : en.kind === 'clear'
                              ? 'text-slate-400'
                              : 'font-semibold'
                        }
                      >
                        {en.kind === 'add' ? '+' : ''}
                        {en.qty == null ? '—' : fmtUnits(en.qty)}
                      </span>{' '}
                      <span className="text-xs text-slate-500">{t(`admin:dealer_counts.entry_${en.kind}`)}</span>
                    </span>
                    <span className="text-right text-xs text-slate-500">
                      {en.user_name ?? '—'}
                      <div>{fmtTime(en.counted_at)}</div>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex justify-end">
              <Button variant="ghost" onClick={() => setHistory(null)}>
                {t('common:buttons.close')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmReplace}
        title={t('admin:dealer_counts.replace_title')}
        message={t('admin:dealer_counts.replace_confirm', {
          done: activeExisting?.counted_lines ?? 0,
          total: activeExisting?.sheet_lines ?? 0,
        })}
        confirmLabel={t('admin:dealer_counts.replace_button')}
        cancelLabel={t('common:buttons.cancel')}
        onConfirm={confirmReplaceGo}
        onCancel={() => {
          pendingAction.current = null
          setConfirmReplace(false)
        }}
        variant="danger"
        loading={busy}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={t('admin:dealer_counts.delete')}
        message={t('admin:dealer_counts.delete_count_confirm', {
          done: count?.counted_lines ?? 0,
          total: count?.sheet_lines ?? 0,
        })}
        confirmLabel={t('admin:dealer_counts.delete')}
        cancelLabel={t('common:buttons.cancel')}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
        variant="danger"
        loading={busy}
      />
    </AdminLayout>
  )
}
