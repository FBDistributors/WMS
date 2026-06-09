import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { sanitizeStockQtyDigits } from '../utils/stockQtyInput';
import type { PickingDocument, PickingLine } from '../api/picking.types';
import apiClient, { UNAUTHORIZED_MSG } from '../api/client';
import {
  changePickSource,
  completePickDocument,
  getTaskById,
  INCOMPLETE_REASON_KEYS,
  markControllerVerificationStarted,
  pickLine,
  skipLine,
  unpickLine,
} from '../api/picking';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ScanInput } from '../components/ScanInput';
import { useLocale } from '../i18n/LocaleContext';
import { useTheme } from '../theme/ThemeContext';
import { playSuccessBeep } from '../utils/playBeep';
import { useNetwork } from '../network';
import { useProfileType } from '../context/ProfileTypeContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCachedPickTaskDetail, saveCachedPickTaskDetail } from '../offline/offlineDb';
import { addToQueue } from '../offline/offlineQueue';
import {
  barcodeMatchesLine,
  resolvePickScanForDocument,
} from '../utils/pickScanResolve';

const CONTROLLER_VERIFIED_KEY = (taskId: string) => `wms_controller_verified_${taskId}`;

async function loadControllerVerifiedLineIds(taskId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(CONTROLLER_VERIFIED_KEY(taskId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function saveControllerVerifiedLineIds(taskId: string, ids: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(CONTROLLER_VERIFIED_KEY(taskId), JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

/** API dan kelgan documentni xavfsiz ko‘rsatish uchun normalizatsiya (lines/progress bo‘lmasa crash bo‘lmasin). */
function normalizeDocument(raw: PickingDocument | null): PickingDocument | null {
  if (!raw) return null;
  const lines = Array.isArray(raw.lines)
    ? raw.lines.map((l) => ({
        ...l,
        alternate_locations: Array.isArray(l.alternate_locations) ? l.alternate_locations : [],
      }))
    : [];
  const progress = raw.progress && typeof raw.progress === 'object'
    ? { picked: Number(raw.progress.picked) || 0, required: Number(raw.progress.required) || 0 }
    : { picked: 0, required: lines.reduce((s, l) => s + (l.qty_required ?? 0), 0) };
  return { ...raw, lines, progress };
}

/** Controller uchun: mahsulot bo'yicha guruhlash, har bir guruh bitta "umumiy" qator. */
function isControllerGroupFullyVerified(
  lines: PickingLine[],
  line: PickingLine,
  verifiedIds: Set<string>
): boolean {
  const groups = groupLinesByProduct(lines);
  const group = groups.find((g) => g.groupLines.some((l) => l.id === line.id));
  const members = group?.groupLines ?? [line];
  return members.every((l) => verifiedIds.has(String(l.id)));
}

function clearControllerVerifiedForGroup(
  taskId: string,
  lines: PickingLine[],
  anchor: PickingLine,
  setVerified: React.Dispatch<React.SetStateAction<Set<string>>>
): void {
  const groups = groupLinesByProduct(lines);
  const group = groups.find((g) => g.groupLines.some((l) => l.id === anchor.id));
  const ids = new Set((group?.groupLines ?? [anchor]).map((l) => String(l.id)));
  setVerified((prev) => {
    const next = new Set(prev);
    for (const id of ids) next.delete(id);
    void saveControllerVerifiedLineIds(taskId, next);
    return next;
  });
}

function groupLinesByProduct(lines: PickingLine[]): { virtualLine: PickingLine; groupLines: PickingLine[] }[] {
  const map = new Map<string, PickingLine[]>();
  for (const l of lines) {
    const key = l.product_id?.trim()
      ? `id:${l.product_id}`
      : (l.product_name ?? '') + '|' + (l.barcode ?? l.sku ?? '');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(l);
  }
  return [...map.values()].map((groupLines) => {
    const first = groupLines[0];
    const required = groupLines.reduce((s, l) => s + (Number(l.qty_required) || 0), 0);
    const picked = groupLines.reduce((s, l) => s + (Number(l.qty_picked) || 0), 0);
    const virtualLine: PickingLine = {
      ...first,
      id: first.id,
      qty_required: required,
      qty_picked: picked,
      location_code: '—',
    };
    return { virtualLine, groupLines };
  });
}

type Nav = StackNavigationProp<RootStackParamList, 'PickTaskDetails'>;
type Route = RouteProp<RootStackParamList, 'PickTaskDetails'>;

const STATUS_KEYS: Record<string, string> = {
  new: 'statusNew',
  in_progress: 'statusInProgress',
  partial: 'statusPartial',
  picked: 'statusPicked',
  completed: 'statusCompleted',
  cancelled: 'statusCancelled',
};

export function PickTaskDetails() {
  const { t } = useLocale();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { isOnline } = useNetwork();
  const taskId = route.params?.taskId ?? '';
  const profileType = route.params?.profileType ?? useProfileType().profileType ?? 'picker';
  const isController = profileType === 'controller';
  const [doc, setDoc] = useState<PickingDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedLine, setSelectedLine] = useState<PickingLine | null>(null);
  const [scannedBarcodeForQty, setScannedBarcodeForQty] = useState<string | null>(null);
  const [qtyInput, setQtyInput] = useState('');
  const [incompleteReasonModalVisible, setIncompleteReasonModalVisible] = useState(false);
  const [selectedIncompleteReason, setSelectedIncompleteReason] = useState<string | null>(null);
  const [controllerVerifiedLineIds, setControllerVerifiedLineIds] = useState<Set<string>>(new Set());
  const [unpickTarget, setUnpickTarget] = useState<PickingLine | null>(null);
  const [unpickQtyInput, setUnpickQtyInput] = useState('1');
  const [unpickReason, setUnpickReason] = useState<string | null>(null);
  const [unpickSubmitting, setUnpickSubmitting] = useState(false);
  const [lineForReasonModal, setLineForReasonModal] = useState<PickingLine | null>(null);
  const [lineReasonModalVisible, setLineReasonModalVisible] = useState(false);
  const [selectedLineReason, setSelectedLineReason] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!taskId || typeof taskId !== 'string') {
      setLoading(false);
      setError(t('notFound'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (isOnline) {
        const data = await getTaskById(String(taskId));
        const normalized = normalizeDocument(data);
        setDoc(normalized);
        if (normalized) await saveCachedPickTaskDetail(taskId, normalized);
        if (isController && normalized) {
          const saved = await loadControllerVerifiedLineIds(String(taskId));
          setControllerVerifiedLineIds(saved);
        }
      } else {
        const cached = await getCachedPickTaskDetail(taskId);
        const normalized = normalizeDocument(cached as PickingDocument | null);
        setDoc(normalized);
        if (!normalized) setError(t('notFound'));
        if (isController && normalized) {
          const saved = await loadControllerVerifiedLineIds(String(taskId));
          setControllerVerifiedLineIds(saved);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('loadError');
      setError(msg);
      if (msg === UNAUTHORIZED_MSG) {
        Alert.alert(t('error'), t('authErrorPleaseLogin'), [
          { text: 'OK', onPress: () => navigation.replace('Login') },
        ]);
        return;
      }
    } finally {
      setLoading(false);
    }
  }, [taskId, navigation, t, isOnline, isController]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      const { scannedBarcode, lineId } = route.params ?? {};
      if (!scannedBarcode || !doc) return;
      navigation.setParams({ scannedBarcode: undefined, lineId: undefined });

      const lines = doc.lines ?? [];
      void (async () => {
        const resolved = await resolvePickScanForDocument({
          lines,
          barcode: scannedBarcode,
          preferredLineId: lineId,
        });
        if (!resolved) {
          if (lineId) {
            Alert.alert(
              t('wrongBarcodeTitle'),
              t('wrongBarcodeMessage') + '—'
            );
          } else if (isController) {
            Alert.alert(t('wrongBarcodeTitle'), t('productNotInOrder'));
          }
          return;
        }
        const { line, unitsPerScan, isBoxScan } = resolved;
        if (isController) {
          if (isControllerGroupFullyVerified(lines, line, controllerVerifiedLineIds)) {
            Alert.alert(t('verifiedBadge'), t('controllerPositionAlreadyVerified'));
            return;
          }
          setSelectedLine(line);
          void playSuccessBeep();
          setScannedBarcodeForQty(scannedBarcode);
          setQtyInput(String(line.qty_picked));
          return;
        }
        setSelectedLine(line);
        void playSuccessBeep();
        setScannedBarcodeForQty(scannedBarcode);
        const remaining = line.qty_required - line.qty_picked;
        const preset = isBoxScan
          ? Math.min(remaining, unitsPerScan)
          : remaining;
        setQtyInput(preset >= 1 ? String(preset) : '0');
      })();
    }, [
      route.params?.scannedBarcode,
      route.params?.lineId,
      doc,
      navigation,
      t,
      isController,
      controllerVerifiedLineIds,
    ])
  );

  const openLineScan = useCallback((line: PickingLine, _display?: PickingLine) => {
    setSelectedLine(line);
    setScannedBarcodeForQty(null);
    setQtyInput('');
  }, []);

  const closeLineScan = useCallback(() => {
    setSelectedLine(null);
    setScannedBarcodeForQty(null);
    setQtyInput('');
  }, []);

  const handleLineScanSubmit = useCallback(
    (value: string) => {
      if (!selectedLine || !doc) return;
      void (async () => {
      const groupLines = groupLinesByProduct(doc.lines ?? []).find((g) =>
        g.groupLines.some((l) => l.id === selectedLine.id)
      )?.groupLines;
      const resolved = await resolvePickScanForDocument({
        lines: groupLines ?? doc.lines ?? [],
        barcode: value,
      });
      const matchInGroup = resolved?.line
        ?? groupLines?.find((l) => barcodeMatchesLine(value, l))
        ?? null;
      if (matchInGroup) {
        if (
          isController &&
          doc?.lines &&
          isControllerGroupFullyVerified(doc.lines, matchInGroup, controllerVerifiedLineIds)
        ) {
          Alert.alert(t('verifiedBadge'), t('controllerPositionAlreadyVerified'));
          return;
        }
        void playSuccessBeep();
        setSelectedLine(matchInGroup);
        setScannedBarcodeForQty(value.trim());
        if (isController) {
          setQtyInput(String(matchInGroup.qty_picked));
        } else {
          const remaining = matchInGroup.qty_required - matchInGroup.qty_picked;
          const preset = resolved?.isBoxScan
            ? Math.min(remaining, resolved.unitsPerScan)
            : remaining;
          setQtyInput(preset >= 1 ? String(preset) : '0');
        }
      } else if (barcodeMatchesLine(value, selectedLine)) {
        if (
          isController &&
          doc?.lines &&
          isControllerGroupFullyVerified(doc.lines, selectedLine, controllerVerifiedLineIds)
        ) {
          Alert.alert(t('verifiedBadge'), t('controllerPositionAlreadyVerified'));
          return;
        }
        void playSuccessBeep();
        setScannedBarcodeForQty(value.trim());
        if (isController) {
          setQtyInput(String(selectedLine.qty_picked));
        } else {
          const remaining = selectedLine.qty_required - selectedLine.qty_picked;
          setQtyInput(remaining >= 1 ? String(remaining) : '0');
        }
      } else {
        Alert.alert(
          t('wrongBarcodeTitle'),
          t('wrongBarcodeMessage') + (selectedLine.barcode || selectedLine.sku || '—')
        );
      }
      })();
    },
    [selectedLine, doc, t, isController, controllerVerifiedLineIds]
  );

  const closeUnpickModal = useCallback(() => {
    setUnpickTarget(null);
    setUnpickQtyInput('1');
    setUnpickReason(null);
    setUnpickSubmitting(false);
  }, []);

  const handleUnpickConfirm = useCallback(async () => {
    if (!taskId || !doc || !unpickTarget || !unpickReason || !isOnline) return;
    const delta = Math.floor(Number(unpickQtyInput) || 0);
    const maxQty = Math.floor(Number(unpickTarget.qty_picked) || 0);
    if (delta < 1 || delta > maxQty) {
      Alert.alert(t('error'), t('qtyRangeError', { max: maxQty }));
      return;
    }
    setUnpickSubmitting(true);
    try {
      const res = await unpickLine(
        unpickTarget.id,
        delta,
        unpickReason,
        `unpick-${taskId}-${unpickTarget.id}-${Date.now()}`
      );
      const newLines = (doc.lines ?? []).map((l) => (l.id === res.line.id ? res.line : l));
      const updated: PickingDocument = {
        ...doc,
        lines: newLines,
        progress: res.progress,
        status: res.document_status,
      };
      setDoc(updated);
      await saveCachedPickTaskDetail(taskId, updated);
      clearControllerVerifiedForGroup(taskId, newLines, unpickTarget, setControllerVerifiedLineIds);
      closeUnpickModal();
      closeLineScan();
      Alert.alert(t('success'), t('unpickDone'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('error');
      if (msg === UNAUTHORIZED_MSG) {
        navigation.replace('Login');
        closeUnpickModal();
        return;
      }
      Alert.alert(t('error'), msg);
    } finally {
      setUnpickSubmitting(false);
    }
  }, [
    taskId,
    doc,
    unpickTarget,
    unpickReason,
    unpickQtyInput,
    isOnline,
    t,
    navigation,
    closeUnpickModal,
    closeLineScan,
  ]);

  const handleLineQtySubmit = useCallback(async () => {
    if (!taskId || !doc || !selectedLine || !scannedBarcodeForQty) return;
    const qty = Math.floor(Number(qtyInput) || 0);
    if (isController) {
      if (
        doc.lines &&
        isControllerGroupFullyVerified(doc.lines, selectedLine, controllerVerifiedLineIds)
      ) {
        Alert.alert(t('verifiedBadge'), t('controllerPositionAlreadyVerified'));
        return;
      }
      if (qty !== selectedLine.qty_picked) {
        Alert.alert(t('error'), `${t('qtyMismatch') ?? 'Miqdor mos emas'}: ${selectedLine.product_name} — terilgan: ${selectedLine.qty_picked}`);
        return;
      }
      void playSuccessBeep();
      closeLineScan();
      const lineIdsToVerify = (doc.lines ?? []).filter(
        (l) =>
          l.product_name === selectedLine.product_name &&
          (l.barcode === selectedLine.barcode || l.sku === selectedLine.sku)
      ).map((l) => String(l.id));
      const firstVerify = controllerVerifiedLineIds.size === 0;
      setControllerVerifiedLineIds((prev) => {
        const next = new Set(prev);
        lineIdsToVerify.forEach((id) => next.add(id));
        saveControllerVerifiedLineIds(String(taskId), next);
        return next;
      });
      if (firstVerify && taskId) {
        void markControllerVerificationStarted(String(taskId)).catch(() => undefined);
      }
      return;
    }
    const remaining = selectedLine.qty_required - selectedLine.qty_picked;
    if (qty < 1 || qty > remaining) {
      Alert.alert(t('error'), t('qtyRangeError', { max: remaining }));
      return;
    }
    setSubmitting(true);
    try {
      if (isOnline) {
        const res = await pickLine(selectedLine.id, qty, `scan-${taskId}-${selectedLine.id}-${Date.now()}`);
        setDoc((prev) => (prev ? { ...prev, lines: prev.lines.map((l) => (l.id === res.line.id ? res.line : l)), progress: res.progress, status: res.document_status } : prev));
        await saveCachedPickTaskDetail(taskId, { ...doc, lines: (doc.lines ?? []).map((l) => (l.id === res.line.id ? res.line : l)), progress: res.progress, status: res.document_status } as PickingDocument);
        closeLineScan();
      } else {
        const additional = qty - 1;
        if (additional > 0) {
          await addToQueue('PICK_CONFIRM_ITEM', { taskId, itemId: selectedLine.id, qty: additional, ts: Date.now() });
        }
        const newPicked = selectedLine.qty_picked + (additional > 0 ? additional : 0);
        const updatedLine = { ...selectedLine, qty_picked: newPicked };
        const newLines = (doc.lines ?? []).map((l) => (l.id === selectedLine.id ? updatedLine : l));
        const updated = { ...doc, lines: newLines, progress: { ...doc.progress, picked: doc.progress.picked + (additional > 0 ? additional : 0) } };
        setDoc(updated);
        await saveCachedPickTaskDetail(taskId, updated);
        closeLineScan();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('error');
      if (msg === UNAUTHORIZED_MSG) { navigation.replace('Login'); closeLineScan(); return; }
      Alert.alert(t('error'), msg);
    } finally {
      setSubmitting(false);
    }
  }, [
    taskId,
    doc,
    selectedLine,
    scannedBarcodeForQty,
    qtyInput,
    closeLineScan,
    navigation,
    t,
    isOnline,
    isController,
    controllerVerifiedLineIds,
  ]);

  const handleChangePickSource = useCallback(
    async (lineId: string, locationId: string, lotId: string) => {
      if (!isOnline) {
        Alert.alert(t('error'), t('pickSwitchSourceOffline'));
        return;
      }
      setSubmitting(true);
      try {
        await changePickSource(lineId, { location_id: locationId, lot_id: lotId });
        Alert.alert(t('success'), t('pickSwitchSourceDone'));
        await load();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : t('loadError');
        if (msg === UNAUTHORIZED_MSG) {
          navigation.replace('Login');
          return;
        }
        Alert.alert(t('error'), msg);
      } finally {
        setSubmitting(false);
      }
    },
    [isOnline, load, navigation, t]
  );

  const doComplete = useCallback(
    async (incompleteReason: string | undefined) => {
      if (!taskId) return;
      setIncompleteReasonModalVisible(false);
      setSelectedIncompleteReason(null);
      setSubmitting(true);
      try {
        if (isOnline) {
          await completePickDocument(String(taskId), incompleteReason ? { incomplete_reason: incompleteReason } : undefined);
          if (isController) AsyncStorage.removeItem(CONTROLLER_VERIFIED_KEY(String(taskId)));
          navigation.reset({ index: 0, routes: [{ name: 'PickerHome', params: { profileType } }] });
        } else {
          await addToQueue('PICK_CLOSE_TASK', { taskId, ts: Date.now(), incomplete_reason: incompleteReason });
          if (isController) AsyncStorage.removeItem(CONTROLLER_VERIFIED_KEY(String(taskId)));
          navigation.reset({ index: 0, routes: [{ name: 'PickerHome', params: { profileType } }] });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : t('completeError');
        if (msg === UNAUTHORIZED_MSG) navigation.replace('Login');
        else Alert.alert(t('error'), msg);
      } finally {
        setSubmitting(false);
      }
    },
    [taskId, navigation, t, isOnline, isController, profileType]
  );

  const handleComplete = useCallback(async () => {
    if (!taskId) return;
    if (!isController) {
      const incomplete = (doc?.lines ?? []).filter((l) => l.qty_picked < l.qty_required);
      if (incomplete?.length) {
        setSelectedIncompleteReason(null);
        setIncompleteReasonModalVisible(true);
        return;
      }
    } else {
      const lines = doc?.lines ?? [];
      const pickedLines = lines.filter((l) => Number(l.qty_picked) >= Number(l.qty_required));
      const allVerified =
        pickedLines.length === 0 || pickedLines.every((l) => controllerVerifiedLineIds.has(String(l.id)));
      if (!allVerified) {
        Alert.alert(t('error'), t('verifyAllPickedLines'));
        return;
      }
    }
    await doComplete(undefined);
  }, [taskId, doc, isController, doComplete, controllerVerifiedLineIds, t]);

  const handleConfirmIncompleteReason = useCallback(() => {
    if (!selectedIncompleteReason) return;
    doComplete(selectedIncompleteReason);
  }, [selectedIncompleteReason, doComplete]);

  const openLineReasonModal = useCallback((line: PickingLine) => {
    setLineForReasonModal(line);
    setSelectedLineReason(null);
    setLineReasonModalVisible(true);
  }, []);

  const closeLineReasonModal = useCallback(() => {
    setLineReasonModalVisible(false);
    setLineForReasonModal(null);
    setSelectedLineReason(null);
  }, []);

  const handleConfirmLineReason = useCallback(async () => {
    if (!lineForReasonModal || !selectedLineReason || !taskId) return;
    setSubmitting(true);
    try {
      if (!isOnline) {
        Alert.alert(t('error'), t('reportReasonOffline') || 'Sabab bildirish faqat onlayn rejimda.');
        return;
      }
      const res = await skipLine(lineForReasonModal.id, selectedLineReason);
      setDoc((prev) =>
        prev
          ? {
              ...prev,
              lines: prev.lines.map((l) => (l.id === res.line.id ? res.line : l)),
              progress: res.progress,
              status: res.document_status,
            }
          : prev
      );
      if (doc) {
        await saveCachedPickTaskDetail(taskId, {
          ...doc,
          lines: doc.lines.map((l) => (l.id === res.line.id ? res.line : l)),
          progress: res.progress,
          status: res.document_status,
        } as PickingDocument);
      }
      closeLineReasonModal();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('error');
      if (msg === UNAUTHORIZED_MSG) {
        navigation.replace('Login');
        closeLineReasonModal();
        return;
      }
      Alert.alert(t('error'), msg);
    } finally {
      setSubmitting(false);
    }
  }, [lineForReasonModal, selectedLineReason, taskId, isOnline, doc, navigation, t, closeLineReasonModal]);

  const goBack = useCallback(() => {
    if (doc?.status === 'completed') {
      navigation.reset({ index: 0, routes: [{ name: 'PickerHome', params: { profileType } }] });
    } else {
      navigation.goBack();
    }
  }, [doc?.status, navigation, profileType]);

  if (loading) {
    return (
      <View style={[styles.centered, isDark && styles.centeredDark]}>
        <ActivityIndicator size="large" color={isDark ? '#93c5fd' : '#1976d2'} />
        <Text style={[styles.loadingText, isDark && styles.loadingTextDark]}>{t('loading')}</Text>
      </View>
    );
  }

  if (error || !doc) {
    return (
      <View style={[styles.centered, isDark && styles.centeredDark]}>
        <Text style={[styles.errorText, isDark && styles.errorTextDark]}>{error || t('notFound')}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryBtnText}>{t('retry')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="arrow-left" size={24} color={isDark ? '#93c5fd' : '#1976d2'} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity onPress={goBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="arrow-left" size={24} color={isDark ? '#93c5fd' : '#1976d2'} />
        </TouchableOpacity>
        <Text style={[styles.title, isDark && styles.titleDark]}>
          {doc.order_number ? t('orderNumberDisplay', { number: doc.order_number }) : (doc.reference_number ?? '—')}
        </Text>
        <View style={[styles.badge, isDark && styles.badgeDark]}>
          <Text style={[styles.badgeText, isDark && styles.badgeTextDark]}>
            {isController && doc.status === 'picked'
              ? t('statusPendingVerify')
              : t(STATUS_KEYS[doc.status] ?? 'statusNew')}
          </Text>
        </View>
        <Text style={[styles.progressText, isDark && styles.progressTextDark]}>
          {t('picked')}: {(doc.progress?.picked ?? 0)} / {(doc.progress?.required ?? 0)}
        </Text>
        {isController && (
          <Text style={[styles.pickerNameText, isDark && styles.pickerNameTextDark]}>
            {t('pickerNameLabel')}: {doc.assigned_to_user_name ?? '—'}
          </Text>
        )}
      </View>

      {isController && doc.incomplete_reason && (
        <View style={[styles.incompleteReasonBanner, isDark && styles.incompleteReasonBannerDark]}>
          <Text style={[styles.incompleteReasonBannerLabel, isDark && styles.incompleteReasonBannerLabelDark]}>{t('incompleteReasonLabel')}</Text>
          <Text style={[styles.incompleteReasonBannerValue, isDark && styles.incompleteReasonBannerValueDark]}>
            {t(`reason_${doc.incomplete_reason}` as 'reason_expired') || doc.incomplete_reason}
          </Text>
        </View>
      )}

      <ScrollView
        style={[styles.scroll, isDark && styles.scrollDark]}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}>{t('positions')}</Text>
        {(doc?.lines?.length ? groupLinesByProduct(doc.lines) : []).map(({ virtualLine, groupLines }, index) => {
          const allGroupVerified = groupLines.every((l) => controllerVerifiedLineIds.has(String(l.id)));
          const stockLine =
            groupLines.find((l) => !l.is_vip_expiry_informational && l.qty_picked < l.qty_required) ??
            groupLines[0] ??
            virtualLine;
          const allowAlternatePick = !isController && groupLines.length === 1;
          return (
            <LineCard
              key={virtualLine.id ?? `line-${index}`}
              line={virtualLine}
              stockLine={stockLine}
              onPress={() => openLineScan(stockLine, virtualLine)}
              onReportReason={!isController && isOnline ? openLineReasonModal : undefined}
              isOnline={isOnline}
              t={t}
              readOnly={false}
              isController={isController}
              controllerVerified={isController && allGroupVerified}
              isDark={isDark}
              allowAlternatePick={allowAlternatePick}
              onPickAlternate={
                allowAlternatePick && isOnline
                  ? (locationId, lotId) => handleChangePickSource(String(stockLine.id), locationId, lotId)
                  : undefined
              }
            />
          );
        })}
      </ScrollView>

      <Modal
        visible={!!selectedLine}
        transparent
        animationType="slide"
        onRequestClose={closeLineScan}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={closeLineScan}
        >
          <View style={[styles.modalContent, isDark && styles.modalContentDark]} onStartShouldSetResponder={() => true}>
            {selectedLine && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, isDark && styles.modalTitleDark]} numberOfLines={2}>
                    {t('modalPickTitle')}: {selectedLine.product_name}
                  </Text>
                  <TouchableOpacity onPress={closeLineScan} hitSlop={12}>
                    <Text style={[styles.modalClose, isDark && styles.modalCloseDark]}>✕</Text>
                  </TouchableOpacity>
                </View>
                {!scannedBarcodeForQty ? (
                  <>
                    <Text style={[styles.modalHint, isDark && styles.modalHintDark]}>
                      {t('modalScanHint')}
                    </Text>
                    <TouchableOpacity
                      style={styles.scanBtnModal}
                      onPress={() => {
                        closeLineScan();
                        navigation.navigate('Scanner', {
                          returnToPick: true,
                          taskId,
                          lineId: selectedLine.id,
                          profileType: profileType ?? 'picker',
                        });
                      }}
                      activeOpacity={0.8}
                    >
                      <Icon name="barcode-scan" size={28} color="#fff" />
                      <Text style={styles.scanBtnModalText}>{t('scanButton')}</Text>
                    </TouchableOpacity>
                    <Text style={styles.modalOr}>{t('orEnterManually')}</Text>
                    <ScanInput
                      onSubmit={handleLineScanSubmit}
                      placeholder={selectedLine.barcode || selectedLine.sku || t('barcodeSkuShort')}
                      label={t('barcodeSkuLabel')}
                      submitText={t('submit')}
                      disabled={submitting}
                    />
                  </>
                ) : (
                  <>
                    <Text style={[styles.modalHint, isDark && styles.modalHintDark]}>
                      {isController
                        ? t('quantityVerify', { n: selectedLine.qty_picked })
                        : t('quantityRemaining', { n: selectedLine.qty_required - selectedLine.qty_picked })}
                    </Text>
                    <TextInput
                      style={[styles.qtyInput, isDark && styles.qtyInputDark]}
                      value={qtyInput}
                      onChangeText={(v) => setQtyInput(sanitizeStockQtyDigits(v))}
                      keyboardType="number-pad"
                      placeholder={t('quantity')}
                      placeholderTextColor={isDark ? '#64748b' : '#999'}
                      maxLength={4}
                    />
                    <TouchableOpacity
                      style={[styles.modalSubmitBtn, submitting && styles.modalSubmitDisabled]}
                      onPress={handleLineQtySubmit}
                      disabled={submitting}
                    >
                      <Text style={styles.modalSubmitText}>
                        {submitting ? '…' : t('confirmButton')}
                      </Text>
                    </TouchableOpacity>
                    {isController && selectedLine.qty_picked > 0 && (
                      <TouchableOpacity
                        style={styles.unpickLinkBtn}
                        onPress={() => {
                          setUnpickTarget(selectedLine);
                          setUnpickQtyInput('1');
                          setUnpickReason(null);
                        }}
                        disabled={submitting}
                      >
                        <Text style={styles.unpickLinkText}>{t('unpickActionTitle')}</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={!!unpickTarget}
        transparent
        animationType="slide"
        onRequestClose={closeUnpickModal}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={closeUnpickModal}
        >
          <View style={[styles.modalContent, isDark && styles.modalContentDark]} onStartShouldSetResponder={() => true}>
            {unpickTarget && (
              <>
                <Text style={[styles.modalTitle, isDark && styles.modalTitleDark]}>
                  {t('unpickReasonTitle')}
                </Text>
                <Text style={[styles.modalHint, isDark && styles.modalHintDark]} numberOfLines={2}>
                  {unpickTarget.product_name}
                </Text>
                <TextInput
                  style={[styles.qtyInput, isDark && styles.qtyInputDark]}
                  value={unpickQtyInput}
                  onChangeText={(v) => setUnpickQtyInput(sanitizeStockQtyDigits(v))}
                  keyboardType="number-pad"
                  placeholder={t('unpickQtyLabel')}
                  placeholderTextColor={isDark ? '#64748b' : '#999'}
                  maxLength={4}
                />
                <ScrollView style={styles.incompleteReasonList} nestedScrollEnabled>
                  {INCOMPLETE_REASON_KEYS.map((key) => (
                    <TouchableOpacity
                      key={key}
                      style={[
                        styles.incompleteReasonRow,
                        unpickReason === key && styles.incompleteReasonRowSelected,
                        isDark && styles.incompleteReasonRowDark,
                        unpickReason === key && isDark && styles.incompleteReasonRowSelectedDark,
                      ]}
                      onPress={() => setUnpickReason(key)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.incompleteReasonRowText,
                          isDark && styles.incompleteReasonRowTextDark,
                          unpickReason === key && styles.incompleteReasonRowTextSelected,
                        ]}
                      >
                        {t(`reason_${key}`)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TouchableOpacity
                  style={[styles.modalSubmitBtn, (unpickSubmitting || !unpickReason) && styles.modalSubmitDisabled]}
                  onPress={handleUnpickConfirm}
                  disabled={unpickSubmitting || !unpickReason}
                >
                  <Text style={styles.modalSubmitText}>
                    {unpickSubmitting ? '…' : t('confirmButton')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.unpickLinkBtn} onPress={closeUnpickModal}>
                  <Text style={styles.unpickLinkText}>{t('cancel')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={incompleteReasonModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIncompleteReasonModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIncompleteReasonModalVisible(false)}
        >
          <View style={[styles.modalContent, styles.incompleteReasonModal, isDark && styles.modalContentDark]} onStartShouldSetResponder={() => true}>
            <Text style={[styles.incompleteReasonTitle, isDark && styles.incompleteReasonTitleDark]}>{t('incompleteReasonTitle')}</Text>
            <Text style={[styles.incompleteReasonHint, isDark && styles.incompleteReasonHintDark]}>{t('incompleteReasonSelect')}</Text>
            <ScrollView style={styles.incompleteReasonList} nestedScrollEnabled>
              {INCOMPLETE_REASON_KEYS.map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.incompleteReasonRow,
                    selectedIncompleteReason === key && styles.incompleteReasonRowSelected,
                    isDark && styles.incompleteReasonRowDark,
                    selectedIncompleteReason === key && isDark && styles.incompleteReasonRowSelectedDark,
                  ]}
                  onPress={() => setSelectedIncompleteReason(key)}
                  activeOpacity={0.7}
                >
                  <Icon
                    name={selectedIncompleteReason === key ? 'radiobox-marked' : 'radiobox-blank'}
                    size={22}
                    color={selectedIncompleteReason === key ? (isDark ? '#93c5fd' : '#1976d2') : (isDark ? '#94a3b8' : '#666')}
                  />
                  <Text style={[styles.incompleteReasonRowText, isDark && styles.incompleteReasonRowTextDark]}>{t(`reason_${key}`)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.incompleteReasonActions}>
              <TouchableOpacity
                style={[styles.incompleteReasonConfirm, !selectedIncompleteReason && styles.incompleteReasonConfirmDisabled]}
                onPress={handleConfirmIncompleteReason}
                disabled={!selectedIncompleteReason}
              >
                <Text style={styles.incompleteReasonConfirmText}>{t('incompleteConfirmComplete')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.incompleteReasonCancel} onPress={() => setIncompleteReasonModalVisible(false)}>
                <Text style={[styles.incompleteReasonCancelText, isDark && styles.incompleteReasonCancelTextDark]}>{t('cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={lineReasonModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeLineReasonModal}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={closeLineReasonModal}
        >
          <View style={[styles.modalContent, styles.incompleteReasonModal, isDark && styles.modalContentDark]} onStartShouldSetResponder={() => true}>
            <Text style={[styles.incompleteReasonTitle, isDark && styles.incompleteReasonTitleDark]}>{t('lineReasonModalTitle')}</Text>
            {lineForReasonModal && (
              <Text style={[styles.modalHint, isDark && styles.modalHintDark]} numberOfLines={2}>
                {lineForReasonModal.product_name}
              </Text>
            )}
            <Text style={[styles.incompleteReasonHint, isDark && styles.incompleteReasonHintDark]}>{t('incompleteReasonSelect')}</Text>
            <ScrollView style={styles.incompleteReasonList} nestedScrollEnabled>
              {INCOMPLETE_REASON_KEYS.map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.incompleteReasonRow,
                    selectedLineReason === key && styles.incompleteReasonRowSelected,
                    isDark && styles.incompleteReasonRowDark,
                    selectedLineReason === key && isDark && styles.incompleteReasonRowSelectedDark,
                  ]}
                  onPress={() => setSelectedLineReason(key)}
                  activeOpacity={0.7}
                >
                  <Icon
                    name={selectedLineReason === key ? 'radiobox-marked' : 'radiobox-blank'}
                    size={22}
                    color={selectedLineReason === key ? (isDark ? '#93c5fd' : '#1976d2') : (isDark ? '#94a3b8' : '#666')}
                  />
                  <Text style={[styles.incompleteReasonRowText, isDark && styles.incompleteReasonRowTextDark]}>{t(`reason_${key}`)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.incompleteReasonActions}>
              <TouchableOpacity
                style={[styles.incompleteReasonConfirm, (!selectedLineReason || submitting) && styles.incompleteReasonConfirmDisabled]}
                onPress={handleConfirmLineReason}
                disabled={!selectedLineReason || submitting}
              >
                <Text style={styles.incompleteReasonConfirmText}>
                  {submitting ? '…' : t('confirmButton')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.incompleteReasonCancel} onPress={closeLineReasonModal} disabled={submitting}>
                <Text style={[styles.incompleteReasonCancelText, isDark && styles.incompleteReasonCancelTextDark]}>{t('cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      <View style={[styles.footer, isDark && styles.footerDark]}>
        {isController && (
          <TouchableOpacity
            style={styles.scanBottomBtn}
            onPress={() => {
              navigation.navigate('Scanner', {
                returnToPick: true,
                taskId,
                profileType: profileType ?? 'picker',
              });
            }}
            disabled={submitting}
          >
            <Icon name="barcode-scan" size={28} color="#fff" />
            <Text style={styles.scanBottomBtnText}>{t('scanButton')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.completeBtn, submitting && styles.completeBtnDisabled]}
          onPress={handleComplete}
          disabled={submitting}
        >
          <Text style={styles.completeBtnText}>
            {submitting ? t('submittingProgress') : t('completePicking')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function LineCard({
  line,
  stockLine,
  onPress,
  onReportReason,
  isOnline,
  t,
  readOnly,
  isController,
  controllerVerified,
  isDark,
  allowAlternatePick,
  onPickAlternate,
}: {
  line: PickingLine;
  stockLine: PickingLine;
  onPress?: () => void;
  onReportReason?: (line: PickingLine) => void;
  isOnline?: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
  readOnly?: boolean;
  isController?: boolean;
  controllerVerified?: boolean;
  isDark?: boolean;
  allowAlternatePick?: boolean;
  onPickAlternate?: (locationId: string, lotId: string) => void;
}) {
  const qtyPicked = Number(line.qty_picked) || 0;
  const qtyRequired = Number(line.qty_required) || 0;
  const isDone = qtyPicked >= qtyRequired;
  const isIncomplete = !isDone;
  const isRejected = Boolean(line.skip_reason);

  const cardStyle = [
    styles.lineCard,
    isDark && styles.lineCardDark,
    isRejected
      ? styles.lineCardRejected
      : isController
        ? (isIncomplete
            ? styles.lineCardIncomplete
            : controllerVerified
              ? styles.lineCardDone
              : undefined)
        : (isDone ? styles.lineCardDone : isIncomplete ? styles.lineCardIncomplete : undefined),
    isRejected && isDark && styles.lineCardRejectedDark,
  ].filter(Boolean);

  const showDoneBadge = !isController && isDone && !isRejected;
  const showVerifiedBadge = isController && controllerVerified;
  const showReportReasonBtn =
    !isController && isDone && !isRejected && isOnline && onReportReason;

  const alts = stockLine.alternate_locations ?? [];
  const canTapAlternates = Boolean(allowAlternatePick && onPickAlternate && !isRejected && !isDone);

  const mainBlock = (
    <>
      <Text style={[styles.lineName, isDark && styles.lineNameDark]}>{line.product_name ?? '—'}</Text>
      <Text style={[styles.lineMeta, isDark && styles.lineMetaDark]}>
        {t('pickPrimaryLocation')}: {stockLine.location_code ?? '—'}
      </Text>
      <Text style={[styles.lineMeta, isDark && styles.lineMetaDark]}>{t('barcodeLabel')}: {line.barcode ?? '—'}</Text>
      <Text style={styles.lineQty}>
        {qtyPicked} / {qtyRequired}
      </Text>
      {isRejected && line.skip_reason && (
        <Text style={styles.lineSkippedReasonText}>
          {t('lineSkippedReason')}: {t(`reason_${line.skip_reason}` as 'reason_expired') || line.skip_reason}
        </Text>
      )}
      {showDoneBadge && (
        <View style={styles.doneBadge}>
          <Text style={styles.doneBadgeText}>{t('doneBadge')}</Text>
        </View>
      )}
      {showVerifiedBadge && (
        <View style={styles.doneBadge}>
          <Text style={styles.doneBadgeText}>{t('verifiedBadge')}</Text>
        </View>
      )}
    </>
  );

  return (
    <View style={cardStyle}>
      {readOnly ? (
        mainBlock
      ) : (
        <TouchableOpacity onPress={onPress} activeOpacity={0.8} disabled={!onPress}>
          {mainBlock}
        </TouchableOpacity>
      )}
      {alts.length > 0 ? (
        <View style={[styles.lineAltSection, isDark && styles.lineAltSectionDark]}>
          <Text style={[styles.lineAltTitle, isDark && styles.lineAltTitleDark]}>{t('pickAlternateLocations')}</Text>
          {canTapAlternates ? (
            <Text style={[styles.lineAltHint, isDark && styles.lineAltHintDark]}>{t('pickTapToSwitchSource')}</Text>
          ) : null}
          <ScrollView style={styles.lineAltScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {alts.map((alt) => {
              const label = `${alt.location_code}${alt.expiry_date ? ` · ${alt.expiry_date}` : ''} · ${t('pickAlternateQty', { qty: Math.round(Number(alt.available_qty) || 0) })}`;
              const isPri = alt.is_primary;
              if (canTapAlternates && !isPri) {
                return (
                  <TouchableOpacity
                    key={`${alt.location_id}-${alt.lot_id}`}
                    style={[styles.lineAltRow, isDark && styles.lineAltRowDark]}
                    onPress={() => {
                      Alert.alert(t('pickAlternateLocations'), label, [
                        { text: t('cancel'), style: 'cancel' },
                        {
                          text: t('confirmButton'),
                          onPress: () => onPickAlternate!(alt.location_id, alt.lot_id),
                        },
                      ]);
                    }}
                    activeOpacity={0.7}
                  >
                    <Icon name="map-marker-outline" size={18} color={isDark ? '#93c5fd' : '#1565c0'} />
                    <Text style={[styles.lineAltRowText, isDark && styles.lineAltRowTextDark]} numberOfLines={2}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              }
              return (
                <View
                  key={`${alt.location_id}-${alt.lot_id}`}
                  style={[
                    styles.lineAltRow,
                    isPri && styles.lineAltRowPrimary,
                    isDark && styles.lineAltRowDark,
                    isPri && isDark && styles.lineAltRowPrimaryDark,
                  ]}
                >
                  <Icon
                    name={isPri ? 'star-circle-outline' : 'map-marker-outline'}
                    size={18}
                    color={isDark ? '#94a3b8' : '#666'}
                  />
                  <Text style={[styles.lineAltRowText, isDark && styles.lineAltRowTextDark]} numberOfLines={2}>
                    {isPri ? `★ ${label}` : label}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
      {showReportReasonBtn && (
        <TouchableOpacity
          style={styles.reportReasonBtn}
          onPress={() => onReportReason?.(line)}
          activeOpacity={0.8}
        >
          <Icon name="alert-circle-outline" size={18} color="#c62828" />
          <Text style={styles.reportReasonBtnText}>{t('reportReasonBtn')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: { marginTop: 12, fontSize: 16, color: '#666' },
  errorText: { fontSize: 16, color: '#c62828', textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: '#1976d2',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  retryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  backBtn: { paddingVertical: 8 },
  backBtnText: { color: '#1976d2', fontSize: 16 },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backLink: { color: '#1976d2', fontSize: 16, marginBottom: 6 },
  title: { fontSize: 20, fontWeight: '700', color: '#111' },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  badgeText: { fontSize: 13, fontWeight: '600', color: '#1565c0' },
  progressText: { fontSize: 14, color: '#666', marginTop: 6 },
  pickerNameText: { fontSize: 13, color: '#555', marginTop: 4 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#111', marginBottom: 12 },
  lineCard: {
    backgroundColor: '#fff',
    padding: 12,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  lineCardDone: { backgroundColor: '#e8f5e9', borderColor: '#c8e6c9' },
  lineCardIncomplete: { backgroundColor: '#ffebee', borderColor: '#ffcdd2' },
  lineCardRejected: { backgroundColor: '#ffebee', borderColor: '#c62828', borderWidth: 1.5 },
  lineName: { fontSize: 16, fontWeight: '600', color: '#111' },
  lineSkippedReasonText: { fontSize: 13, color: '#c62828', marginTop: 6, fontStyle: 'italic' },
  reportReasonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c62828',
    backgroundColor: '#fff',
  },
  reportReasonBtnText: { fontSize: 14, color: '#c62828', fontWeight: '600' },
  lineMeta: { fontSize: 14, color: '#666', marginTop: 4 },
  lineQty: { fontSize: 14, fontWeight: '600', marginTop: 6 },
  lineAltSection: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8 },
  lineAltSectionDark: { borderTopColor: '#334155' },
  lineAltTitle: { fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 4 },
  lineAltHint: { fontSize: 12, color: '#666', marginBottom: 6 },
  lineAltScroll: { maxHeight: 140 },
  lineAltRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginBottom: 4,
    borderRadius: 8,
    backgroundColor: '#f9f9f9',
  },
  lineAltRowPrimary: { backgroundColor: '#e8f4fd' },
  lineAltRowText: { fontSize: 13, color: '#333', flex: 1 },
  doneBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#2e7d32',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 8,
  },
  doneBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  scanBottomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#2e7d32',
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 12,
  },
  scanBottomBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  completeBtn: {
    backgroundColor: '#1976d2',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  completeBtnDisabled: { opacity: 0.7 },
  completeBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    minHeight: 260,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#111',
    paddingRight: 12,
  },
  modalClose: {
    fontSize: 22,
    color: '#666',
    padding: 4,
  },
  modalHint: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  scanBtnModal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1976d2',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 12,
    gap: 10,
  },
  scanBtnModalText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOr: {
    fontSize: 13,
    color: '#888',
    marginBottom: 8,
    textAlign: 'center',
  },
  qtyInput: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    color: '#111',
    marginBottom: 16,
  },
  modalSubmitBtn: {
    backgroundColor: '#1976d2',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalSubmitDisabled: { opacity: 0.7 },
  modalSubmitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  unpickLinkBtn: { marginTop: 12, paddingVertical: 10, alignItems: 'center' },
  unpickLinkText: { color: '#c62828', fontSize: 15, fontWeight: '600' },
  incompleteReasonModal: { maxHeight: '80%' },
  incompleteReasonTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    marginBottom: 8,
  },
  incompleteReasonHint: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  incompleteReasonList: { maxHeight: 280, marginBottom: 16 },
  incompleteReasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: '#f5f5f5',
    gap: 12,
  },
  incompleteReasonRowSelected: {
    backgroundColor: '#e3f2fd',
  },
  incompleteReasonRowText: { fontSize: 16, color: '#111', flex: 1 },
  incompleteReasonActions: { gap: 10 },
  incompleteReasonConfirm: {
    backgroundColor: '#1976d2',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  incompleteReasonConfirmDisabled: { opacity: 0.5 },
  incompleteReasonConfirmText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  incompleteReasonCancel: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  incompleteReasonCancelText: { color: '#666', fontSize: 16 },
  incompleteReasonBanner: {
    backgroundColor: '#fff3e0',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ffe0b2',
  },
  incompleteReasonBannerLabel: { fontSize: 12, color: '#e65100', marginBottom: 2 },
  incompleteReasonBannerValue: { fontSize: 15, fontWeight: '600', color: '#bf360c' },
  // Dark
  containerDark: { backgroundColor: '#0f172a' },
  centeredDark: { backgroundColor: '#0f172a' },
  loadingTextDark: { color: '#94a3b8' },
  errorTextDark: { color: '#fca5a5' },
  headerDark: { backgroundColor: '#1e293b', borderBottomColor: '#334155' },
  titleDark: { color: '#f1f5f9' },
  badgeDark: { backgroundColor: '#1e3a5f' },
  badgeTextDark: { color: '#93c5fd' },
  progressTextDark: { color: '#94a3b8' },
  pickerNameTextDark: { color: '#94a3b8' },
  incompleteReasonBannerDark: { backgroundColor: '#422006', borderBottomColor: '#78350f' },
  incompleteReasonBannerLabelDark: { color: '#fcd34d' },
  incompleteReasonBannerValueDark: { color: '#fde68a' },
  scrollDark: { backgroundColor: '#0f172a' },
  sectionTitleDark: { color: '#f1f5f9' },
  lineCardDark: { backgroundColor: '#1e293b', borderColor: '#334155' },
  lineCardRejectedDark: { borderColor: '#dc2626' },
  lineNameDark: { color: '#f1f5f9' },
  lineMetaDark: { color: '#94a3b8' },
  lineQtyDark: { color: '#f1f5f9' },
  lineAltTitleDark: { color: '#e2e8f0' },
  lineAltHintDark: { color: '#94a3b8' },
  lineAltRowDark: { backgroundColor: '#334155' },
  lineAltRowPrimaryDark: { backgroundColor: '#1e3a5f' },
  lineAltRowTextDark: { color: '#e2e8f0' },
  lineSkippedReasonTextDark: { color: '#fca5a5' },
  footerDark: { backgroundColor: '#1e293b', borderTopColor: '#334155' },
  modalContentDark: { backgroundColor: '#1e293b' },
  modalTitleDark: { color: '#f1f5f9' },
  modalCloseDark: { color: '#94a3b8' },
  modalHintDark: { color: '#94a3b8' },
  qtyInputDark: { backgroundColor: '#334155', borderColor: '#475569', color: '#f1f5f9' },
  incompleteReasonTitleDark: { color: '#f1f5f9' },
  incompleteReasonHintDark: { color: '#94a3b8' },
  incompleteReasonRowDark: { backgroundColor: '#334155' },
  incompleteReasonRowSelectedDark: { backgroundColor: '#1e3a5f' },
  incompleteReasonRowTextDark: { color: '#f1f5f9' },
  incompleteReasonCancelTextDark: { color: '#93c5fd' },
});
