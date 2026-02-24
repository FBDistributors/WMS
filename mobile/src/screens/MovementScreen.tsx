/**
 * Movement — lokatsiya bo‘yicha ko‘chirish.
 * Skaner → mahsulot lokatsiyalari (qayerda) → qayerga → miqdor → tasdiq (2 ta adjust).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { useNetwork } from '../network';
import { getPickerProductDetail, listPickerLocations } from '../api/inventory';
import type { PickerProductDetailResponse, PickerProductLocation, PickerLocationOption } from '../api/inventory';
import { createStockMovement } from '../api/movements';
import { AppHeader } from '../components/AppHeader';
import { BarcodeSearchInput } from '../components/BarcodeSearchInput';

type Nav = StackNavigationProp<RootStackParamList, 'Movement'>;
type MovementRoute = RouteProp<RootStackParamList, 'Movement'>;

export function MovementScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<MovementRoute>();
  const { t } = useLocale();
  const { isOnline } = useNetwork();
  const params = route.params ?? {};

  const [product, setProduct] = useState<PickerProductDetailResponse | null>(null);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [allLocations, setAllLocations] = useState<PickerLocationOption[]>([]);
  const [fromLocation, setFromLocation] = useState<PickerProductLocation | null>(null);
  const [toLocation, setToLocation] = useState<PickerLocationOption | null>(null);
  const [qty, setQty] = useState('');
  const [locationSearch, setLocationSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [barcodeSearchValue, setBarcodeSearchValue] = useState('');

  const loadProduct = useCallback(async (productId: string) => {
    setLoadingProduct(true);
    setProductError(null);
    setProduct(null);
    setFromLocation(null);
    setToLocation(null);
    setQty('');
    try {
      const res = await getPickerProductDetail(productId);
      setProduct(res);
    } catch (e) {
      setProductError(e instanceof Error ? e.message : t('invLoadError'));
    } finally {
      setLoadingProduct(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      const pid = params?.scannedProductId;
      if (pid) {
        loadProduct(pid);
        navigation.setParams({ scannedProductId: undefined, scannedBarcode: undefined } as any);
      }
    }, [params?.scannedProductId, loadProduct, navigation])
  );

  useEffect(() => {
    if (isOnline) {
      listPickerLocations().then(setAllLocations).catch(() => setAllLocations([]));
    }
  }, [isOnline]);

  const handleScan = useCallback(() => {
    navigation.navigate('Scanner', { returnToMovement: true });
  }, [navigation]);

  const maxQty = fromLocation ? Number(fromLocation.available_qty) || 0 : 0;
  const qtyNum = Math.floor(Number(qty) || 0);
  const canSubmit =
    product &&
    fromLocation &&
    toLocation &&
    toLocation.id !== fromLocation.location_id &&
    qtyNum >= 1 &&
    qtyNum <= maxQty;

  const filteredToLocations = (() => {
    const s = locationSearch.trim().toLowerCase();
    if (!s) return allLocations.slice(0, 50);
    return allLocations.filter(
      (l) =>
        (l.code && l.code.toLowerCase().includes(s)) ||
        (l.name != null && String(l.name).toLowerCase().includes(s))
    ).slice(0, 30);
  })();

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !product || !fromLocation || !toLocation) return;
    const num = qtyNum;
    setSubmitting(true);
    try {
      await createStockMovement({
        product_id: product.product_id,
        lot_id: fromLocation.lot_id,
        location_id: fromLocation.location_id,
        qty_change: -num,
        movement_type: 'adjust',
        reason_code: 'inventory_shortage',
      });
      await createStockMovement({
        product_id: product.product_id,
        lot_id: fromLocation.lot_id,
        location_id: toLocation.id,
        qty_change: num,
        movement_type: 'adjust',
        reason_code: 'inventory_overage',
      });
      setProduct(null);
      setFromLocation(null);
      setToLocation(null);
      setQty('');
      Alert.alert(t('success'), t('movementDone'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('movementError');
      Alert.alert(t('error'), msg);
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, product, fromLocation, toLocation, qtyNum, t]);

  if (loadingProduct) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <AppHeader title={t('movementTitle')} showBack onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#1a237e" />
          <Text style={styles.loadingText}>{t('loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader
        title={t('movementTitle')}
        showBack
        onBack={() => navigation.goBack()}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {!product ? (
          <>
            <Text style={styles.manualEntryLabel}>{t('kirimManualEntry')}</Text>
            <BarcodeSearchInput
              value={barcodeSearchValue}
              onChangeText={setBarcodeSearchValue}
              onSelectProduct={(productId) => loadProduct(productId)}
              placeholder={t('kirimBarcodePlaceholder')}
              emptyLabel={t('barcodeSearchNoResults')}
              loading={loadingProduct}
              error={productError}
              onClearError={() => setProductError(null)}
              dropdownMaxHeight={200}
            />
            <Text style={styles.hint}>{t('movementScanHint')}</Text>
            <TouchableOpacity style={styles.scanBtn} onPress={handleScan} activeOpacity={0.8}>
              <Icon name="barcode-scan" size={32} color="#fff" />
              <Text style={styles.scanBtnText}>{t('movementScan')}</Text>
            </TouchableOpacity>
            {productError ? (
              <Text style={styles.errorText}>{productError}</Text>
            ) : null}
          </>
        ) : (
          <>
            <View style={styles.productCard}>
              <Text style={styles.productName}>{product.name}</Text>
              <Text style={styles.productCode}>{product.code}</Text>
            </View>

            <Text style={styles.sectionLabel}>{t('movementFrom')}</Text>
            {product.locations.length === 0 ? (
              <Text style={styles.muted}>{t('movementNoLocations')}</Text>
            ) : (
              product.locations.map((loc) => {
                const selected = fromLocation?.location_id === loc.location_id && fromLocation?.lot_id === loc.lot_id;
                return (
                  <TouchableOpacity
                    key={`${loc.location_id}-${loc.lot_id}`}
                    style={[styles.locationRow, selected && styles.locationRowSelected]}
                    onPress={() => {
                      setFromLocation(loc);
                      setToLocation(null);
                      setQty('');
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.locCode}>{loc.location_code}</Text>
                    <Text style={styles.locBatch}>{loc.batch_no}</Text>
                    <Text style={styles.locQty}>{Math.round(Number(loc.available_qty))} dono</Text>
                  </TouchableOpacity>
                );
              })
            )}

            {fromLocation && (
              <>
                <Text style={styles.sectionLabel}>{t('movementTo')}</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder={t('movementToSearch')}
                  placeholderTextColor="#999"
                  value={toLocation ? toLocation.code : locationSearch}
                  onChangeText={(text) => {
                    setLocationSearch(text);
                    setToLocation(null);
                  }}
                />
                {!toLocation && (
                  <>
                    <View style={styles.toList}>
                      {filteredToLocations
                        .filter((l) => l.id !== fromLocation.location_id)
                        .map((loc) => (
                          <TouchableOpacity
                            key={loc.id}
                            style={styles.locationRow}
                            onPress={() => {
                              setToLocation(loc);
                              setLocationSearch(loc.code);
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.locCode}>{loc.code}</Text>
                            {loc.name ? <Text style={styles.locBatch}>{loc.name}</Text> : null}
                          </TouchableOpacity>
                        ))}
                    </View>
                    {filteredToLocations.filter((l) => l.id !== fromLocation.location_id).length === 0 && locationSearch.trim().length > 0 && (
                      <Text style={styles.muted}>{t('kirimLocationNoResults')}</Text>
                    )}
                  </>
                )}

                <Text style={styles.sectionLabel}>{t('movementQty')}</Text>
                <TextInput
                  style={styles.qtyInput}
                  placeholder={`1–${maxQty}`}
                  placeholderTextColor="#999"
                  value={qty}
                  onChangeText={setQty}
                  keyboardType="number-pad"
                />
                <Text style={styles.muted}>{t('movementQtyMax', { max: maxQty })}</Text>

                <TouchableOpacity
                  style={[styles.submitBtn, (!canSubmit || submitting) && styles.submitBtnDisabled]}
                  onPress={handleSubmit}
                  disabled={!canSubmit || submitting}
                  activeOpacity={0.8}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.submitBtnText}>{t('movementConfirm')}</Text>
                  )}
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity style={styles.changeProductBtn} onPress={() => setProduct(null)}>
              <Text style={styles.changeProductBtnText}>{t('movementChangeProduct')}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16, color: '#666' },
  hint: { fontSize: 15, color: '#666', marginBottom: 16, textAlign: 'center' },
  scanBtn: {
    backgroundColor: '#1a237e',
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  scanBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  manualEntryLabel: { fontSize: 13, color: '#666', marginTop: 16, marginBottom: 6 },
  errorText: { color: '#c62828', marginTop: 12, textAlign: 'center' },
  productCard: {
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  productName: { fontSize: 17, fontWeight: '600', color: '#333' },
  productCode: { fontSize: 14, color: '#666', marginTop: 4 },
  sectionLabel: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8 },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  locationRowSelected: { borderColor: '#1a237e', backgroundColor: '#e8eaf6' },
  locCode: { fontSize: 16, fontWeight: '600', color: '#333', flex: 1 },
  locBatch: { fontSize: 14, color: '#666', marginRight: 8 },
  locQty: { fontSize: 14, color: '#333' },
  searchInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  toList: { marginBottom: 16 },
  qtyInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 14,
    fontSize: 18,
    marginBottom: 4,
    backgroundColor: '#fff',
  },
  muted: { fontSize: 13, color: '#777', marginBottom: 16 },
  submitBtn: {
    backgroundColor: '#1a237e',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  submitBtnDisabled: { backgroundColor: '#9fa8da', opacity: 0.8 },
  submitBtnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  changeProductBtn: { alignItems: 'center', paddingVertical: 12 },
  changeProductBtnText: { fontSize: 15, color: '#1a237e' },
});
