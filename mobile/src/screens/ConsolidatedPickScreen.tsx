/**
 * Umumiy yig'ish: barcha tayinlangan hujjatlar mahsulot bo'yicha bitta ro'yxatda.
 * Skan: barcode + miqdor → consolidated pick. Oxirida har bir hujjat uchun Controllerga yuborish.
 */
import React, { useCallback, useState } from 'react';
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
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { useNetwork } from '../network';
import type {
  ConsolidatedViewResponse,
  ConsolidatedDocumentSummary,
  ConsolidatedProduct,
} from '../api/picking.types';
import {
  getConsolidatedView,
  consolidatedPick,
  getControllers,
  sendToController,
  completePickDocument,
} from '../api/picking';
import type { ControllerUser } from '../api/picking';
import { ScanInput } from '../components/ScanInput';
import { UNAUTHORIZED_MSG } from '../api/client';
import { playSuccessBeep } from '../utils/playBeep';

type Nav = StackNavigationProp<RootStackParamList, 'ConsolidatedPick'>;

export function ConsolidatedPickScreen() {
  const { t } = useLocale();
  const navigation = useNavigation<Nav>();
  const { isOnline } = useNetwork();
  const [data, setData] = useState<ConsolidatedViewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [qtyInput, setQtyInput] = useState('1');
  const [controllerModalDoc, setControllerModalDoc] = useState<ConsolidatedDocumentSummary | null>(null);
  const [controllers, setControllers] = useState<ControllerUser[]>([]);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!isOnline) {
      setError(t('offlineBanner', { count: 0 }).replace('{{count}}', '0'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getConsolidatedView();
      setData(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('listLoadError');
      setError(msg);
      if (msg === UNAUTHORIZED_MSG) {
        Alert.alert(t('error'), t('authErrorPleaseLogin'), [
          { text: 'OK', onPress: () => navigation.replace('Login') },
        ]);
      }
    } finally {
      setLoading(false);
    }
  }, [isOnline, t, navigation]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleScanSubmit = useCallback(
    async (barcode: string) => {
      const b = barcode.trim();
      if (!b || !data) return;
      const qty = Math.max(1, Math.floor(Number(qtyInput) || 1));
      setSubmitting(true);
      try {
        const requestId = `cons-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const updated = await consolidatedPick(b, qty, requestId);
        setData(updated);
        playSuccessBeep();
      } catch (e) {
        Alert.alert(t('error'), e instanceof Error ? e.message : t('error'));
      } finally {
        setSubmitting(false);
      }
    },
    [data, qtyInput, t]
  );

  const openControllerModal = useCallback(
    async (doc: ConsolidatedDocumentSummary) => {
      setControllerModalDoc(doc);
      if (isOnline) {
        try {
          const c = await getControllers();
          setControllers(c);
        } catch (e) {
          Alert.alert(t('error'), e instanceof Error ? e.message : t('listLoadError'));
          setControllerModalDoc(null);
        }
      } else {
        setControllers([]);
      }
    },
    [isOnline, t]
  );

  const sendToControllerConfirm = useCallback(
    async (controllerId: string) => {
      if (!controllerModalDoc || sending) return;
      setSending(true);
      try {
        if (controllerModalDoc.status !== 'picked') {
          await completePickDocument(controllerModalDoc.id);
        }
        await sendToController(controllerModalDoc.id, controllerId);
        setControllerModalDoc(null);
        await load();
      } catch (e) {
        Alert.alert(t('error'), e instanceof Error ? e.message : t('error'));
      } finally {
        setSending(false);
      }
    },
    [controllerModalDoc, load, sending, t]
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1976d2" />
        <Text style={styles.loadingText}>{t('loading')}</Text>
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryBtnText}>{t('retry')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={12}>
          <Icon name="arrow-left" size={24} color="#1976d2" />
        </TouchableOpacity>
      </View>
    );
  }

  const documents = data?.documents ?? [];
  const products = data?.products ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Icon name="arrow-left" size={24} color="#1976d2" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>{t('consolidatedPickTitle')}</Text>
          <Text style={styles.count}>
            {t('consolidatedMyTasks')} — {t('consolidatedDocsCount', { count: documents.length })}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Scan */}
        <View style={styles.scanSection}>
          <Text style={styles.sectionTitle}>{t('consolidatedScanHint')}</Text>
          <View style={styles.scanRow}>
            <View style={styles.scanInputWrap}>
              <ScanInput
                onSubmit={(v) => handleScanSubmit(v)}
                placeholder={t('barcodeSkuShort') || 'Barcode / SKU'}
                label={t('barcodeSkuLabel') || 'Shtrixkod'}
                submitText={t('submit')}
                disabled={submitting || !isOnline}
              />
            </View>
            <View style={styles.qtyWrap}>
              <Text style={styles.qtyLabel}>{t('consolidatedQuantity')}</Text>
              <TextInput
                style={styles.qtyInput}
                value={qtyInput}
                onChangeText={setQtyInput}
                keyboardType="number-pad"
                placeholder="1"
                placeholderTextColor="#999"
                maxLength={5}
                editable={!submitting}
              />
            </View>
          </View>
        </View>

        {/* Products */}
        <Text style={styles.sectionTitle}>{t('positions')}</Text>
        {products.length === 0 && (
          <Text style={styles.emptyText}>{t('openTasksEmpty')}</Text>
        )}
        {products.map((prod) => (
          <ProductRow key={`${prod.product_name}-${prod.barcode ?? prod.sku ?? ''}`} product={prod} t={t} />
        ))}

        {/* Documents + Controllerga yuborish */}
        <Text style={[styles.sectionTitle, styles.docSectionTitle]}>{t('consolidatedMyTasks')}</Text>
        {documents.map((doc) => {
          const isFullyPicked = doc.lines_done >= doc.lines_total && doc.lines_total > 0;
          const canSend = isFullyPicked; // Complete then send if not yet "picked"
          return (
            <View key={doc.id} style={styles.docRow}>
              <View style={styles.docInfo}>
                <Text style={styles.docRef}>{doc.reference_number}</Text>
                <Text style={styles.docMeta}>{t('linesCount', { done: doc.lines_done, total: doc.lines_total })}</Text>
              </View>
              <TouchableOpacity
                style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
                onPress={() => canSend && openControllerModal(doc)}
                disabled={!canSend}
                activeOpacity={0.8}
              >
                <Text style={styles.sendBtnText}>{t('sendToController')}</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      {/* Controller selection modal */}
      <Modal
        visible={!!controllerModalDoc}
        transparent
        animationType="slide"
        onRequestClose={() => setControllerModalDoc(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setControllerModalDoc(null)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>{t('selectController')}</Text>
            {controllers.length === 0 && (
              <Text style={styles.modalEmpty}>{t('openTasksEmpty')}</Text>
            )}
            {controllers.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={styles.controllerRow}
                onPress={() => sendToControllerConfirm(c.id)}
                disabled={sending}
              >
                <Text style={styles.controllerName}>{c.full_name || c.username}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setControllerModalDoc(null)}>
              <Text style={styles.modalCancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function ProductRow({
  product,
  t,
}: {
  product: ConsolidatedProduct;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const byOrder = product.lines
    .map((l) => `${l.reference_number}: ${Math.round(l.qty_required)} ${t('countTa')}`)
    .join(', ');
  return (
    <View style={styles.productCard}>
      <Text style={styles.productName} numberOfLines={2}>
        {product.product_name}
      </Text>
      <Text style={styles.productTotals}>
        {t('picked')}: {Math.round(product.total_picked)} / {Math.round(product.total_required)}
      </Text>
      {product.lines.length > 0 && (
        <Text style={styles.productByOrder} numberOfLines={2}>
          {t('consolidatedProductByOrder')}: {byOrder}
        </Text>
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
  backBtn: { padding: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerCenter: { flex: 1, marginLeft: 12 },
  title: { fontSize: 18, fontWeight: '700', color: '#111' },
  count: { fontSize: 13, color: '#666', marginTop: 2 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 10 },
  scanSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  scanRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  scanInputWrap: { flex: 1, minWidth: 0 },
  qtyWrap: { width: 80 },
  qtyLabel: { fontSize: 12, color: '#666', marginBottom: 4 },
  qtyInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 16,
    color: '#111',
  },
  emptyText: { fontSize: 14, color: '#666', marginBottom: 12 },
  productCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  productName: { fontSize: 15, fontWeight: '600', color: '#111', marginBottom: 4 },
  productTotals: { fontSize: 14, color: '#333', marginBottom: 4 },
  productByOrder: { fontSize: 12, color: '#666' },
  docSectionTitle: { marginTop: 8 },
  docRow: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  docInfo: { marginBottom: 8 },
  docRef: { fontSize: 16, fontWeight: '600', color: '#111' },
  docMeta: { fontSize: 14, color: '#666' },
  sendBtn: {
    backgroundColor: '#2e7d32',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#9e9e9e', opacity: 0.8 },
  sendBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    maxHeight: '70%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 16 },
  modalEmpty: { fontSize: 14, color: '#666', marginBottom: 12 },
  controllerRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  controllerName: { fontSize: 16, color: '#111' },
  modalCancel: { marginTop: 16, paddingVertical: 12, alignItems: 'center' },
  modalCancelText: { fontSize: 16, color: '#1976d2', fontWeight: '600' },
});
