/**
 * Tests for expiry date utilities
 */
import {
  getExpiryColorClass,
  getExpiryStatus,
  getDaysUntilExpiry,
  formatExpiryDate,
  validateExpiryDate,
  getMinExpiryDate,
} from '../utils/expiry';

describe('Expiry Date Utilities', () => {
  describe('getExpiryColorClass', () => {
    test('expired date shows red', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const color = getExpiryColorClass(yesterday.toISOString());
      expect(color).toContain('red');
      expect(color).toContain('font-semibold');
    });

    test('expiring soon (< 30 days) shows orange', () => {
      const soon = new Date();
      soon.setDate(soon.getDate() + 15);
      const color = getExpiryColorClass(soon.toISOString());
      expect(color).toContain('orange');
    });

    test('warning period (30-90 days) shows yellow', () => {
      const warning = new Date();
      warning.setDate(warning.getDate() + 60);
      const color = getExpiryColorClass(warning.toISOString());
      expect(color).toContain('yellow');
    });

    test('normal expiry (> 90 days) shows default color', () => {
      const normal = new Date();
      normal.setDate(normal.getDate() + 120);
      const color = getExpiryColorClass(normal.toISOString());
      expect(color).toContain('slate');
    });

    test('null expiry shows default color', () => {
      const color = getExpiryColorClass(null);
      expect(color).toContain('slate-400');
    });
  });

  describe('getExpiryStatus', () => {
    test('returns expired for past dates', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(getExpiryStatus(yesterday)).toBe('expired');
    });

    test('returns expiring_soon for dates within 30 days', () => {
      const soon = new Date();
      soon.setDate(soon.getDate() + 15);
      expect(getExpiryStatus(soon)).toBe('expiring_soon');
    });

    test('returns warning for dates within 31-90 days', () => {
      const warning = new Date();
      warning.setDate(warning.getDate() + 60);
      expect(getExpiryStatus(warning)).toBe('warning');
    });

    test('returns ok for dates beyond 90 days', () => {
      const future = new Date();
      future.setDate(future.getDate() + 120);
      expect(getExpiryStatus(future)).toBe('ok');
    });

    test('returns none for null', () => {
      expect(getExpiryStatus(null)).toBe('none');
    });
  });

  describe('getDaysUntilExpiry', () => {
    test('returns positive days for future date', () => {
      const future = new Date();
      future.setDate(future.getDate() + 30);
      const days = getDaysUntilExpiry(future);
      expect(days).toBe(30);
    });

    test('returns negative days for past date', () => {
      const past = new Date();
      past.setDate(past.getDate() - 5);
      const days = getDaysUntilExpiry(past);
      expect(days).toBe(-5);
    });

    test('returns 0 for today', () => {
      const today = new Date();
      const days = getDaysUntilExpiry(today);
      expect(days).toBe(0);
    });

    test('returns null for no expiry', () => {
      expect(getDaysUntilExpiry(null)).toBeNull();
    });
  });

  describe('formatExpiryDate', () => {
    test('formats date correctly', () => {
      const date = new Date('2026-12-31');
      const formatted = formatExpiryDate(date);
      expect(formatted).toBeTruthy();
      expect(formatted).not.toBe('—');
    });

    test('returns dash for null', () => {
      expect(formatExpiryDate(null)).toBe('—');
    });
  });

  describe('validateExpiryDate', () => {
    test('accepts future dates', () => {
      const future = new Date();
      future.setDate(future.getDate() + 30);
      expect(validateExpiryDate(future)).toBeNull();
    });

    test('accepts today', () => {
      const today = new Date();
      expect(validateExpiryDate(today)).toBeNull();
    });

    test('rejects past dates', () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      const error = validateExpiryDate(past);
      expect(error).toBeTruthy();
      expect(error).toContain('past');
    });

    test('accepts null (optional field)', () => {
      expect(validateExpiryDate(null)).toBeNull();
    });
  });

  describe('getMinExpiryDate', () => {
    test('returns today in ISO format', () => {
      const min = getMinExpiryDate();
      expect(min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      
      const today = new Date().toISOString().split('T')[0];
      expect(min).toBe(today);
    });
  });
});
