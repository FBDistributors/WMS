import type { DealerCountLineIn, DealerCountOut } from '../services/dealerCountsApi'

/**
 * Diller sanovi — web jadval qatorlari (UI'siz sof mantiq).
 *
 * Qoidalar server va mobil ilova bilan bir xil: mahsulot + muddat + joy = bitta qator,
 * tanilmagan kod har doim alohida qator, muddat oy boshi. Har qator serverda alohida
 * saqlanadi (qo'shish / o'zgartirish / o'chirish) — telefon sanaganiga tegilmaydi.
 */

export type RowStatus = 'empty' | 'resolving' | 'ok' | 'unknown'

export type EditRow = {
  key: string
  /** Kiritilgan SKU yoki shtrix-kod (xom). */
  code: string
  productId: string | null
  sku: string | null
  name: string | null
  /** Matn — kiritish paytida bo'sh bo'lishi mumkin. */
  qty: string
  /** `YYYY-MM` yoki bo'sh. */
  expiry: string
  status: RowStatus
  /** Quti kodi skanerlangan bo'lsa — hajm (faqat maslahat, avtomatik yozilmaydi). */
  boxUnits?: number
  /** Tayyor ro'yxat: Smartup soni (snapshot) va haqiqatan sanalgan payt. */
  snapshotQty?: number | null
  countedAt?: string | null
  /** Serverdagi qator (yo'q — hali qo'shilmagan yangi qator). */
  lineId?: string | null
  /** Diller omboridagi joy (javon / zona). */
  location?: string
  countedBy?: string | null
  /** Qatorga kiritishlar soni va ko'rinishi ("12 + 5"). */
  entriesCount?: number
  entriesBrief?: string | null
  /** UI: foydalanuvchi hozir yozmoqda — server javobi bu qiymat ustidan yozmasin. */
  editing?: boolean
}

let _seq = 0
export function newRowKey(): string {
  _seq += 1
  return `r${Date.now().toString(36)}-${_seq}`
}

export function emptyRow(): EditRow {
  return { key: newRowKey(), code: '', productId: null, sku: null, name: null, qty: '', expiry: '', location: '', status: 'empty' }
}

