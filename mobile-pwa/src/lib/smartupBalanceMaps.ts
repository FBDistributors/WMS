/** SmartUP balance$export javobidan mahsulot kodi / shtrix → miqdor map. */

const PRODUCT_KEY_PRIORITY = [
  'product_code',
  'productcode',
  'code',
  'sku',
  'article',
  'article_code',
  'smartup_code',
  'product',
]

const BARCODE_KEYS = ['barcode', 'bar_code', 'ean', 'shtrix', 'shtrix_kod']

const QTY_KEY_PRIORITY = ['quantity', 'qty', 'amount', 'balance', 'remainder', 'rest', 'qoldiq']

function normalizeRows(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== 'object') return []
  if (Array.isArray(raw)) {
    return raw.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
  }
  const obj = raw as Record<string, unknown>
  for (const key of ['balance', 'items', 'data', 'movement', 'export']) {
    const val = obj[key]
    if (Array.isArray(val)) {
      return val.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
    }
  }
  return []
}

function pickKey(keys: string[], candidates: readonly string[]): string | null {
  const lower = new Set(keys.map((k) => k.toLowerCase()))
  for (const c of candidates) {
    if (lower.has(c.toLowerCase())) {
      return keys.find((k) => k.toLowerCase() === c.toLowerCase()) ?? null
    }
  }
  for (const k of keys) {
    const kl = k.toLowerCase()
    if (candidates === PRODUCT_KEY_PRIORITY) {
      if (kl.includes('product') && kl.includes('code')) return k
      if (kl === 'code' || kl.endsWith('_code')) return k
    }
  }
  return null
}

function addToMap(map: Map<string, number>, key: string, qty: number): void {
  const k = key.trim()
  if (!k || !Number.isFinite(qty)) return
  map.set(k, (map.get(k) ?? 0) + qty)
}

export type SmartupSummaryMaps = {
  byCode: Map<string, number>
  byBarcode: Map<string, number>
}

export function buildSmartupSummaryMaps(raw: unknown): SmartupSummaryMaps {
  const byCode = new Map<string, number>()
  const byBarcode = new Map<string, number>()
  const rows = normalizeRows(raw)
  if (rows.length === 0) return { byCode, byBarcode }

  const sampleKeys = Object.keys(rows[0] ?? {})
  const productKey = pickKey(sampleKeys, PRODUCT_KEY_PRIORITY)
  const qtyKey = pickKey(sampleKeys, QTY_KEY_PRIORITY)
  const barcodeKey = pickKey(sampleKeys, BARCODE_KEYS)

  for (const row of rows) {
    if (!qtyKey) continue
    const qtyNum = Number(row[qtyKey])
    if (!Number.isFinite(qtyNum)) continue

    if (productKey) {
      const codeRaw = row[productKey]
      if (codeRaw != null && String(codeRaw).trim()) {
        addToMap(byCode, String(codeRaw), qtyNum)
      }
    }
    if (barcodeKey) {
      const bcRaw = row[barcodeKey]
      if (bcRaw != null && String(bcRaw).trim()) {
        addToMap(byBarcode, String(bcRaw), qtyNum)
      }
    }
  }
  return { byCode, byBarcode }
}

/** Eski API: faqat kod bo'yicha map (orqaga moslik). */
export function buildSmartupQtyByProductCode(raw: unknown): Map<string, number> {
  return buildSmartupSummaryMaps(raw).byCode
}

export function lookupSmartupQty(
  byCode: Map<string, number>,
  byBarcode: Map<string, number>,
  productCode: string,
  barcode?: string | null,
): number {
  const code = (productCode ?? '').trim()
  if (code) {
    const hit = byCode.get(code)
    if (hit != null && hit !== 0) return hit
  }
  const bc = (barcode ?? '').trim()
  if (bc) {
    const hit = byBarcode.get(bc)
    if (hit != null) return hit
  }
  if (code) return byCode.get(code) ?? 0
  return 0
}

export function hasSmartupMapData(m: Map<string, number>): boolean {
  return m.size > 0
}

export function getSmartupTotalsForRow(
  q001ByCode: Map<string, number>,
  q001ByBarcode: Map<string, number>,
  q002ByCode: Map<string, number>,
  q002ByBarcode: Map<string, number>,
  productCode: string,
  barcode?: string | null,
): { q001: number; q002: number; total: number } {
  const q001 = lookupSmartupQty(q001ByCode, q001ByBarcode, productCode, barcode)
  const q002 = lookupSmartupQty(q002ByCode, q002ByBarcode, productCode, barcode)
  return { q001, q002, total: q001 + q002 }
}
