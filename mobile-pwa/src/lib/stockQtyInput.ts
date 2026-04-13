/** Qoldiq / miqdor: faqat 0–9. */
export function sanitizeStockQtyDigits(raw: string): string {
  return raw.replace(/\D/g, '')
}
