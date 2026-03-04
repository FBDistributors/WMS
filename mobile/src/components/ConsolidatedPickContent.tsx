/**
 * Umumiy yig'ish kontenti: mahsulotlar ro'yxati, skan, hujjatlar, controllerga yuborish.
 * Mahsulot qatoriga bosilganda detail sahifasiga o'xshash modal (skan, barcode, miqdor, tasdiqlash).
 */
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
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { useNetwork } from '../network';
import type { ConsolidatedViewResponse, ConsolidatedProduct } from '../api/picking.types';
import { getConsolidatedView, consolidatedPick } from '../api/picking';
import { ScanInput } from '../components/ScanInput';
import { UNAUTHORIZED_MSG } from '../api/client';
import { playSuccessBeep } from '../utils/playBeep';

type Nav = StackNavigationProp<RootStackParamList, 'ConsolidatedPick'>;

export function consolidatedProductKey(prod: { product_name: string; barcode?: string | null; sku?: string | null }): string {
  return `${prod.product_name}-${prod.barcode ?? prod.sku ?? ''}`;
}

export interface ConsolidatedPickContentProps {
  onBack?: () => void;
  onAuthError?: () => void;
  pendingScannedBarcode?: string | null;
  onClearPendingBarcode?: () => void;
  /** When embedded, parent tracks selected product key so we can restore modal after Scanner return. */
  selectedProductKey?: string | null;
  onProductSelect?: (key: string | null) => void;
  /** When true, we are embedded in PickTaskList (for Scanner return target). */
  embeddedInPickTaskList?: boolean;
}

