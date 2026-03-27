/**
 * Movement — ko'chirish: (1) skaner orqali mahsulot, (2) to'liq palet / lokatsiya.
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
import {
  formatPickerLocationOptionLine,
  getPickerProductDetail,
  getLocationContents,
  listPickerLocations,
} from '../api/inventory';
import type {
  PickerProductDetailResponse,
  PickerProductLocation,
  PickerLocationOption,
  LocationContentsResponse,
} from '../api/inventory';
import { createStockMovement, transferLocationStock } from '../api/movements';
import { useTheme } from '../theme/ThemeContext';
import { AppHeader } from '../components/AppHeader';
import { BarcodeSearchInput } from '../components/BarcodeSearchInput';

type Nav = StackNavigationProp<RootStackParamList, 'Movement'>;
type MovementRoute = RouteProp<RootStackParamList, 'Movement'>;

type MovementPhase = 'choose' | 'scan_product' | 'pallet';

export function MovementScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<MovementRoute>();
  const { t } = useLocale();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { isOnline } = useNetwork();
  const params = route.params ?? {};

  const [phase, setPhase] = useState<MovementPhase>('choose');

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

  const [palletContents, setPalletContents] = useState<LocationContentsResponse | null>(null);
  const [palletLoading, setPalletLoading] = useState(false);
  const [palletError, setPalletError] = useState<string | null>(null);
  const [palletCodeInput, setPalletCodeInput] = useState('');
  const [palletToLocation, setPalletToLocation] = useState<PickerLocationOption | null>(null);
  const [palletDestSearch, setPalletDestSearch] = useState('');
  const [palletSubmitting, setPalletSubmitting] = useState(false);

  const resetPalletFlow = useCallback(() => {
    setPalletContents(null);
    setPalletError(null);
    setPalletCodeInput('');
    setPalletToLocation(null);
    setPalletDestSearch('');
  }, []);

  const loadProduct = useCallback(
    async (productId: string) => {
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
    },
    [t]
  );

  const loadPalletContents = useCallback(
    async (code: string) => {
      const c = code.trim();
      if (!c) return;
      setPalletLoading(true);
      setPalletError(null);
      setPalletContents(null);
      setPalletToLocation(null);
      setPalletDestSearch('');
      try {
        const res = await getLocationContents(c);
        setPalletContents(res);
        setPalletCodeInput(res.location_code);
      } catch (e) {
        setPalletError(e instanceof Error ? e.message : t('movementPalletLoadError'));
      } finally {
        setPalletLoading(false);
      }
    },
    [t]
  );

  useFocusEffect(
    useCallback(() => {
      const pid = params?.scannedProductId;
      const locCode = params?.scannedLocationCode;
      if (pid) {
        setPhase('scan_product');
        loadProduct(pid);
        navigation.setParams({ scannedProductId: undefined, scannedBarcode: undefined } as any);
      } else if (locCode) {
        setPhase('pallet');
        loadPalletContents(locCode);
        navigation.setParams({ scannedLocationCode: undefined } as any);
      }
    }, [params?.scannedProductId, params?.scannedLocationCode, loadProduct, loadPalletContents, navigation])
  );

  useEffect(() => {
    if (isOnline) {
      listPickerLocations().then(setAllLocations).catch(() => setAllLocations([]));
    }
  }, [isOnline]);

  const handleHeaderBack = useCallback(() => {
    if (phase === 'choose') {
      navigation.goBack();
      return;
    }
    if (phase === 'scan_product') {
      setPhase('choose');
      setProduct(null);
      setFromLocation(null);
      setToLocation(null);
      setQty('');
      setLocationSearch('');
      setBarcodeSearchValue('');
      setProductError(null);
      return;
    }
    setPhase('choose');
    resetPalletFlow();
  }, [phase, navigation, resetPalletFlow]);

  const handleScanProduct = useCallback(() => {
    (navigation as any).replace('Scanner', { returnToMovement: true });
  }, [navigation]);

  const handleScanPallet = useCallback(() => {
    (navigation as any).replace('Scanner', { returnToMovementPallet: true });
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
    return allLocations
      .filter(
        (l) =>
          (l.code && l.code.toLowerCase().includes(s)) ||
          (l.name != null && String(l.name).toLowerCase().includes(s))
      )
      .slice(0, 30);
  })();

  const filteredPalletDest = (() => {
    const s = palletDestSearch.trim().toLowerCase();
    if (!s) return allLocations.slice(0, 50);
    return allLocations
      .filter(
        (l) =>
          (l.code && l.code.toLowerCase().includes(s)) ||
          (l.name != null && String(l.name).toLowerCase().includes(s))
      )
      .slice(0, 30);
  })();

  const filteredPalletSourceList = (() => {
    const s = palletCodeInput.trim().toLowerCase();
    if (!s) return allLocations.slice(0, 40);
    return allLocations
      .filter(
        (l) =>
          (l.code && l.code.toLowerCase().includes(s)) ||
          (l.name != null && String(l.name).toLowerCase().includes(s))
      )
      .slice(0, 30);
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

  const canSubmitPallet =
    palletContents &&
    palletContents.items.length > 0 &&
    palletToLocation &&
    palletToLocation.id !== palletContents.location_id;

  const handleSubmitPallet = useCallback(async () => {
    if (!canSubmitPallet || !palletContents || !palletToLocation) return;
    setPalletSubmitting(true);
    try {
      await transferLocationStock({
        from_location_id: palletContents.location_id,
        to_location_id: palletToLocation.id,
      });
      resetPalletFlow();
      setPhase('choose');
      Alert.alert(t('success'), t('movementPalletDone'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('movementError');
      Alert.alert(t('error'), msg);
    } finally {
      setPalletSubmitting(false);
    }
  }, [canSubmitPallet, palletContents, palletToLocation, resetPalletFlow, t]);

  if (loadingProduct && phase === 'scan_product') {
    return (
      <SafeAreaView style={[styles.container, isDark && styles.containerDark]} edges={['top']}>
        <AppHeader title={t('movementTitle')} showBack onBack={handleHeaderBack} />
        <View style={[styles.centered, isDark && styles.centeredDark]}>
          <ActivityIndicator size="large" color={isDark ? '#93c5fd' : '#1a237e'} />
          <Text style={[styles.loadingText, isDark && styles.loadingTextDark]}>{t('loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]} edges={['top']}>
      <AppHeader title={t('movementTitle')} showBack onBack={handleHeaderBack} />
      <ScrollView
        style={[styles.scroll, isDark && styles.scrollDark]}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {!isOnline ? (
          <Text style={[styles.offlineHint, isDark && styles.mutedDark]}>{t('movementOfflineHint')}</Text>
        ) : null}

        {phase === 'choose' ? (
          <>
            <Text style={[styles.chooseIntro, isDark && styles.sectionLabelDark]}>{t('movementChooseIntro')}</Text>
            <TouchableOpacity
              style={[styles.modeCard, isDark && styles.modeCardDark]}
              onPress={() => {
                setProduct(null);
                setPhase('scan_product');
              }}
              activeOpacity={0.85}
            >
              <Icon name="barcode-scan" size={36} color={isDark ? '#93c5fd' : '#1a237e'} />
              <View style={styles.modeCardTextWrap}>
                <Text style={[styles.modeCardTitle, isDark && styles.modeCardTitleDark]}>
                  {t('movementModeScanTitle')}
                </Text>
                <Text style={[styles.modeCardDesc, isDark && styles.modeCardDescDark]}>
                  {t('movementModeScanDesc')}
                </Text>
              </View>
              <Icon name="chevron-right" size={28} color={isDark ? '#64748b' : '#999'} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeCard, isDark && styles.modeCardDark]}
              onPress={() => {
                resetPalletFlow();
                setPhase('pallet');
              }}
              activeOpacity={0.85}
            >
              <Icon name="view-grid-outline" size={36} color={isDark ? '#93c5fd' : '#1a237e'} />
              <View style={styles.modeCardTextWrap}>
                <Text style={[styles.modeCardTitle, isDark && styles.modeCardTitleDark]}>
                  {t('movementModePalletTitle')}
                </Text>
                <Text style={[styles.modeCardDesc, isDark && styles.modeCardDescDark]}>
                  {t('movementModePalletDesc')}
                </Text>
              </View>
              <Icon name="chevron-right" size={28} color={isDark ? '#64748b' : '#999'} />
            </TouchableOpacity>
          </>
        ) : null}

        {phase === 'scan_product' ? (
          <>
            {!product ? (
              <>
                <Text style={[styles.manualEntryLabel, isDark && styles.manualEntryLabelDark]}>
                  {t('kirimManualEntry')}
                </Text>
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
                <Text style={[styles.hint, isDark && styles.hintDark]}>{t('movementScanHint')}</Text>
                <TouchableOpacity style={styles.scanBtn} onPress={handleScanProduct} activeOpacity={0.8}>
                  <Icon name="barcode-scan" size={32} color="#fff" />
                  <Text style={styles.scanBtnText}>{t('movementScan')}</Text>
                </TouchableOpacity>
                {productError ? (
                  <Text style={[styles.errorText, isDark && styles.errorTextDark]}>{productError}</Text>
                ) : null}
              </>
            ) : (
              <>
                <View style={[styles.productCard, isDark && styles.productCardDark]}>
                  <Text style={[styles.productName, isDark && styles.productNameDark]}>{product.name}</Text>
                  <Text style={[styles.productCode, isDark && styles.productCodeDark]}>{product.code}</Text>
                </View>

                <Text style={[styles.sectionLabel, isDark && styles.sectionLabelDark]}>{t('movementFrom')}</Text>
                {product.locations.length === 0 ? (
                  <Text style={[styles.muted, isDark && styles.mutedDark]}>{t('movementNoLocations')}</Text>
                ) : (
                  product.locations.map((loc) => {
                    const selected =
                      fromLocation?.location_id === loc.location_id && fromLocation?.lot_id === loc.lot_id;
                    return (
                      <TouchableOpacity
                        key={`${loc.location_id}-${loc.lot_id}`}
                        style={[
                          styles.locationRow,
                          selected && styles.locationRowSelected,
                          isDark && styles.locationRowDark,
                          selected && isDark && styles.locationRowSelectedDark,
                        ]}
                        onPress={() => {
                          setFromLocation(loc);
                          setToLocation(null);
                          setQty('');
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.locCode, isDark && styles.locCodeDark]}>{loc.location_code}</Text>
                        <Text style={[styles.locBatch, isDark && styles.locBatchDark]}>{loc.batch_no}</Text>
                        <Text style={[styles.locQty, isDark && styles.locQtyDark]}>
                          {Math.round(Number(loc.available_qty))} dono
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                )}

                {fromLocation && (
                  <>
                    <Text style={[styles.sectionLabel, isDark && styles.sectionLabelDark]}>{t('movementTo')}</Text>
                    <TextInput
                      style={[styles.searchInput, isDark && styles.searchInputDark]}
                      placeholder={t('movementToSearch')}
                      placeholderTextColor={isDark ? '#64748b' : '#999'}
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
                                style={[styles.locationRow, isDark && styles.locationRowDark]}
                                onPress={() => {
                                  setToLocation(loc);
                                  setLocationSearch(loc.code);
                                }}
                                activeOpacity={0.7}
                              >
                                <Text style={[styles.locCode, isDark && styles.locCodeDark]} numberOfLines={2}>
                                  {formatPickerLocationOptionLine(loc)}
                                </Text>
                                {loc.name ? (
                                  <Text style={[styles.locBatch, isDark && styles.locBatchDark]}>{loc.name}</Text>
                                ) : null}
                              </TouchableOpacity>
                            ))}
                        </View>
                        {filteredToLocations.filter((l) => l.id !== fromLocation.location_id).length === 0 &&
                          locationSearch.trim().length > 0 && (
                            <Text style={[styles.muted, isDark && styles.mutedDark]}>{t('kirimLocationNoResults')}</Text>
                          )}
                      </>
                    )}

                    <Text style={[styles.sectionLabel, isDark && styles.sectionLabelDark]}>{t('movementQty')}</Text>
                    <TextInput
                      style={[styles.qtyInput, isDark && styles.qtyInputDark]}
                      placeholder={`1–${maxQty}`}
                      placeholderTextColor={isDark ? '#64748b' : '#999'}
                      value={qty}
                      onChangeText={setQty}
                      keyboardType="number-pad"
                    />
                    <Text style={[styles.muted, isDark && styles.mutedDark]}>{t('movementQtyMax', { max: maxQty })}</Text>

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
                  <Text style={[styles.changeProductBtnText, isDark && styles.changeProductBtnTextDark]}>
                    {t('movementChangeProduct')}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </>
        ) : null}

        {phase === 'pallet' ? (
          <>
            <Text style={[styles.sectionLabel, isDark && styles.sectionLabelDark]}>{t('movementPalletFrom')}</Text>
            <View style={styles.palletRow}>
              <TextInput
                style={[styles.searchInput, styles.palletInputFlex, isDark && styles.searchInputDark]}
                placeholder={t('movementPalletCodePlaceholder')}
                placeholderTextColor={isDark ? '#64748b' : '#999'}
                value={palletCodeInput}
                onChangeText={setPalletCodeInput}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                style={[styles.palletLoadBtn, isDark && styles.palletLoadBtnDark]}
                onPress={() => loadPalletContents(palletCodeInput)}
                disabled={palletLoading || !palletCodeInput.trim()}
              >
                {palletLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.palletLoadBtnText}>{t('movementPalletLoad')}</Text>
                )}
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.scanBtnSecondary} onPress={handleScanPallet} activeOpacity={0.8}>
              <Icon name="barcode-scan" size={26} color={isDark ? '#93c5fd' : '#1a237e'} />
              <Text style={[styles.scanBtnSecondaryText, isDark && styles.scanBtnSecondaryTextDark]}>
                {t('movementPalletScan')}
              </Text>
            </TouchableOpacity>
            <Text style={[styles.muted, isDark && styles.mutedDark]}>{t('movementPalletPickFromList')}</Text>
            <View style={styles.toList}>
              {filteredPalletSourceList.map((loc) => (
                <TouchableOpacity
                  key={loc.id}
                  style={[styles.locationRow, isDark && styles.locationRowDark]}
                  onPress={() => loadPalletContents(loc.code)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.locCode, isDark && styles.locCodeDark]} numberOfLines={2}>
                    {formatPickerLocationOptionLine(loc)}
                  </Text>
                  {loc.name ? <Text style={[styles.locBatch, isDark && styles.locBatchDark]}>{loc.name}</Text> : null}
                </TouchableOpacity>
              ))}
            </View>
            {palletError ? (
              <Text style={[styles.errorText, isDark && styles.errorTextDark]}>{palletError}</Text>
            ) : null}

            {palletContents ? (
              <>
                <View style={[styles.productCard, isDark && styles.productCardDark]}>
                  <Text style={[styles.productName, isDark && styles.productNameDark]}>
                    {palletContents.location_code}
                  </Text>
                  <Text style={[styles.productCode, isDark && styles.productCodeDark]}>
                    {t('movementPalletLines', { count: palletContents.items.length })}
                  </Text>
                </View>
                {palletContents.items.length === 0 ? (
                  <Text style={[styles.muted, isDark && styles.mutedDark]}>{t('movementPalletEmpty')}</Text>
                ) : (
                  palletContents.items.map((it) => (
                    <View
                      key={`${it.product_id}-${it.lot_id}`}
                      style={[styles.palletItemRow, isDark && styles.locationRowDark]}
                    >
                      <Text style={[styles.palletItemName, isDark && styles.locCodeDark]} numberOfLines={2}>
                        {it.product_name}
                      </Text>
                      <Text style={[styles.locBatch, isDark && styles.locBatchDark]}>{it.batch_no}</Text>
                      <Text style={[styles.locQty, isDark && styles.locQtyDark]}>
                        {Math.round(Number(it.available_qty))}
                      </Text>
                    </View>
                  ))
                )}

                <Text style={[styles.sectionLabel, isDark && styles.sectionLabelDark]}>{t('movementTo')}</Text>
                <TextInput
                  style={[styles.searchInput, isDark && styles.searchInputDark]}
                  placeholder={t('movementToSearch')}
                  placeholderTextColor={isDark ? '#64748b' : '#999'}
                  value={palletToLocation ? palletToLocation.code : palletDestSearch}
                  onChangeText={(text) => {
                    setPalletDestSearch(text);
                    setPalletToLocation(null);
                  }}
                />
                {!palletToLocation && (
                  <View style={styles.toList}>
                    {filteredPalletDest
                      .filter((l) => l.id !== palletContents.location_id)
                      .map((loc) => (
                        <TouchableOpacity
                          key={loc.id}
                          style={[styles.locationRow, isDark && styles.locationRowDark]}
                          onPress={() => {
                            setPalletToLocation(loc);
                            setPalletDestSearch(loc.code);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.locCode, isDark && styles.locCodeDark]} numberOfLines={2}>
                            {formatPickerLocationOptionLine(loc)}
                          </Text>
                          {loc.name ? (
                            <Text style={[styles.locBatch, isDark && styles.locBatchDark]}>{loc.name}</Text>
                          ) : null}
                        </TouchableOpacity>
                      ))}
                  </View>
                )}

                <TouchableOpacity
                  style={[
                    styles.submitBtn,
                    (!canSubmitPallet || palletSubmitting) && styles.submitBtnDisabled,
                  ]}
                  onPress={handleSubmitPallet}
                  disabled={!canSubmitPallet || palletSubmitting}
                  activeOpacity={0.8}
                >
                  {palletSubmitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.submitBtnText}>{t('movementPalletConfirmAll')}</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity style={styles.changeProductBtn} onPress={resetPalletFlow}>
                  <Text style={[styles.changeProductBtnText, isDark && styles.changeProductBtnTextDark]}>
                    {t('movementPalletChangeSource')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}
          </>
        ) : null}
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
  offlineHint: { fontSize: 14, color: '#b45309', marginBottom: 12 },
  chooseIntro: { fontSize: 15, color: '#333', marginBottom: 16, lineHeight: 22 },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  modeCardDark: { backgroundColor: '#1e293b', borderColor: '#334155' },
  modeCardTextWrap: { flex: 1 },
  modeCardTitle: { fontSize: 17, fontWeight: '700', color: '#1a237e' },
  modeCardTitleDark: { color: '#e2e8f0' },
  modeCardDesc: { fontSize: 14, color: '#666', marginTop: 4, lineHeight: 20 },
  modeCardDescDark: { color: '#94a3b8' },
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
  scanBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    marginBottom: 8,
  },
  scanBtnSecondaryText: { fontSize: 16, fontWeight: '600', color: '#1a237e' },
  scanBtnSecondaryTextDark: { color: '#93c5fd' },
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
  palletRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  palletInputFlex: { flex: 1, marginBottom: 0 },
  palletLoadBtn: {
    backgroundColor: '#1a237e',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  palletLoadBtnDark: { backgroundColor: '#334155' },
  palletLoadBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  palletItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    padding: 12,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: '#f5f5f5',
  },
  palletItemName: { fontSize: 14, fontWeight: '600', color: '#333', flex: 1, minWidth: 120 },
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
  containerDark: { backgroundColor: '#0f172a' },
  centeredDark: {},
  loadingTextDark: { color: '#94a3b8' },
  scrollDark: {},
  manualEntryLabelDark: { color: '#94a3b8' },
  hintDark: { color: '#94a3b8' },
  errorTextDark: { color: '#f87171' },
  productCardDark: { backgroundColor: '#1e293b' },
  productNameDark: { color: '#f1f5f9' },
  productCodeDark: { color: '#94a3b8' },
  sectionLabelDark: { color: '#e2e8f0' },
  mutedDark: { color: '#94a3b8' },
  locationRowDark: { backgroundColor: '#1e293b', borderColor: 'transparent' },
  locationRowSelectedDark: { borderColor: '#60a5fa', backgroundColor: '#1e3a5f' },
  locCodeDark: { color: '#f1f5f9' },
  locBatchDark: { color: '#94a3b8' },
  locQtyDark: { color: '#e2e8f0' },
  searchInputDark: { borderColor: '#334155', backgroundColor: '#1e293b', color: '#f1f5f9' },
  qtyInputDark: { borderColor: '#334155', backgroundColor: '#1e293b', color: '#f1f5f9' },
  changeProductBtnTextDark: { color: '#93c5fd' },
});
