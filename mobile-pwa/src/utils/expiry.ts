/**
 * Expiry Date Utilities
 * 
 * Helper functions for working with expiry dates in the WMS system.
 */

/**
 * Get color class for expiry date based on how soon it expires
 * 
 * @param expiryDate - ISO date string or Date object
 * @returns Tailwind CSS color class
 */
export function getExpiryColorClass(expiryDate: string | Date | null | undefined): string {
  if (!expiryDate) {
    return 'text-slate-400'; // No expiry date
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const expiry = typeof expiryDate === 'string' ? new Date(expiryDate) : expiryDate;
  expiry.setHours(0, 0, 0, 0);
  
  const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysUntilExpiry < 0) {
    return 'text-red-600 font-semibold dark:text-red-400'; // Expired
  }
  if (daysUntilExpiry <= 30) {
    return 'text-orange-600 font-semibold dark:text-orange-400'; // Expiring soon (critical)
  }
  if (daysUntilExpiry <= 90) {
    return 'text-yellow-600 dark:text-yellow-400'; // Warning period
  }
  
  return 'text-slate-600 dark:text-slate-300'; // Normal
}

/**
 * Get expiry status label
 * 
 * @param expiryDate - ISO date string or Date object
 * @returns Status label (expired, expiring_soon, warning, ok)
 */
export function getExpiryStatus(expiryDate: string | Date | null | undefined): 'expired' | 'expiring_soon' | 'warning' | 'ok' | 'none' {
  if (!expiryDate) {
    return 'none';
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const expiry = typeof expiryDate === 'string' ? new Date(expiryDate) : expiryDate;
  expiry.setHours(0, 0, 0, 0);
  
  const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysUntilExpiry < 0) return 'expired';
  if (daysUntilExpiry <= 30) return 'expiring_soon';
  if (daysUntilExpiry <= 90) return 'warning';
  return 'ok';
}

/**
 * Get days until expiry
 * 
 * @param expiryDate - ISO date string or Date object
 * @returns Number of days (negative if expired, null if no expiry)
 */
export function getDaysUntilExpiry(expiryDate: string | Date | null | undefined): number | null {
  if (!expiryDate) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const expiry = typeof expiryDate === 'string' ? new Date(expiryDate) : expiryDate;
  expiry.setHours(0, 0, 0, 0);
  
  return Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Format expiry date for display
 * 
 * @param expiryDate - ISO date string or Date object
 * @param locale - Locale for formatting (default: 'uz-UZ')
 * @returns Formatted date string
 */
export function formatExpiryDate(expiryDate: string | Date | null | undefined, locale: string = 'uz-UZ'): string {
  if (!expiryDate) {
    return '—';
  }

  const expiry = typeof expiryDate === 'string' ? new Date(expiryDate) : expiryDate;
  return expiry.toLocaleDateString(locale);
}

/**
 * Get minimum allowed expiry date (today)
 * 
 * @returns ISO date string for today
 */
export function getMinExpiryDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Validate expiry date
 * 
 * @param expiryDate - ISO date string or Date object
 * @returns Error message if invalid, null if valid
 */
export function validateExpiryDate(expiryDate: string | Date | null | undefined): string | null {
  if (!expiryDate) {
    return null; // Optional field
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const expiry = typeof expiryDate === 'string' ? new Date(expiryDate) : expiryDate;
  expiry.setHours(0, 0, 0, 0);
  
  if (expiry < today) {
    return 'Expiry date cannot be in the past';
  }
  
  return null;
}

/**
 * Get expiry warning icon
 * 
 * @param expiryDate - ISO date string or Date object
 * @returns Icon name (for lucide-react)
 */
export function getExpiryIcon(expiryDate: string | Date | null | undefined): 'alert-circle' | 'alert-triangle' | 'check-circle' | 'minus' {
  const status = getExpiryStatus(expiryDate);
  
  switch (status) {
    case 'expired':
      return 'alert-circle';
    case 'expiring_soon':
      return 'alert-triangle';
    case 'warning':
      return 'alert-triangle';
    case 'ok':
      return 'check-circle';
    default:
      return 'minus';
  }
}