export function ConsolidatedPickContent({
  onBack,
  onAuthError,
  pendingScannedBarcode,
  onClearPendingBarcode,
  selectedProductKey,
  onProductSelect,
  embeddedInPickTaskList,
}: ConsolidatedPickContentProps) {
  const { t } = useLocale();
  const navigation = useNavigation<Nav>();
  const { isOnline } = useNetwork();
  const [data, setData] = useState<ConsolidatedViewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Product tap modal (like PickTaskDetails line modal)
  const [selectedProduct, setSelectedProduct] = useState<ConsolidatedProduct | null>(null);
  const [scannedBarcodeForQty, setScannedBarcodeForQty] = useState<string | null>(null);
  const [productQtyInput, setProductQtyInput] = useState('1');

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
      if (msg === UNAUTHORIZED_MSG && (onAuthError || navigation.replace)) {
        if (onAuthError) onAuthError();
        else navigation.replace('Login');
      }
    } finally {
      setLoading(false);
    }
  }, [isOnline, t, onAuthError, navigation]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // When returning from Scanner: restore selected product and apply pending barcode in one effect
  useEffect(() => {
    if (!data?.products) return;
    if (selectedProductKey && onProductSelect) {
      const prod = data.products.find((p) => consolidatedProductKey(p) === selectedProductKey);
      if (prod) {
        setSelectedProduct(prod);
        onProductSelect(null);
        if (pendingScannedBarcode && onClearPendingBarcode) {
          setScannedBarcodeForQty(pendingScannedBarcode);
          const remaining = Math.max(1, Math.round(prod.total_required - prod.total_picked));
          setProductQtyInput(String(remaining));
          onClearPendingBarcode();
        }
      }
    } else if (pendingScannedBarcode && selectedProduct && onClearPendingBarcode) {
      setScannedBarcodeForQty(pendingScannedBarcode);
      const remaining = Math.max(1, Math.round(selectedProduct.total_required - selectedProduct.total_picked));
      setProductQtyInput(String(remaining));
      onClearPendingBarcode();
    }
  }, [
    selectedProductKey,
    data?.products,
    onProductSelect,
    pendingScannedBarcode,
    selectedProduct,
    onClearPendingBarcode,
  ]);

  const closeProductModal = useCallback(() => {
    setSelectedProduct(null);
    setScannedBarcodeForQty(null);
    setProductQtyInput('1');
    onProductSelect?.(null);
  }, [onProductSelect]);

  /** Skanerga o'tishdan oldin modaldni yopish (orqa fonda qolmasin); selectedProductKey saqlanadi, qaytishda modal qayta ochiladi. */
  const hideModalForScanner = useCallback(() => {
    setSelectedProduct(null);
    setScannedBarcodeForQty(null);
    setProductQtyInput('1');
  }, []);

  const handleProductBarcodeSubmit = useCallback(
    (barcode: string) => {
      const b = barcode.trim();
      if (!b) return;
      setScannedBarcodeForQty(b);
      if (!selectedProduct) return;
      const remaining = Math.max(1, Math.round(selectedProduct.total_required - selectedProduct.total_picked));
      setProductQtyInput(String(remaining));
    },
    [selectedProduct]
  );

  const handleProductQtyConfirm = useCallback(async () => {
    if (!selectedProduct || !scannedBarcodeForQty) return;
    const qty = Math.max(1, Math.floor(Number(productQtyInput) || 1));
    setSubmitting(true);
    try {
      const requestId = `cons-product-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const updated = await consolidatedPick(scannedBarcodeForQty.trim(), qty, requestId);
      setData(updated);
      playSuccessBeep();
      closeProductModal();
    } catch (e) {
      Alert.alert(t('error'), e instanceof Error ? e.message : t('error'));
    } finally {
      setSubmitting(false);
    }
  }, [selectedProduct, scannedBarcodeForQty, productQtyInput, t, closeProductModal]);

  const goToScannerForProduct = useCallback(() => {
    if (!selectedProduct) return;
    hideModalForScanner();
    const nav = navigation.getParent?.() || navigation;
    nav.navigate('Scanner', {
      returnToConsolidated: true,
      profileType: 'picker',
    } as any);
  }, [selectedProduct, navigation, hideModalForScanner]);

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
        {onBack && (
          <TouchableOpacity style={styles.backBtn} onPress={onBack} hitSlop={12}>
            <Icon name="arrow-left" size={24} color="#1976d2" />
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const products = data?.products ?? [];

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionTitle}>{t('positions')}</Text>
        {products.length === 0 && <Text style={styles.emptyText}>{t('openTasksEmpty')}</Text>}
        {products.map((prod) => (
          <ProductRow
            key={consolidatedProductKey(prod)}
            product={prod}
            t={t}
            onPress={() => {
              setSelectedProduct(prod);
              onProductSelect?.(consolidatedProductKey(prod));
            }}
          />
        ))}
      </ScrollView>

      {/* Product tap modal — like PickTaskDetails line modal */}
      <Modal
        visible={!!selectedProduct}
        transparent
        animationType="slide"
        onRequestClose={closeProductModal}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeProductModal}>
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            {selectedProduct && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle} numberOfLines={2}>
                    {t('modalPickTitle')}: {selectedProduct.product_name}
                  </Text>
                  <TouchableOpacity onPress={closeProductModal} hitSlop={12}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>
                {!scannedBarcodeForQty ? (
                  <>
                    <Text style={styles.modalHint}>{t('modalScanHint')}</Text>
                    <TouchableOpacity style={styles.scanBtnModal} onPress={goToScannerForProduct} activeOpacity={0.8}>
                      <Icon name="barcode-scan" size={28} color="#fff" />
                      <Text style={styles.scanBtnModalText}>{t('scanButton')}</Text>
                    </TouchableOpacity>
                    <Text style={styles.modalOr}>{t('orEnterManually')}</Text>
                    <ScanInput
                      onSubmit={handleProductBarcodeSubmit}
                      placeholder={selectedProduct.barcode || selectedProduct.sku || t('barcodeSkuShort') || ''}
                      label={t('barcodeSkuLabel')}
                      submitText={t('submit')}
                      disabled={submitting}
                    />
                  </>
                ) : (
                  <>
                    <Text style={styles.modalHint}>
                      {t('quantityRemaining', {
                        n: Math.round(selectedProduct.total_required - selectedProduct.total_picked),
                      })}
                    </Text>
                    <Text style={styles.modalQtyLabel}>{t('quantity')}</Text>
                    <TextInput
                      style={styles.modalQtyInput}
                      value={productQtyInput}
                      onChangeText={setProductQtyInput}
                      keyboardType="number-pad"
                      placeholder={t('quantity')}
                      placeholderTextColor="#999"
                      maxLength={4}
                    />
                    <TouchableOpacity
                      style={[styles.modalSubmitBtn, submitting && styles.modalSubmitDisabled]}
                      onPress={handleProductQtyConfirm}
                      disabled={submitting}
                    >
                      <Text style={styles.modalSubmitText}>{submitting ? '…' : t('confirmButton')}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function ProductRow({
  product,
  t,
  onPress,
}: {
  product: ConsolidatedProduct;
  t: (key: string, params?: Record<string, string | number>) => string;
  onPress: () => void;
}) {
  const byOrder = product.lines
    .map((l) => `${l.reference_number}: ${Math.round(l.qty_required)} ${t('countTa')}`)
    .join(', ');
  const isDone = product.total_picked >= product.total_required;
  const barcodeOrSku = product.barcode || product.sku || null;
  const locations = product.lines.length > 0
    ? [...new Set(product.lines.map((l) => l.location_code).filter(Boolean))].join(', ')
    : '';
  const cardStyle = [
    styles.productCard,
    isDone ? styles.productCardDone : styles.productCardIncomplete,
  ];
  return (
    <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.productName} numberOfLines={2}>
        {product.product_name}
      </Text>
      {barcodeOrSku ? (
        <Text style={styles.productBarcodeLocation}>
          {t('barcodeSkuShort')}: {barcodeOrSku}
        </Text>
      ) : null}
      {locations ? (
        <Text style={styles.productBarcodeLocation}>
          {t('locationLabel')}: {locations}
        </Text>
      ) : null}
      <Text style={styles.productTotals}>
        {t('picked')}: {Math.round(product.total_picked)} / {Math.round(product.total_required)}
      </Text>
      {product.lines.length > 0 && (
        <Text style={styles.productByOrder} numberOfLines={2}>
          {t('consolidatedProductByOrder')}: {byOrder}
        </Text>
      )}
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
  backBtn: { padding: 8 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 10 },
  emptyText: { fontSize: 14, color: '#666', marginBottom: 12 },
  productCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  productCardDone: { backgroundColor: '#e8f5e9', borderColor: '#c8e6c9' },
  productCardIncomplete: { backgroundColor: '#ffebee', borderColor: '#ffcdd2' },
  productName: { fontSize: 15, fontWeight: '600', color: '#111', marginBottom: 4 },
  productBarcodeLocation: { fontSize: 13, color: '#555', marginBottom: 2 },
  productTotals: { fontSize: 14, color: '#333', marginBottom: 4 },
  productByOrder: { fontSize: 12, color: '#666' },
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
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111', flex: 1 },
  modalClose: { fontSize: 22, color: '#666', padding: 4 },
  modalHint: { fontSize: 14, color: '#666', marginBottom: 12 },
  modalQtyLabel: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
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
  scanBtnModalText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalOr: { fontSize: 13, color: '#888', marginBottom: 8, textAlign: 'center' },
  modalQtyInput: {
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
