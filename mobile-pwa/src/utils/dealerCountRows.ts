import type { DealerCountLineIn, DealerCountOut } from '../services/dealerCountsApi'

/**
 * Diller sanovi — web jadval qatorlari (UI'siz sof mantiq).
 *
 * Qoidalar mobil ilova bilan bir xil: bir mahsulot + bir muddat = bitta qator
 * (miqdor qo'shiladi), tanilmagan kod har doim alohida qator, muddat oy boshi.
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
}

let _seq = 0
export function newRowKey(): string {
  _seq += 1
  return `r${Date.now().toString(36)}-${_seq}`
}

export function emptyRow(): EditRow {
  return { key: newRowKey(), code: '', productId: null, sku: null, name: null, qty: '', expiry: '', status: 'empty' }
}

export function parseQty(raw: string): number {
  const n = Number(String(raw ?? '').trim().replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
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
      (r) => r.key !== incoming.key && r.productId === incoming.productId && r.expiry === incoming.expiry && r.status === 'ok',
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

/** Serverga yuboriladigan qatorlar: bo'sh/nol miqdorli qatorlar tashlab ketiladi. */
export function rowsToApiLines(rows: EditRow[]): DealerCountLineIn[] {
  const out: DealerCountLineIn[] = []
  for (const r of rows) {
    const qty = parseQty(r.qty)
    const code = r.code.trim()
    if (qty <= 0 || (!r.productId && !code)) continue
    const exp = expiryToApi(r.expiry)
    out.push({
      ...(r.productId ? { product_id: r.productId } : {}),
      scanned_barcode: code.slice(0, 64),
      qty,
      ...(exp ? { expiry_date: exp } : {}),
    })
  }
  return out
}

export function rowsFromCount(count: DealerCountOut): EditRow[] {
  return count.lines.map((ln) => ({
    key: newRowKey(),
    code: ln.scanned_barcode || ln.sku || '',
    productId: ln.product_id,
    sku: ln.sku,
    name: ln.product_name,
    qty: String(Number(ln.qty)),
    expiry: expiryFromApi(ln.expiry_date),
    status: ln.product_id ? 'ok' : 'unknown',
  }))
}

export function totals(rows: EditRow[]): { lines: number; units: number; unknown: number; missingQty: number } {
  let lines = 0
  let units = 0
  let unknown = 0
  let missingQty = 0
  for (const r of rows) {
    if (r.status === 'empty' || r.status === 'resolving') continue
    const q = parseQty(r.qty)
    if (q <= 0) {
      // Mahsulot tanilgan, lekin fakt qoldiq yozilmagan — yuborishga yo'l qo'yilmaydi.
      missingQty += 1
      continue
    }
    lines += 1
    units += q
    if (r.status === 'unknown') unknown += 1
  }
  return { lines, units, unknown, missingQty }
}

// --- Excel ---

export type ImportedRow = { code: string; qty: number; expiry: string; rowNo: number }

function normHeader(h: string): string {
  return String(h ?? '').trim().toLowerCase()
}

const CODE_HEADERS = ['sku', 'barcode', 'shtrix', 'штрих', 'код', 'kod', 'product_code', 'артикул']
const QTY_HEADERS = ['qty', 'dona', 'кол', 'quantity', 'miqdor', 'шт', 'count']
const EXP_HEADERS = ['expiry', 'muddat', 'срок', 'exp']

/**
 * Excel varag'i (`sheet_to_json` header:1) → qatorlar. Sarlavha bo'lsa ustunlar nomi
 * bo'yicha, bo'lmasa tartib: 1-kod, 2-dona, 3-muddat.
 */
export function parseExcelRows(sheet: string[][]): ImportedRow[] {
  if (sheet.length === 0) return []
  const first = sheet[0].map(normHeader)
  const find = (names: string[]) => first.findIndex((h) => names.some((n) => h.includes(n)))
  let ci = find(CODE_HEADERS)
  let qi = find(QTY_HEADERS)
  let ei = find(EXP_HEADERS)
  const hasHeader = ci >= 0 && qi >= 0
  if (!hasHeader) {
    ci = 0
    qi = 1
    ei = 2
  }
  const out: ImportedRow[] = []
  for (let i = hasHeader ? 1 : 0; i < sheet.length; i++) {
    const row = sheet[i] ?? []
    const code = String(row[ci] ?? '').trim()
    const qty = parseQty(String(row[qi] ?? ''))
    if (!code || qty <= 0) continue
    const expRaw = ei >= 0 ? String(row[ei] ?? '').trim() : ''
    const exp = expiryToApi(expRaw)
    out.push({ code, qty, expiry: exp ? exp.slice(0, 7) : '', rowNo: i + 1 })
  }
  return out
}
