/**
 * Qoldiq / miqdor maydoni: faqat 0–9, manfiy va kasr kiritilmaydi.
 */
export function sanitizeStockQtyDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}
