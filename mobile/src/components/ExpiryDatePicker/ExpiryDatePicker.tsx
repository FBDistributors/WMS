/**
 * Reusable ExpiryDatePicker — Yil → Oy → Kun, WMS style, dark mode, ru/uz.
 * Returns ISO date "YYYY-MM-DD". Past dates disabled; today allowed.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { ExpiryPickerLocale } from './localeLabels';
import {
  expiryPickerLabels,
  monthNamesLong,
  monthNamesShort,
  weekdayLetters,
} from './localeLabels';
import type { ExpiryDatePickerTheme } from './theme';
import { expiryPickerThemes } from './theme';

const MIN_YEAR = 2020;
const MAX_YEAR = 2050;

function toISODate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function firstDayOfCurrentMonth(): string {
  const d = new Date();
  return toISODate(d.getFullYear(), d.getMonth() + 1, 1);
}

function isBefore(a: string, b: string): boolean {
  return a < b;
}

export type ExpiryDatePickerProps = {
  visible: boolean;
  onClose: () => void;
  value: string | null;
  onChange: (isoDate: string | null) => void;
  minDate?: string;
  maxDate?: string;
  locale?: ExpiryPickerLocale;
  darkMode?: boolean;
};

const TOTAL_STEPS = 2;

export function ExpiryDatePicker({
  visible,
  onClose,
  value,
  onChange,
  minDate,
  maxDate,
  locale = 'uz',
  darkMode = false,
}: ExpiryDatePickerProps) {
  const themeKey: ExpiryDatePickerTheme = darkMode ? 'dark' : 'light';
  const theme = expiryPickerThemes[themeKey];
  const labels = expiryPickerLabels[locale] ?? expiryPickerLabels['uz'];
  const months = monthNamesShort[locale] ?? monthNamesShort['uz'];
  const weekLetters = weekdayLetters[locale] ?? weekdayLetters['uz'];

  const min = minDate ?? firstDayOfCurrentMonth();
  const max = maxDate ?? `${MAX_YEAR}-12-31`;

  const [step, setStep] = useState<1 | 2>(1);
  const [pickerYear, setPickerYear] = useState<number | null>(null);
  const [pickerMonth, setPickerMonth] = useState<number | null>(null);
  const [pendingDay, setPendingDay] = useState<{ year: number; month: number; day: number } | null>(null);

  const allYears = useMemo(
    () => Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i),
    []
  );

  useEffect(() => {
    if (visible) {
      setStep(1);
      setPendingDay(null);
      if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split('-').map(Number);
        setPickerYear(y);
        setPickerMonth(m);
        setPendingDay({ year: y, month: m, day: d });
      } else {
        setPickerYear(null);
        setPickerMonth(null);
      }
    }
  }, [visible, value]);

  const handleBack = useCallback(() => {
    if (step === 2) {
      setStep(1);
      setPickerYear(null);
      setPickerMonth(null);
    }
  }, [step]);

  const title =
    step === 1
      ? `${MIN_YEAR} – ${MAX_YEAR}`
      : step === 2 && pickerYear != null
        ? String(pickerYear)
        : labels.year;

  const dynamicStyles = {
    modal: { backgroundColor: theme.modal, borderColor: theme.modalBorder },
    header: { backgroundColor: theme.header, borderBottomColor: theme.headerBorder },
    title: { color: theme.title },
    backClose: { color: theme.backClose },
    progressBg: { backgroundColor: theme.progressBg },
    progressFill: { backgroundColor: theme.progressFill },
    progressText: { color: theme.progressText },
    cell: { backgroundColor: theme.cell, borderColor: theme.cellBorder },
    cellText: { color: theme.cellText },
    cellSelected: { backgroundColor: theme.cellSelected, borderColor: theme.cellSelectedBorder },
    cellSelectedText: { color: theme.cellSelectedText },
    cellDisabled: { backgroundColor: theme.cellDisabled },
    cellDisabledText: { color: theme.cellDisabledText },
    weekDay: { color: theme.weekDay },
    footer: { backgroundColor: theme.footer, borderTopColor: theme.footerBorder },
    cancelBtn: { backgroundColor: theme.cancelBtn },
    cancelBtnText: { color: theme.cancelBtnText },
    applyBtn: { backgroundColor: theme.applyBtn },
    applyBtnText: { color: theme.applyBtnText },
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          style={[styles.modal, dynamicStyles.modal]}
          activeOpacity={1}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Top bar: Back | Title | Close + Progress */}
          <View style={[styles.header, dynamicStyles.header]}>
            {step === 1 ? (
              <View style={styles.headerSide} />
            ) : (
              <TouchableOpacity
                onPress={handleBack}
                style={styles.headerSide}
                hitSlop={12}
              >
                <Icon name="chevron-left" size={26} color={theme.backClose} />
              </TouchableOpacity>
            )}
            <Text style={[styles.title, dynamicStyles.title]} numberOfLines={1}>
              {title}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.headerSide} hitSlop={12}>
              <Icon name="close" size={24} color={theme.backCloseIcon} />
            </TouchableOpacity>
          </View>
          <View style={styles.progressRow}>
            <View style={[styles.progressTrack, dynamicStyles.progressBg]}>
              <View
                style={[
                  styles.progressFill,
                  dynamicStyles.progressFill,
                  { width: `${(step / TOTAL_STEPS) * 100}%` },
                ]}
              />
            </View>
            <Text style={[styles.progressText, dynamicStyles.progressText]}>
              {labels.step(step, TOTAL_STEPS)}
            </Text>
          </View>

          {/* Step 1: Year list (scrollable, centered) */}
          {step === 1 && (
            <ScrollView
              style={styles.yearScroll}
              contentContainerStyle={styles.yearScrollContent}
              showsVerticalScrollIndicator={true}
            >
              <View style={styles.gridCentered}>
                {allYears.map((y) => (
                  <TouchableOpacity
                    key={y}
                    style={[
                      styles.cell,
                      dynamicStyles.cell,
                      pickerYear === y && styles.cellSelected,
                      pickerYear === y && dynamicStyles.cellSelected,
                    ]}
                    onPress={() => {
                      setPickerYear(y);
                      setStep(2);
                    }}
                  >
                    <Text
                      style={[
                        styles.cellText,
                        dynamicStyles.cellText,
                        pickerYear === y && dynamicStyles.cellSelectedText,
                      ]}
                    >
                      {y}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          )}

          {/* Step 2: Month grid (centered) — select month then done (YYYY-MM-01) */}
          {step === 2 && pickerYear != null && (
            <View style={styles.gridCentered}>
              {months.map((name, i) => {
                const monthNum = i + 1;
                const isoFirst = toISODate(pickerYear, monthNum, 1);
                const disabled = isBefore(isoFirst, min) || (!!max && isBefore(max, isoFirst));
                return (
                  <TouchableOpacity
                    key={name}
                    style={[
                      styles.cell,
                      dynamicStyles.cell,
                      pickerMonth === monthNum && styles.cellSelected,
                      pickerMonth === monthNum && dynamicStyles.cellSelected,
                      disabled && dynamicStyles.cellDisabled,
                    ]}
                    onPress={() => {
                      if (disabled) return;
                      onChange(isoFirst);
                      onClose();
                    }}
                    disabled={disabled}
                  >
                    <Text
                      style={[
                        styles.cellText,
                        dynamicStyles.cellText,
                        pickerMonth === monthNum && dynamicStyles.cellSelectedText,
                        disabled && dynamicStyles.cellDisabledText,
                      ]}
                    >
                      {name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modal: {
    borderRadius: 24,
    maxHeight: '88%',
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
  },
  headerSide: { width: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '600', flex: 1, textAlign: 'center' },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3 },
  progressText: { fontSize: 13, fontWeight: '600', minWidth: 28 },
  yearScroll: { maxHeight: 320 },
  yearScrollContent: { padding: 14, paddingBottom: 24, alignItems: 'center' },
  gridCentered: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 14,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 14,
    gap: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cell: {
    width: '30%',
    aspectRatio: 1.5,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellSelected: { borderWidth: 1.5 },
  cellText: { fontSize: 17, fontWeight: '500' },
  weekRow: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  weekDay: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
  dayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 10,
    gap: 4,
  },
  dayCell: {
    width: '13.6%',
    aspectRatio: 1,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellOther: { opacity: 0.5 },
  dayCellText: { fontSize: 15, fontWeight: '500' },
});

/** Format expiry for display: "Mart 2026" (oy + yil) */
export function formatExpiryDisplay(isoDate: string | null, locale: ExpiryPickerLocale = 'uz'): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return '';
  const [yStr, mStr] = isoDate.split('-');
  const year = parseInt(yStr!, 10);
  const month = parseInt(mStr!, 10);
  if (month < 1 || month > 12) return isoDate;
  const names = monthNamesLong[locale] ?? monthNamesLong['uz'];
  return `${names[month - 1]} ${year}`;
}