export function parseQty(raw: string): number {
  const n = Number(String(raw ?? '').trim().replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Kiritilgan miqdor: bo'sh — null (sanalmagan), aks holda >= 0 son; noto'g'ri — undefined. */
export function qtyValue(raw: string): number | null | undefined {
  const s = String(raw ?? '').trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** Joy kodi — server bilan bir xil: bo'shliqlar qisqaradi, katta harf. */
export function normLocation(raw: string | null | undefined): string {
  return String(raw ?? '').split(/\s+/).filter(Boolean).join(' ').toUpperCase().slice(0, 32)
}

/** `YYYY-MM` → `YYYY-MM-01`; boshqa formatlar (`2027-03-15`, `03.2027`) ham oy boshiga. */
export function expiryToApi(raw: string): string | undefined {
  const s = String(raw ?? '').trim()
  if (!s) return undefined
  let m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(s)
  if (m) return `${m[1]}-${m[2]}-01`
  m = /^(\d{2})[./](\d{4})$/.exec(s)
  if (m) return `${m[2]}-${m[1]}-01`
  return undefined
}

/** API `YYYY-MM-01` → input `YYYY-MM`. */
export function expiryFromApi(raw: string | null | undefined): string {
  return raw ? raw.slice(0, 7) : ''
}

/**
 * Tanilgan qatorni jadvalga qo'shish: bir xil mahsulot + muddat bor bo'lsa miqdor
 * o'sha qatorga qo'shiladi va yangi qator kirmaydi. Qaytaradi: yig'ilgan qator kaliti
 * (yoki null — yangi qator qo'shildi).
 */
export function mergeResolvedRow(rows: EditRow[], incoming: EditRow): { rows: EditRow[]; mergedInto: string | null } {
  if (incoming.productId) {
    const idx = rows.findIndex(
      (r) =>
        r.key !== incoming.key &&
        r.productId === incoming.productId &&
        r.expiry === incoming.expiry &&
        normLocation(r.location) === normLocation(incoming.location) &&
        r.status === 'ok',
    )
    if (idx >= 0) {
      const target = rows[idx]
      const merged: EditRow = { ...target, qty: String(parseQty(target.qty) + parseQty(incoming.qty)) }
      const next = rows.filter((r) => r.key !== incoming.key)
      next[next.indexOf(target)] = merged
      return { rows: next, mergedInto: target.key }
    }
  }
  const exists = rows.some((r) => r.key === incoming.key)
  return { rows: exists ? rows.map((r) => (r.key === incoming.key ? incoming : r)) : [...rows, incoming], mergedInto: null }
}

/** Yangi qator → server qatori (qo'shish uchun). Tanilmagan kod ham saqlanadi — admin ko'radi. */
export function rowToLineIn(r: EditRow): DealerCountLineIn | null {
  const code = r.code.trim()
  if (!r.productId && !code) return null
  const qty = qtyValue(r.qty)
  const exp = expiryToApi(r.expiry)
  const loc = normLocation(r.location)
  return {
    ...(r.productId ? { product_id: r.productId } : {}),
    scanned_barcode: code.slice(0, 64),
    ...(qty != null ? { qty } : {}),
    ...(r.snapshotQty != null ? { snapshot_qty: r.snapshotQty } : {}),
    ...(exp ? { expiry_date: exp } : {}),
    ...(loc ? { location_code: loc } : {}),
  }
}

export function rowsFromCount(count: DealerCountOut): EditRow[] {
  return count.lines.map((ln) => ({
    key: newRowKey(),
    code: ln.scanned_barcode || ln.sku || '',
    productId: ln.product_id,
    sku: ln.sku,
    name: ln.product_name,
    qty: ln.qty == null ? '' : String(Number(ln.qty)),
    expiry: expiryFromApi(ln.expiry_date),
    status: ln.product_id ? 'ok' : 'unknown',
    snapshotQty: ln.snapshot_qty == null ? null : Number(ln.snapshot_qty),
    countedAt: ln.counted_at ?? null,
    lineId: ln.id,
    location: ln.location_code ?? '',
    countedBy: ln.counted_by_name ?? null,
    entriesCount: ln.entries_count ?? 0,
    entriesBrief: ln.entries_brief ?? null,
  }))
}

export function totals(rows: EditRow[]): { lines: number; units: number; unknown: number; missingQty: number; sheet: number } {
  let lines = 0
  let units = 0
  let unknown = 0
  let missingQty = 0
  let sheet = 0
  for (const r of rows) {
    if (r.status === 'empty' || r.status === 'resolving') continue
    sheet += 1
    const q = parseQty(r.qty)
    if (r.qty.trim() === '') {
      // Ro'yxat qatori — hali sanalmagan.
      missingQty += 1
      continue
    }
    lines += 1
    units += q
    if (r.status === 'unknown') unknown += 1
  }
  return { lines, units, unknown, missingQty, sheet }
}

// --- Excel ---

export type ImportedRow = { code: string; qty: number; expiry: string; location: string; rowNo: number }

function normHeader(h: string): string {
  return String(h ?? '').trim().toLowerCase()
}

const CODE_HEADERS = ['sku', 'barcode', 'shtrix', 'штрих', 'код', 'kod', 'product_code', 'артикул']
const QTY_HEADERS = ['qty', 'dona', 'кол', 'quantity', 'miqdor', 'шт', 'count']
const EXP_HEADERS = ['expiry', 'muddat', 'срок', 'exp']
const LOC_HEADERS = ['joy', 'location', 'место', 'ячейка', 'полка', 'javon', 'zona']

/**
 * Excel varag'i (`sheet_to_json` header:1) → qatorlar. Sarlavha bo'lsa ustunlar nomi
 * bo'yicha, bo'lmasa tartib: 1-kod, 2-dona, 3-muddat, 4-joy.
 */
export function parseExcelRows(sheet: string[][]): ImportedRow[] {
  if (sheet.length === 0) return []
  const first = sheet[0].map(normHeader)
  const find = (names: string[]) => first.findIndex((h) => names.some((n) => h.includes(n)))
  let ci = find(CODE_HEADERS)
  let qi = find(QTY_HEADERS)
  let ei = find(EXP_HEADERS)
  let li = find(LOC_HEADERS)
  const hasHeader = ci >= 0 && qi >= 0
  if (!hasHeader) {
    ci = 0
    qi = 1
    ei = 2
    li = 3
  }
  const out: ImportedRow[] = []
  for (let i = hasHeader ? 1 : 0; i < sheet.length; i++) {
    const row = sheet[i] ?? []
    const code = String(row[ci] ?? '').trim()
    const qty = parseQty(String(row[qi] ?? ''))
    if (!code || qty <= 0) continue
    const expRaw = ei >= 0 ? String(row[ei] ?? '').trim() : ''
    const exp = expiryToApi(expRaw)
    const location = li >= 0 ? normLocation(String(row[li] ?? '')) : ''
    out.push({ code, qty, expiry: exp ? exp.slice(0, 7) : '', location, rowNo: i + 1 })
  }
  return out
}
