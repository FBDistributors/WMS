/**
 * Expiry Date Utilities — muddat oy bo'yicha (Yil keyin Oy).
 * Display: "Mart 2026"; status/color oy bo'yicha.
 */

function toDate(d: string | Date | null | undefined): Date | null {
  if (d == null) return null
  const date = typeof d === 'string' ? new Date(d) : d
  return Number.isNaN(date.getTime()) ? null : date
}

/** Months until expiry (negative if expired). */
function getMonthsUntilExpiry(expiryDate: string | Date | null | undefined): number | null {
  const expiry = toDate(expiryDate)
  if (!expiry) return null
  const now = new Date()
  const monthsUntil = (expiry.getFullYear() - now.getFullYear()) * 12 + (expiry.getMonth() - now.getMonth())
  return monthsUntil
}

/**
 * Get color class for expiry date (month-based).
 */
export function getExpiryColorClass(expiryDate: string | Date | null | undefined): string {
  if (!expiryDate) {
    return 'text-slate-400'
  }

  const months = getMonthsUntilExpiry(expiryDate)
  if (months === null) return 'text-slate-400'
  if (months < 0) return 'text-red-600 font-semibold dark:text-red-400'
  if (months <= 1) return 'text-orange-600 font-semibold dark:text-orange-400'
  if (months <= 3) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-slate-600 dark:text-slate-300'
}

/**
 * Get expiry status (month-based).
 */
export function getExpiryStatus(expiryDate: string | Date | null | undefined): 'expired' | 'expiring_soon' | 'warning' | 'ok' | 'none' {
  if (!expiryDate) return 'none'
  const months = getMonthsUntilExpiry(expiryDate)
  if (months === null) return 'none'
  if (months < 0) return 'expired'
  if (months <= 1) return 'expiring_soon'
  if (months <= 3) return 'warning'
  return 'ok'
}

/**
 * Get days until expiry (approximate from month; negative if expired).
 */
export function getDaysUntilExpiry(expiryDate: string | Date | null | undefined): number | null {
  const months = getMonthsUntilExpiry(expiryDate)
  if (months === null) return null
  const expiry = toDate(expiryDate)!
  const now = new Date()
  const firstOfExpiry = new Date(expiry.getFullYear(), expiry.getMonth(), 1)
  const firstOfNow = new Date(now.getFullYear(), now.getMonth(), 1)
  return Math.floor((firstOfExpiry.getTime() - firstOfNow.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * Format expiry for display: "Mart 2026" (oy + yil).
 */
export function formatExpiryDate(expiryDate: string | Date | null | undefined, locale: string = 'uz-UZ'): string {
  if (!expiryDate) return '—'
  const expiry = toDate(expiryDate)
  if (!expiry) return '—'
  return expiry.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
}

/**
 * Minimum expiry = first day of current month (YYYY-MM-01).
 */
export function getMinExpiryDate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  return `${y}-${String(m).padStart(2, '0')}-01`
}

/**
 * Validate: past = expiry month before current month.
 */
export function validateExpiryDate(expiryDate: string | Date | null | undefined): string | null {
  if (!expiryDate) return null
  const months = getMonthsUntilExpiry(expiryDate)
  if (months === null) return null
  if (months < 0) return 'Expiry date cannot be in the past'
  return null
}

export function getExpiryIcon(expiryDate: string | Date | null | undefined): 'alert-circle' | 'alert-triangle' | 'check-circle' | 'minus' {
  const status = getExpiryStatus(expiryDate)
  switch (status) {
    case 'expired':
      return 'alert-circle'
    case 'expiring_soon':
    case 'warning':
      return 'alert-triangle'
    case 'ok':
      return 'check-circle'
    default:
      return 'minus'
  }
}
