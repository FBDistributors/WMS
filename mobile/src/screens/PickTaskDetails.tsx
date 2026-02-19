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
import type { PickingDocument, PickingLine } from '../api/picking.types';
import apiClient, { UNAUTHORIZED_MSG } from '../api/client';
import { getTaskById, submitScan } from '../api/picking';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ScanInput } from '../components/ScanInput';
import { useLocale } from '../i18n/LocaleContext';
import { playSuccessBeep } from '../utils/playBeep';
import { useNetwork } from '../network';
import { getCachedPickTaskDetail, saveCachedPickTaskDetail } from '../offline/offlineDb';
import { addToQueue } from '../offline/offlineQueue';

function barcodeMatchesLine(value: string, line: PickingLine): boolean {
  const v = value.trim().toLowerCase();
  if (line.barcode && line.barcode.toLowerCase() === v) return true;
  if (line.sku && line.sku.toLowerCase() === v) return true;
  return false;
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
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { isOnline } = useNetwork();
  const taskId = route.params?.taskId ?? '';
  const profileType = route.params?.profileType ?? 'picker';
  const isController = profileType === 'controller';
  const [doc, setDoc] = useState<PickingDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedLine, setSelectedLine] = useState<PickingLine | null>(null);
  const [scannedBarcodeForQty, setScannedBarcodeForQty] = useState<string | null>(null);
  const [qtyInput, setQtyInput] = useState('');

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError(null);
    try {
      if (isOnline) {
        const data = await getTaskById(taskId);
        setDoc(data);
        await saveCachedPickTaskDetail(taskId, data);
      } else {
        const cached = await getCachedPickTaskDetail(taskId);
        setDoc(cached as PickingDocument | null);
        if (!cached) setError(t('notFound'));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('loadError');
      setError(msg);
      if (msg === UNAUTHORIZED_MSG) navigation.replace('Login');
    } finally {
      setLoading(false);
    }
  }, [taskId, navigation, t, isOnline]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      const { scannedBarcode, lineId } = route.params ?? {};
      if (!scannedBarcode || !doc) return;
      navigation.setParams({ scannedBarcode: undefined, lineId: undefined });

      if (lineId) {
        const line = doc.lines.find((l) => l.id === lineId);
        if (!line) return;
        if (barcodeMatchesLine(scannedBarcode, line)) {
          setSelectedLine(line);
          void playSuccessBeep();
          setScannedBarcodeForQty(scannedBarcode);
          const remaining = line.qty_required - line.qty_picked;
          setQtyInput(remaining >= 1 ? String(remaining) : '0');
        } else {
          setScannedBarcodeForQty(null);
          setQtyInput('');
          Alert.alert(
            t('wrongBarcodeTitle'),
            t('wrongBarcodeMessage') + (line.barcode || line.sku || '—')
          );
        }
        return;
      }

      if (isController) {
        const q = scannedBarcode.trim().toLowerCase();
        const line = doc.lines.find(
          (l) =>
            (l.barcode && l.barcode.toLowerCase() === q) ||
            (l.sku && l.sku.toLowerCase() === q)
        );
        if (!line) {
          Alert.alert(t('wrongBarcodeTitle'), t('productNotInOrder'));
          return;
        }
        setSelectedLine(line);
        void playSuccessBeep();
        setScannedBarcodeForQty(scannedBarcode);
        setQtyInput(String(line.qty_picked));
      }
    }, [route.params?.scannedBarcode, route.params?.lineId, doc, navigation, t, isController])
  );

  const openLineScan = useCallback((line: PickingLine) => {
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
      if (!selectedLine) return;
      if (barcodeMatchesLine(value, selectedLine)) {
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
    },
    [selectedLine, t, isController]
  );

  const handleLineQtySubmit = useCallback(async () => {
    if (!taskId || !doc || !selectedLine || !scannedBarcodeForQty) return;
    const qty = Math.floor(Number(qtyInput) || 0);
    if (isController) {
      if (qty !== selectedLine.qty_picked) {
        Alert.alert(t('error'), `${t('qtyMismatch') ?? 'Miqdor mos emas'}: ${selectedLine.product_name} — terilgan: ${selectedLine.qty_picked}`);
        return;
      }
      void playSuccessBeep();
      closeLineScan();
      Alert.alert(t('success'), `${selectedLine.product_name}: ${qty} / ${selectedLine.qty_required}`);
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
        const res = await submitScan(taskId, { barcode: scannedBarcodeForQty, qty });
        setDoc((prev) => (prev ? { ...prev, lines: prev.lines.map((l) => (l.id === res.line.id ? res.line : l)), progress: res.progress, status: res.document_status } : prev));
        await saveCachedPickTaskDetail(taskId, { ...doc, lines: doc.lines.map((l) => (l.id === res.line.id ? res.line : l)), progress: res.progress, status: res.document_status } as PickingDocument);
        closeLineScan();
      } else {
        const additional = qty - 1;
        if (additional > 0) {
          await addToQueue('PICK_CONFIRM_ITEM', { taskId, itemId: selectedLine.id, qty: additional, ts: Date.now() });
        }
        const newPicked = selectedLine.qty_picked + (additional > 0 ? additional : 0);
        const updatedLine = { ...selectedLine, qty_picked: newPicked };
        const newLines = doc.lines.map((l) => (l.id === selectedLine.id ? updatedLine : l));
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
  }, [taskId, doc, selectedLine, scannedBarcodeForQty, qtyInput, closeLineScan, navigation, t, isOnline, isController]);

  const handleComplete = useCallback(async () => {
    if (!taskId) return;
    if (!isController) {
      const incomplete = doc?.lines.filter((l) => l.qty_picked < l.qty_required);
      if (incomplete?.length) {
        Alert.alert(t('incomplete'), t('incompleteLines', { count: incomplete.length }));
        return;
      }
    }
    setSubmitting(true);
    try {
      const profileType = isController ? 'controller' : 'picker';
      if (isOnline) {
        await apiClient.post(`/picking/documents/${taskId}/complete`);
        navigation.replace('PickTaskList', { profileType });
        Alert.alert(t('success'), t('pickingComplete'));
      } else {
        await addToQueue('PICK_CLOSE_TASK', { taskId, ts: Date.now() });
        navigation.replace('PickTaskList', { profileType });
        Alert.alert(t('success'), t('pickingComplete'));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('completeError');
      if (msg === UNAUTHORIZED_MSG) navigation.replace('Login');
      else Alert.alert(t('error'), msg);
    } finally {
      setSubmitting(false);
    }
  }, [taskId, doc, navigation, t, isOnline, isController]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1976d2" />
        <Text style={styles.loadingText}>{t('loading')}</Text>
      </View>
    );
  }

  if (error || !doc) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error || t('notFound')}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryBtnText}>{t('retry')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="arrow-left" size={24} color="#1976d2" />
        </TouchableOpacity>
      </View>
    );
  }

  const goBack = useCallback(() => {
    const profileType = isController ? 'controller' : 'picker';
    if (doc?.status === 'completed') {
      navigation.replace('PickTaskList', { profileType });
    } else {
      navigation.goBack();
    }
  }, [doc?.status, isController, navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="arrow-left" size={24} color="#1976d2" />
        </TouchableOpacity>
        <Text style={styles.title}>{doc.reference_number}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {isController && doc.status === 'picked'
              ? t('statusPendingVerify')
              : t(STATUS_KEYS[doc.status] ?? 'statusNew')}
          </Text>
        </View>
        <Text style={styles.progressText}>
          {t('picked')}: {doc.progress.picked} / {doc.progress.required}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionTitle}>{t('positions')}</Text>
        {doc.lines.map((line) => (
          <LineCard
            key={line.id}
            line={line}
            onPress={isController ? undefined : () => openLineScan(line)}
            t={t}
            readOnly={isController}
          />
        ))}
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
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            {selectedLine && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle} numberOfLines={2}>
                    {t('modalPickTitle')}: {selectedLine.product_name}
                  </Text>
                  <TouchableOpacity onPress={closeLineScan} hitSlop={12}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>
                {!scannedBarcodeForQty ? (
                  <>
                    <Text style={styles.modalHint}>
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
                    <Text style={styles.modalHint}>
                      {isController
                        ? t('quantityVerify', { n: selectedLine.qty_picked })
                        : t('quantityRemaining', { n: selectedLine.qty_required - selectedLine.qty_picked })}
                    </Text>
                    <TextInput
                      style={styles.qtyInput}
                      value={qtyInput}
                      onChangeText={setQtyInput}
                      keyboardType="number-pad"
                      placeholder={t('quantity')}
                      placeholderTextColor="#999"
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
                  </>
                )}
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      <View style={styles.footer}>
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
  onPress,
  t,
  readOnly,
}: {
  line: PickingLine;
  onPress?: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  readOnly?: boolean;
}) {
  const isDone = line.qty_picked >= line.qty_required;
  const content = (
    <>
      <Text style={styles.lineName}>{line.product_name}</Text>
      <Text style={styles.lineMeta}>{t('locationLabel')}: {line.location_code}</Text>
      <Text style={styles.lineMeta}>{t('barcodeLabel')}: {line.barcode ?? '—'}</Text>
      <Text style={styles.lineQty}>
        {line.qty_picked} / {line.qty_required}
      </Text>
      {isDone && (
        <View style={styles.doneBadge}>
          <Text style={styles.doneBadgeText}>{t('doneBadge')}</Text>
        </View>
      )}
    </>
  );
  if (readOnly) {
    return <View style={[styles.lineCard, isDone && styles.lineCardDone]}>{content}</View>;
  }
  return (
    <TouchableOpacity
      style={[styles.lineCard, isDone && styles.lineCardDone]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {content}
    </TouchableOpacity>
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
  lineName: { fontSize: 16, fontWeight: '600', color: '#111' },
  lineMeta: { fontSize: 14, color: '#666', marginTop: 4 },
  lineQty: { fontSize: 14, fontWeight: '600', marginTop: 6 },
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
});
