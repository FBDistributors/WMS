/**
 * Kirim forma — flow: new (yangi mahsulotlar) yoki return (mijozdan qaytgan).
 * Skan, miqdor, lokatsiya avtomat (FEFO), qatorlar, yakunlash; return da yig'uvchiga yuborish.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { useNetwork } from '../network';
import { getPickerProductDetail, listPickerLocations, getLocationContents, type PickerProductDetailResponse, type PickerProductLocation, type PickerLocationOption, type LocationContentsItem } from '../api/inventory';
import { getPickers, type PickerUser } from '../api/picking';
import { createReceipt, completeReceipt } from '../api/receiving';
import { createStockMovement } from '../api/movements';
import { AppHeader } from '../components/AppHeader';
import { BarcodeSearchInput } from '../components/BarcodeSearchInput';
import { ExpiryDatePicker, formatExpiryDisplay } from '../components/ExpiryDatePicker';

type Nav = StackNavigationProp<RootStackParamList, 'KirimForm'>;
type KirimFormRoute = RouteProp<RootStackParamList, 'KirimForm'>;

type FormLine = {
  id: string;
  productId: string;
  productName: string;
  locationCode: string;
  locationId: string;
  lotId: string;
  qty: number;
  batch: string;
  expiryDate: string | null;
};

function sortLocations(locs: PickerProductLocation[]): PickerProductLocation[] {
  return [...locs].sort((a, b) => {
    const expA = a.expiry_date ? new Date(a.expiry_date).getTime() : Infinity;
    const expB = b.expiry_date ? new Date(b.expiry_date).getTime() : Infinity;
    if (expA !== expB) return expA - expB;
    return Number(b.available_qty) - Number(a.available_qty);
  });
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function KirimFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<KirimFormRoute>();
  const { t, locale } = useLocale();
  const { isOnline } = useNetwork();
  const flow = route.params?.flow ?? 'return';
  const params = route.params as {
    flow: 'new' | 'return' | 'inventory';
    scannedProductId?: string;
    scannedBarcode?: string;
    inventoryStep?: 1 | 2;
    inventoryLocationId?: string;
    inventoryLocationCode?: string;
  } | undefined;
  const isDirectSubmit = flow === 'new' || flow === 'inventory';

  const [lines, setLines] = useState<FormLine[]>([]);
  const [finished, setFinished] = useState(false);
  const [currentProduct, setCurrentProduct] = useState<PickerProductDetailResponse | null>(null);
  const [currentQty, setCurrentQty] = useState('');
  const [currentExpiry, setCurrentExpiry] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<PickerLocationOption | null>(null);
  const [allLocations, setAllLocations] = useState<PickerLocationOption[]>([]);
  const [locationSearch, setLocationSearch] = useState('');
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [pickerModalVisible, setPickerModalVisible] = useState(false);
  const [pickers, setPickers] = useState<PickerUser[]>([]);
  const [selectedPickerId, setSelectedPickerId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [expiryCalendarOpen, setExpiryCalendarOpen] = useState(false);
  const [expiryCalendarOpenScanned, setExpiryCalendarOpenScanned] = useState(false);
  const [inventoryLocation, setInventoryLocation] = useState<PickerLocationOption | null>(null);
  const [inventoryLocationSearch, setInventoryLocationSearch] = useState('');
  const [inventoryStep, setInventoryStep] = useState<0 | 1 | 2 | 3>(0);
  const [inventorySubMode, setInventorySubMode] = useState<'byLocation' | 'byScan' | null>(null);
  const [selectedScannedLocation, setSelectedScannedLocation] = useState<PickerProductLocation | null>(null);
  const [locationContents, setLocationContents] = useState<{ location_id: string; location_code: string; items: LocationContentsItem[] } | null>(null);
  const [loadingContents, setLoadingContents] = useState(false);
  const [contentsError, setContentsError] = useState<string | null>(null);
  const [actualQtyByKey, setActualQtyByKey] = useState<Record<string, string>>({});
  const [submittingAdjust, setSubmittingAdjust] = useState(false);
  const submittingAdjustRef = useRef(false);
  const [inventoryScannedLots, setInventoryScannedLots] = useState<LocationContentsItem[]>([]);
  const [loadingScannedLots, setLoadingScannedLots] = useState(false);
  const [inventoryScannedActualQty, setInventoryScannedActualQty] = useState('');
  const [inventoryScannedExpiry, setInventoryScannedExpiry] = useState('');
  const [submittingScannedAdjust, setSubmittingScannedAdjust] = useState(false);

  const title = flow === 'new' ? t('kirimNewProducts') : flow === 'inventory' ? t('kirimInventory') : t('kirimCustomerReturns');

  const loadProductById = useCallback(async (productId: string) => {
    setLoadingProduct(true);
    setProductError(null);
    setCurrentProduct(null);
    setCurrentQty('');
    try {
      const res = await getPickerProductDetail(productId);
      setCurrentProduct(res);
    } catch (e) {
      setProductError(e instanceof Error ? e.message : t('invLoadError'));
    } finally {
      setLoadingProduct(false);
    }
  }, [t]);

  const loadProductByScan = loadProductById;

  const handleSelectProductFromBarcode = useCallback(
    (productId: string) => {
      loadProductById(productId);
    },
    [loadProductById]
  );

  useFocusEffect(
    useCallback(() => {
      const pid = params?.scannedProductId;
      const invLocId = params?.inventoryLocationId;
      const invLocCode = params?.inventoryLocationCode;
      if (flow === 'inventory' && pid) {
        if (invLocId && invLocCode) {
          setInventorySubMode((m) => m ?? 'byLocation');
          setInventoryLocation({
            id: invLocId,
            code: invLocCode,
            name: invLocCode,
          });
          setInventoryLocationSearch(invLocCode);
          setInventoryStep(3);
          loadProductById(pid);
        } else {
          setInventorySubMode('byScan');
          setInventoryStep(2);
          loadProductById(pid);
          setSelectedScannedLocation(null);
        }
        navigation.setParams({
          ...route.params,
          scannedProductId: undefined,
          scannedBarcode: undefined,
          inventoryStep: undefined,
          inventoryLocationId: undefined,
          inventoryLocationCode: undefined,
        } as any);
        return;
      }
      if (flow === 'inventory' && invLocId && invLocCode && !pid) {
        setInventorySubMode((m) => m ?? 'byLocation');
        setInventoryLocation({
          id: invLocId,
          code: invLocCode,
          name: invLocCode,
        });
        setInventoryLocationSearch(invLocCode);
        setInventoryStep((params?.inventoryStep as 1 | 2) ?? 2);
        navigation.setParams({
          ...route.params,
          inventoryStep: undefined,
          inventoryLocationId: undefined,
          inventoryLocationCode: undefined,
        } as any);
        return;
      }
      if (pid && flow !== 'inventory') {
        loadProductById(pid);
        navigation.setParams({
          flow: route.params?.flow ?? 'return',
          scannedProductId: undefined,
          scannedBarcode: undefined,
        } as any);
      }
    }, [flow, params?.scannedProductId, params?.inventoryLocationId, params?.inventoryLocationCode, params?.inventoryStep, loadProductById, navigation, route.params])
  );

  useEffect(() => {
    if (isOnline) {
      listPickerLocations().then(setAllLocations).catch(() => setAllLocations([]));
    }
  }, [isOnline]);

  useEffect(() => {
    if (flow !== 'inventory' || inventorySubMode !== 'byLocation' || inventoryStep !== 2 || !inventoryLocation?.code) return;
    setLoadingContents(true);
    setContentsError(null);
    setLocationContents(null);
    getLocationContents(inventoryLocation.code)
      .then((res) => {
        setLocationContents(res);
        setActualQtyByKey({});
      })
      .catch((e) => {
        setContentsError(e instanceof Error ? e.message : t('invLoadError'));
      })
      .finally(() => setLoadingContents(false));
  }, [flow, inventorySubMode, inventoryStep, inventoryLocation?.code, t]);

  useEffect(() => {
    if (flow !== 'inventory' || inventorySubMode !== 'byLocation' || inventoryStep !== 3 || !currentProduct?.product_id || !inventoryLocation?.code) {
      setInventoryScannedLots([]);
      return;
    }
    setLoadingScannedLots(true);
    setInventoryScannedLots([]);
    setInventoryScannedActualQty('');
    setInventoryScannedExpiry('');
    getLocationContents(inventoryLocation.code)
      .then((res) => {
        const forProduct = res.items.filter((i) => i.product_id === currentProduct.product_id);
        setInventoryScannedLots(forProduct);
        if (forProduct.length === 1) {
          setInventoryScannedActualQty(String(Math.round(Number(forProduct[0].available_qty))));
          setInventoryScannedExpiry(forProduct[0].expiry_date ?? '');
        }
      })
      .catch(() => setInventoryScannedLots([]))
      .finally(() => setLoadingScannedLots(false));
  }, [flow, inventorySubMode, inventoryStep, currentProduct?.product_id, inventoryLocation?.code]);

  useEffect(() => {
    if (currentProduct) {
      setSelectedLocation(null);
      setLocationSearch('');
    }
  }, [currentProduct?.product_id]);

  useEffect(() => {
    if (flow === 'inventory' && inventorySubMode === 'byScan' && inventoryStep === 1 && currentProduct && !loadingProduct) {
      setInventoryStep(2);
    }
  }, [flow, inventorySubMode, inventoryStep, currentProduct, loadingProduct]);

  useEffect(() => {
    if (pickerModalVisible && isOnline && flow === 'return') {
      getPickers().then(setPickers).catch(() => setPickers([]));
    }
  }, [pickerModalVisible, isOnline, flow]);

  const handleScan = useCallback(() => {
    const scanParams: { returnToKirimForm: true; flow: typeof flow; inventoryStep?: 1 | 2 | 3; inventoryLocationId?: string; inventoryLocationCode?: string } = {
      returnToKirimForm: true,
      flow,
    };
    if (flow === 'inventory' && inventorySubMode === 'byLocation' && inventoryLocation) {
      scanParams.inventoryStep = inventoryStep;
      scanParams.inventoryLocationId = inventoryLocation.id;
      scanParams.inventoryLocationCode = inventoryLocation.code;
    }
    navigation.navigate('Scanner', scanParams);
  }, [navigation, flow, inventoryStep, inventorySubMode, inventoryLocation]);

  const handleSubmitAdjust = useCallback(async () => {
    if (!locationContents?.items?.length) return;
    if (submittingAdjustRef.current) return;
    submittingAdjustRef.current = true;
    setSubmittingAdjust(true);
    let hadError = false;
    let permissionError = false;
    const sentKeys = new Set<string>();
    for (const item of locationContents.items) {
      const key = `${item.product_id}-${item.lot_id}-${item.location_id}`;
      if (sentKeys.has(key)) continue;
      const actualStr = actualQtyByKey[`${item.product_id}-${item.lot_id}`]?.trim();
      if (actualStr === '') continue;
      const actual = Math.floor(Number(actualStr) || 0);
      const systemQty = Number(item.available_qty) || 0;
      const delta = actual - systemQty;
      if (delta === 0) continue;
      sentKeys.add(key);
      try {
        await createStockMovement({
          product_id: item.product_id,
          lot_id: item.lot_id,
          location_id: item.location_id,
          qty_change: delta,
          movement_type: 'adjust',
          reason_code: delta < 0 ? 'inventory_shortage' : 'inventory_overage',
        });
      } catch (e: any) {
        hadError = true;
        if (e?.response?.status === 403) permissionError = true;
      }
    }
    submittingAdjustRef.current = false;
    setSubmittingAdjust(false);
    if (permissionError) {
      Alert.alert(t('error'), t('inventoryAdjustNoPermission'));
    } else if (hadError) {
      Alert.alert(t('error'), t('kirimSubmitError'));
    } else {
      setActualQtyByKey({});
      getLocationContents(inventoryLocation!.code).then(setLocationContents).catch(() => {});
    }
  }, [locationContents, actualQtyByKey, inventoryLocation, t]);

  const handleSubmitScannedAdjust = useCallback(async () => {
    if (inventoryScannedLots.length === 0 || !inventoryLocation) return;
    const item = inventoryScannedLots[0];
    const actual = Math.floor(Number(inventoryScannedActualQty.trim()) || 0);
    const systemQty = Math.round(Number(item.available_qty) || 0);
    const delta = actual - systemQty;
    if (delta === 0) {
      Alert.alert(t('error'), t('inventoryScannedNoChange'));
      return;
    }
    setSubmittingScannedAdjust(true);
    try {
      await createStockMovement({
        product_id: item.product_id,
        lot_id: item.lot_id,
        location_id: item.location_id,
        qty_change: delta,
        movement_type: 'adjust',
        reason_code: delta < 0 ? 'inventory_shortage' : 'inventory_overage',
      });
      Alert.alert(t('success'), t('inventoryScannedAdjustDone'));
      setCurrentProduct(null);
      setInventoryScannedLots([]);
      setInventoryScannedActualQty('');
      setInventoryScannedExpiry('');
    } catch (e: any) {
      if (e?.response?.status === 403) {
        Alert.alert(t('error'), t('inventoryAdjustNoPermission'));
      } else {
        Alert.alert(t('error'), e instanceof Error ? e.message : t('kirimSubmitError'));
      }
    } finally {
      setSubmittingScannedAdjust(false);
    }
  }, [inventoryScannedLots, inventoryLocation, inventoryScannedActualQty, t]);

  const handleSubmitScannedAdjustByScan = useCallback(async (loc: PickerProductLocation) => {
    if (!currentProduct) return;
    const actual = Math.floor(Number(inventoryScannedActualQty.trim()) || 0);
    const systemQty = Math.round(Number(loc.available_qty) || 0);
    const delta = actual - systemQty;
    if (delta === 0) {
      Alert.alert(t('error'), t('inventoryScannedNoChange'));
      return;
    }
    setSubmittingScannedAdjust(true);
    try {
      await createStockMovement({
        product_id: currentProduct.product_id,
        lot_id: loc.lot_id,
        location_id: loc.location_id,
        qty_change: delta,
        movement_type: 'adjust',
        reason_code: delta < 0 ? 'inventory_shortage' : 'inventory_overage',
      });
      Alert.alert(t('success'), t('inventoryScannedAdjustDone'));
      setSelectedScannedLocation(null);
      setInventoryScannedActualQty('');
      setInventoryScannedExpiry('');
      setInventoryStep(2);
    } catch (e: any) {
      if (e?.response?.status === 403) {
        Alert.alert(t('error'), t('inventoryAdjustNoPermission'));
      } else {
        Alert.alert(t('error'), e instanceof Error ? e.message : t('kirimSubmitError'));
      }
    } finally {
      setSubmittingScannedAdjust(false);
    }
  }, [currentProduct, inventoryScannedActualQty, t]);

  const addLine = useCallback(() => {
    const location = flow === 'inventory' ? inventoryLocation : selectedLocation;
    if (!currentProduct || !location) return;
    const qty = Math.floor(Number(currentQty) || 0);
    // Kirim: dono qo‘shiladi, mavjud zaxoraga bog‘lamaymiz; faqat 1–99999 oralig‘ida
    const maxQty = 99999;
    if (qty < 1 || qty > maxQty) {
      Alert.alert(t('error'), t('qtyRangeError', { max: maxQty }));
      return;
    }
    const expiryVal = currentExpiry.trim() || null;
    if (expiryVal && !/^\d{4}-\d{2}-\d{2}$/.test(expiryVal)) {
      Alert.alert(t('error'), t('kirimExpiryFormat'));
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        id: `${currentProduct.product_id}-${location.id}-${Date.now()}`,
        productId: currentProduct.product_id,
        productName: currentProduct.name,
        locationCode: location.code,
        locationId: location.id,
        lotId: '',
        qty,
        batch: '',
        expiryDate: expiryVal,
      },
    ]);
    setCurrentProduct(null);
    setCurrentQty('');
    setCurrentExpiry('');
  }, [flow, currentProduct, selectedLocation, inventoryLocation, currentQty, currentExpiry, t]);

  const removeLine = useCallback((id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const handleYakunlash = useCallback(() => {
    if (lines.length === 0) {
      Alert.alert(t('error'), t('returnsAddAtLeastOne'));
      return;
    }
    setFinished(true);
  }, [lines.length, t]);

  const handleSendToPicker = useCallback(async () => {
    if (flow === 'return') {
      if (!selectedPickerId) {
        Alert.alert(t('error'), t('returnsSelectPicker'));
        return;
      }
      setSending(true);
      setTimeout(() => {
        setSending(false);
        setPickerModalVisible(false);
        setSelectedPickerId(null);
        setLines([]);
        setFinished(false);
        Alert.alert(t('success'), t('returnsSentToPicker'));
      }, 500);
      return;
    }
    // flow === 'new': backend receiving API orqali omborga kirim va qoldiq yangilash
    setSending(true);
    try {
      const payload = {
        lines: lines.map((l) => ({
          product_id: l.productId,
          qty: l.qty,
          batch: l.batch || '',
          expiry_date: l.expiryDate || null,
          location_id: l.locationId,
        })),
      };
      const receipt = await createReceipt(payload);
      await completeReceipt(receipt.id);
      setLines([]);
      setFinished(false);
      Alert.alert(t('success'), t('kirimSubmitDone'));
    } catch (e: unknown) {
      let msg: string = e instanceof Error ? e.message : t('kirimSubmitError');
      if (e && typeof e === 'object' && 'response' in e && e.response && typeof e.response === 'object' && 'data' in e.response) {
        const detail = (e.response as { data?: { detail?: string } }).data?.detail;
        if (typeof detail === 'string') msg = detail;
      }
      if (msg === 'Insufficient permissions' || msg.toLowerCase().includes('insufficient permissions')) {
        msg = t('kirimInsufficientPermissions');
      }
      Alert.alert(t('error'), msg);
    } finally {
      setSending(false);
    }
  }, [flow, selectedPickerId, lines, t]);

  const searchTrim = locationSearch.trim();
  const filteredLocations = searchTrim
    ? allLocations.filter(
        (l) =>
          (l.code && l.code.toLowerCase().includes(searchTrim.toLowerCase())) ||
          (l.name != null && String(l.name).toLowerCase().includes(searchTrim.toLowerCase()))
      ).slice(0, 30)
    : [];
  const showLocationDropdown =
    searchTrim.length > 0 &&
    (!selectedLocation || selectedLocation.code !== searchTrim);
  const inventorySearchTrim = inventoryLocationSearch.trim();
  const filteredInventoryLocations = inventorySearchTrim
    ? allLocations.filter(
        (l) =>
          (l.code && l.code.toLowerCase().includes(inventorySearchTrim.toLowerCase())) ||
          (l.name != null && String(l.name).toLowerCase().includes(inventorySearchTrim.toLowerCase()))
      ).slice(0, 30)
    : [];
  const showInventoryLocationDropdown =
    flow === 'inventory' &&
    inventorySearchTrim.length > 0 &&
    (!inventoryLocation || inventoryLocation.code !== inventorySearchTrim);
  const canAddLine =
    currentProduct &&
    (flow === 'inventory' ? inventoryLocation : selectedLocation) &&
    currentQty.trim().length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader
        title={title}
        showLogo={false}
        showBack={true}
        onBack={() => {
          if (flow === 'inventory') {
            if (inventoryStep === 0) navigation.navigate('Kirim');
            else if (inventoryStep === 1) setInventoryStep(0);
            else if (inventoryStep === 2) setInventoryStep(1);
            else if (inventoryStep === 3) setInventoryStep(2);
          } else {
            navigation.goBack();
          }
        }}
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Inventarizatsiya: 0-qadam — 2 bo'lim tanlovi */}
        {flow === 'inventory' && inventoryStep === 0 && (
          <>
            <TouchableOpacity
              style={styles.inventoryChoiceCard}
              onPress={() => { setInventorySubMode('byLocation'); setInventoryStep(1); }}
              activeOpacity={0.7}
            >
              <View style={styles.inventoryChoiceCardIconWrap}>
                <Icon name="map-marker" size={32} color="#1a237e" />
              </View>
              <View style={styles.inventoryChoiceCardBody}>
                <Text style={styles.inventoryChoiceCardTitle}>{t('inventoryByLocation')}</Text>
                <Text style={styles.inventoryChoiceCardDesc}>{t('inventoryByLocationDesc')}</Text>
              </View>
              <Icon name="chevron-right" size={24} color="#777" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.inventoryChoiceCard}
              onPress={() => { setInventorySubMode('byScan'); setInventoryStep(1); setCurrentProduct(null); setSelectedScannedLocation(null); }}
              activeOpacity={0.7}
            >
              <View style={styles.inventoryChoiceCardIconWrap}>
                <Icon name="barcode-scan" size={32} color="#1a237e" />
              </View>
              <View style={styles.inventoryChoiceCardBody}>
                <Text style={styles.inventoryChoiceCardTitle}>{t('inventoryByScan')}</Text>
                <Text style={styles.inventoryChoiceCardDesc}>{t('inventoryByScanDesc')}</Text>
              </View>
              <Icon name="chevron-right" size={24} color="#777" />
            </TouchableOpacity>
          </>
        )}

        {/* Bo'lim 1: Lokatsiya orqali — step 1: lokatsiya kiritish */}
        {flow === 'inventory' && inventorySubMode === 'byLocation' && inventoryStep === 1 && (
          <>
            <View style={styles.inventoryLocationBlock}>
              <Text style={styles.inventoryLocationLabel}>{t('inventorySelectLocationFirst')}</Text>
              <View style={styles.locationWrap}>
                <TextInput
                  style={styles.locationInputFull}
                  value={inventoryLocation ? inventoryLocation.code : inventoryLocationSearch}
                  onChangeText={(text) => {
                    setInventoryLocationSearch(text);
                    setInventoryLocation(null);
                  }}
                  placeholder={t('kirimLocationSearchPlaceholder')}
                  placeholderTextColor="#999"
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
                {showInventoryLocationDropdown && (
                  <View style={styles.locationDropdownInline}>
                    <ScrollView
                      style={styles.locationDropdownScroll}
                      contentContainerStyle={styles.locationDropdownScrollContent}
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled
                      showsVerticalScrollIndicator
                    >
                      {filteredInventoryLocations.length === 0 ? (
                        <View style={styles.locationDropdownEmpty}>
                          <Text style={styles.locationDropdownEmptyText}>{t('kirimLocationNoResults')}</Text>
                        </View>
                      ) : (
                        filteredInventoryLocations.map((loc) => (
                          <TouchableOpacity
                            key={loc.id}
                            style={[
                              styles.locationDropdownItem,
                              inventoryLocation?.id === loc.id && styles.locationDropdownItemSelected,
                            ]}
                            onPress={() => {
                              setInventoryLocation(loc);
                              setInventoryLocationSearch(loc.code);
                            }}
                          >
                            <Text style={styles.locationDropdownItemCode} numberOfLines={1}>{loc.code}</Text>
                            {loc.name && loc.name !== loc.code ? (
                              <Text style={styles.locationDropdownItemName} numberOfLines={1}>{loc.name}</Text>
                            ) : null}
                          </TouchableOpacity>
                        ))
                      )}
                    </ScrollView>
                  </View>
                )}
              </View>
            </View>
            <TouchableOpacity
              style={[styles.scanBtnTop, !inventoryLocation && styles.buttonDisabled]}
              onPress={() => inventoryLocation && setInventoryStep(2)}
              activeOpacity={0.8}
              disabled={!inventoryLocation}
            >
              <Text style={styles.scanBtnText}>{t('inventoryViewLocationContents')}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Bo'lim 1: Lokatsiya orqali — step 2: lokatsiya tarkibi + tuzatish */}
        {flow === 'inventory' && inventorySubMode === 'byLocation' && inventoryStep === 2 && inventoryLocation && (
          <>
            <View style={styles.inventoryLocationChosenBar}>
              <Text style={styles.inventoryLocationChosenText}>
                {t('inventorySelectedLocation')}: {inventoryLocation.code}
              </Text>
              <TouchableOpacity onPress={() => setInventoryStep(1)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={styles.inventoryLocationChangeLink}>{t('inventoryChangeLocation')}</Text>
              </TouchableOpacity>
            </View>
            {loadingContents && (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color="#1a237e" />
                <Text style={styles.loadingText}>{t('loading')}</Text>
              </View>
            )}
            {contentsError && (
              <View style={styles.errorRow}>
                <Text style={styles.errorText}>{contentsError}</Text>
              </View>
            )}
            {!loadingContents && locationContents && (
              <>
                <Text style={styles.sectionLabel}>{t('inventoryLocationContents')}</Text>
                {locationContents.items.length === 0 ? (
                  <Text style={styles.muted}>{t('inventoryNoProductsAtLocation')}</Text>
                ) : (
                  <View style={styles.contentsList}>
                    {locationContents.items.map((item) => {
                      const key = `${item.product_id}-${item.lot_id}`;
                      return (
                        <View key={key} style={styles.contentsRow}>
                          <View style={styles.contentsRowInfo}>
                            <Text style={styles.contentsRowName} numberOfLines={2}>{item.product_name}</Text>
                            <Text style={styles.contentsRowMeta}>
                              {item.batch_no}
                              {item.expiry_date ? ` • ${item.expiry_date}` : ''} • {t('inventorySystemQty')}: {Math.round(Number(item.available_qty))}
                            </Text>
                          </View>
                          <TextInput
                            style={styles.contentsActualInput}
                            value={actualQtyByKey[key] ?? ''}
                            onChangeText={(text) => setActualQtyByKey((prev) => ({ ...prev, [key]: text }))}
                            placeholder={t('inventoryActualQty')}
                            placeholderTextColor="#999"
                            keyboardType="number-pad"
                          />
                        </View>
                      );
                    })}
                  </View>
                )}
                {locationContents.items.length > 0 && (
                  <TouchableOpacity
                    style={[styles.scanBtnTop, submittingAdjust && styles.buttonDisabled]}
                    onPress={handleSubmitAdjust}
                    disabled={submittingAdjust}
                    activeOpacity={0.8}
                  >
                    {submittingAdjust ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.scanBtnText}>{t('inventoryAdjustSubmit')}</Text>
                    )}
                  </TouchableOpacity>
                )}
                </>
            )}
          </>
        )}

        {/* Bo'lim 2: Scan qilib — step 1: qo'lda kiritish + Skaner (yangi mahsulotlar bo'limidagi kabi) */}
        {flow === 'inventory' && inventorySubMode === 'byScan' && inventoryStep === 1 && (
          <>
            <View style={styles.barcodeBlockTop}>
              <Text style={styles.manualEntryLabel}>{t('kirimManualEntry')}</Text>
              <BarcodeSearchInput
                value={manualBarcode}
                onChangeText={setManualBarcode}
                onSelectProduct={handleSelectProductFromBarcode}
                placeholder={t('kirimBarcodePlaceholder')}
                emptyLabel={t('barcodeSearchNoResults')}
                loading={loadingProduct}
                error={productError}
                onClearError={() => setProductError(null)}
                dropdownMaxHeight={200}
              />
            </View>
            <TouchableOpacity style={styles.scanBtnTop} onPress={handleScan} activeOpacity={0.8}>
              <Icon name="barcode-scan" size={28} color="#fff" />
              <Text style={styles.scanBtnText}>{t('scanButton')}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Bo'lim 2: Scan qilib — step 2: mahsulot + lokatsiyalar ro'yxati */}
        {flow === 'inventory' && inventorySubMode === 'byScan' && inventoryStep === 2 && currentProduct && !loadingProduct && (
          <>
            <View style={styles.card}>
              <Text style={styles.productName} numberOfLines={2}>{currentProduct.name}</Text>
              {currentProduct.main_barcode ? (
                <Text style={styles.contentsRowMeta}>{t('invShtrixKod')}: {currentProduct.main_barcode}</Text>
              ) : null}
            </View>
            <Text style={styles.sectionLabel}>{t('inventorySelectLocationToAdjust')}</Text>
            {currentProduct.locations.length === 0 ? (
              <Text style={styles.muted}>{t('inventoryNoProductsAtLocation')}</Text>
            ) : (
              <View style={styles.contentsList}>
                {currentProduct.locations.map((loc) => (
                  <TouchableOpacity
                    key={`${loc.location_id}-${loc.lot_id}`}
                    style={styles.contentsRow}
                    onPress={() => {
                      setSelectedScannedLocation(loc);
                      setInventoryScannedActualQty(String(Math.round(Number(loc.available_qty))));
                      setInventoryScannedExpiry(loc.expiry_date ?? '');
                      setInventoryStep(3);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.contentsRowInfo}>
                      <Text style={styles.contentsRowName}>{loc.location_code}</Text>
                      <Text style={styles.contentsRowMeta}>
                        {loc.batch_no}{loc.expiry_date ? ` • ${loc.expiry_date}` : ''} • {t('invQoldiq')}: {Math.round(Number(loc.available_qty))}
                      </Text>
                    </View>
                    <Icon name="chevron-right" size={22} color="#666" />
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TouchableOpacity style={styles.inventoryScanAnotherBtn} onPress={() => { setCurrentProduct(null); setInventoryStep(1); }}>
              <Text style={styles.inventoryScanAnotherBtnText}>{t('inventoryScanAnother')}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Bo'lim 2: Scan qilib — step 3: tanlangan lokatsiya uchun tuzatish */}
        {flow === 'inventory' && inventorySubMode === 'byScan' && inventoryStep === 3 && currentProduct && selectedScannedLocation && (
          <>
            <View style={styles.inventoryLocationChosenBar}>
              <Text style={styles.inventoryLocationChosenText}>
                {selectedScannedLocation.location_code}
              </Text>
              <TouchableOpacity onPress={() => { setInventoryStep(2); setSelectedScannedLocation(null); }} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={styles.inventoryLocationChangeLink}>{t('inventoryChangeLocation')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.card}>
              <Text style={styles.productName} numberOfLines={2}>{currentProduct.name}</Text>
              <Text style={styles.contentsRowMeta}>
                {selectedScannedLocation.batch_no}
                {selectedScannedLocation.expiry_date ? ` • ${selectedScannedLocation.expiry_date}` : ''}
              </Text>
              <View style={styles.inventoryLocationReadOnly}>
                <Text style={styles.label}>{t('inventorySystemQty')}</Text>
                <Text style={styles.inventoryLocationCode}>{Math.round(Number(selectedScannedLocation.available_qty))}</Text>
              </View>
              <Text style={styles.label}>{t('inventoryActualQty')}</Text>
              <TextInput
                style={styles.input}
                value={inventoryScannedActualQty}
                onChangeText={setInventoryScannedActualQty}
                placeholder={t('inventoryActualQty')}
                placeholderTextColor="#999"
                keyboardType="number-pad"
              />
              <Text style={styles.label}>{t('inventoryExpiryDate')}</Text>
              <View style={styles.expiryRow}>
                <TouchableOpacity
                  style={styles.expiryInputTouchable}
                  onPress={() => setExpiryCalendarOpenScanned(true)}
                >
                  <Text style={[styles.expiryInputText, !inventoryScannedExpiry && styles.expiryInputPlaceholder]}>
                    {inventoryScannedExpiry || t('kirimExpiryPlaceholder')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.expiryCalendarBtn}
                  onPress={() => setExpiryCalendarOpenScanned(true)}
                >
                  <Icon name="calendar" size={24} color="#1a237e" />
                </TouchableOpacity>
              </View>
              <ExpiryDatePicker
                visible={expiryCalendarOpenScanned}
                onClose={() => setExpiryCalendarOpenScanned(false)}
                value={inventoryScannedExpiry || null}
                onChange={(iso) => {
                  setInventoryScannedExpiry(iso || '');
                  setExpiryCalendarOpenScanned(false);
                }}
                minDate={todayISO()}
                locale={locale}
                darkMode={false}
              />
              <TouchableOpacity
                style={[styles.scanBtnTop, submittingScannedAdjust && styles.buttonDisabled]}
                onPress={() => handleSubmitScannedAdjustByScan(selectedScannedLocation)}
                disabled={submittingScannedAdjust}
                activeOpacity={0.8}
              >
                {submittingScannedAdjust ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.scanBtnText}>{t('inventoryAdjustSubmit')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Inventarizatsiya byLocation step 3 (skaner orqali mahsulot qo'shish) va boshqa flow: barcode/skaner */}
        {((flow === 'inventory' && inventorySubMode === 'byLocation' && inventoryStep === 3) || flow !== 'inventory') && (
          <>
            {flow === 'inventory' && inventorySubMode === 'byLocation' && inventoryStep === 3 && inventoryLocation && (
              <View style={styles.inventoryLocationChosenBar}>
                <Text style={styles.inventoryLocationChosenText}>
                  {t('inventorySelectedLocation')}: {inventoryLocation.code}
                </Text>
                <TouchableOpacity onPress={() => setInventoryStep(2)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <Text style={styles.inventoryLocationChangeLink}>{t('inventoryChangeLocation')}</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.barcodeBlockTop}>
              <Text style={styles.manualEntryLabel}>{t('kirimManualEntry')}</Text>
              <BarcodeSearchInput
                value={manualBarcode}
                onChangeText={setManualBarcode}
                onSelectProduct={handleSelectProductFromBarcode}
                placeholder={t('kirimBarcodePlaceholder')}
                emptyLabel={t('barcodeSearchNoResults')}
                loading={loadingProduct}
                error={productError}
                onClearError={() => setProductError(null)}
                dropdownMaxHeight={200}
              />
            </View>
            <TouchableOpacity style={styles.scanBtnTop} onPress={handleScan} activeOpacity={0.8}>
              <Icon name="barcode-scan" size={28} color="#fff" />
              <Text style={styles.scanBtnText}>{t('scanButton')}</Text>
            </TouchableOpacity>
          </>
        )}

        {!(flow === 'inventory' && (inventoryStep === 0 || (inventorySubMode === 'byLocation' && (inventoryStep === 1 || inventoryStep === 2)) || (inventorySubMode === 'byScan' && inventoryStep === 2))) && loadingProduct && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#1a237e" />
            <Text style={styles.loadingText}>{t('loading')}</Text>
          </View>
        )}

        {!(flow === 'inventory' && (inventoryStep === 0 || (inventorySubMode === 'byLocation' && (inventoryStep === 1 || inventoryStep === 2)) || (inventorySubMode === 'byScan' && inventoryStep === 2))) && productError && (
          <View style={styles.errorRow}>
            <Text style={styles.errorText}>{productError}</Text>
          </View>
        )}

        {flow === 'inventory' && inventorySubMode === 'byLocation' && inventoryStep === 3 && inventoryLocation && currentProduct && !loadingProduct && (
          <>
            {loadingScannedLots ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color="#1a237e" />
                <Text style={styles.loadingText}>{t('loading')}</Text>
              </View>
            ) : inventoryScannedLots.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.productName} numberOfLines={2}>{currentProduct.name}</Text>
                <Text style={styles.muted}>{t('inventoryProductNotAtLocation')}</Text>
                <TouchableOpacity style={styles.inventoryScanAnotherBtn} onPress={() => { setCurrentProduct(null); setInventoryScannedLots([]); }}>
                  <Text style={styles.inventoryScanAnotherBtnText}>{t('inventoryScanAnother')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.productName} numberOfLines={2}>{currentProduct.name}</Text>
                <Text style={styles.contentsRowMeta}>
                  {inventoryScannedLots[0].batch_no}
                  {inventoryScannedLots[0].expiry_date ? ` • ${inventoryScannedLots[0].expiry_date}` : ''}
                </Text>
                <View style={styles.inventoryLocationReadOnly}>
                  <Text style={styles.label}>{t('inventorySystemQty')}</Text>
                  <Text style={styles.inventoryLocationCode}>{Math.round(Number(inventoryScannedLots[0].available_qty))}</Text>
                </View>
                <Text style={styles.label}>{t('inventoryActualQty')}</Text>
                <TextInput
                  style={styles.input}
                  value={inventoryScannedActualQty}
                  onChangeText={setInventoryScannedActualQty}
                  placeholder={t('inventoryActualQty')}
                  placeholderTextColor="#999"
                  keyboardType="number-pad"
                />
                <Text style={styles.label}>{t('inventoryExpiryDate')}</Text>
                <View style={styles.expiryRow}>
                  <TouchableOpacity
                    style={styles.expiryInputTouchable}
                    onPress={() => setExpiryCalendarOpenScanned(true)}
                  >
                    <Text style={[styles.expiryInputText, !inventoryScannedExpiry && styles.expiryInputPlaceholder]}>
                      {inventoryScannedExpiry || t('kirimExpiryPlaceholder')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.expiryCalendarBtn}
                    onPress={() => setExpiryCalendarOpenScanned(true)}
                  >
                    <Icon name="calendar" size={24} color="#1a237e" />
                  </TouchableOpacity>
                </View>
                <ExpiryDatePicker
                  visible={expiryCalendarOpenScanned}
                  onClose={() => setExpiryCalendarOpenScanned(false)}
                  value={inventoryScannedExpiry || null}
                  onChange={(iso) => {
                    setInventoryScannedExpiry(iso || '');
                    setExpiryCalendarOpenScanned(false);
                  }}
                  minDate={todayISO()}
                  locale={locale}
                  darkMode={false}
                />
                <TouchableOpacity
                  style={[styles.scanBtnTop, submittingScannedAdjust && styles.buttonDisabled]}
                  onPress={handleSubmitScannedAdjust}
                  disabled={submittingScannedAdjust}
                  activeOpacity={0.8}
                >
                  {submittingScannedAdjust ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.scanBtnText}>{t('inventoryAdjustSubmit')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {!(flow === 'inventory' && (inventoryStep === 0 || (inventorySubMode === 'byLocation' && (inventoryStep === 1 || inventoryStep === 2)) || (inventorySubMode === 'byScan' && (inventoryStep === 2 || inventoryStep === 3)))) && (flow === 'inventory' ? inventorySubMode === 'byLocation' && inventoryLocation && currentProduct : currentProduct) && !loadingProduct && !(flow === 'inventory' && inventorySubMode === 'byLocation' && inventoryStep === 3 && inventoryScannedLots.length > 0) && (
          <View style={styles.card}>
            <Text style={styles.productName} numberOfLines={2}>{currentProduct.name}</Text>
            <Text style={styles.label}>{t('quantity')}</Text>
            <TextInput
              style={styles.input}
              value={currentQty}
              onChangeText={setCurrentQty}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#999"
            />
            {flow === 'inventory' ? (
              <View style={styles.inventoryLocationReadOnly}>
                <Text style={styles.label}>{t('inventorySelectedLocation')}</Text>
                <Text style={styles.inventoryLocationCode}>{inventoryLocation?.code}</Text>
              </View>
            ) : (
              <>
                <Text style={styles.label}>{t('locationLabel')}</Text>
                <View style={styles.locationWrap}>
                  <TextInput
                    style={styles.locationInputFull}
                    value={selectedLocation ? selectedLocation.code : locationSearch}
                    onChangeText={(text) => {
                      setLocationSearch(text);
                      setSelectedLocation(null);
                    }}
                    placeholder={t('kirimLocationSearchPlaceholder')}
                    placeholderTextColor="#999"
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                  {showLocationDropdown && (
                <View style={styles.locationDropdownInline}>
                  <ScrollView
                    style={styles.locationDropdownScroll}
                    contentContainerStyle={styles.locationDropdownScrollContent}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled={true}
                    showsVerticalScrollIndicator={true}
                  >
                    {filteredLocations.length === 0 ? (
                      <View style={styles.locationDropdownEmpty}>
                        <Text style={styles.locationDropdownEmptyText}>
                          {t('kirimLocationNoResults')}
                        </Text>
                      </View>
                    ) : (
                      filteredLocations.map((loc) => (
                        <TouchableOpacity
                          key={loc.id}
                          style={[
                            styles.locationDropdownItem,
                            selectedLocation?.id === loc.id && styles.locationDropdownItemSelected,
                          ]}
                          onPress={() => {
                            setSelectedLocation(loc);
                            setLocationSearch(loc.code);
                          }}
                        >
                          <Text style={styles.locationDropdownItemCode} numberOfLines={1}>{loc.code}</Text>
                          {loc.name && loc.name !== loc.code ? (
                            <Text style={styles.locationDropdownItemName} numberOfLines={1}>{loc.name}</Text>
                          ) : null}
                        </TouchableOpacity>
                      ))
                    )}
                  </ScrollView>
                </View>
              )}
            </View>
              </>
            )}
            <Text style={styles.label}>{t('kirimExpiryLabel')}</Text>
            <View style={styles.expiryRow}>
              <TouchableOpacity
                style={styles.expiryInputTouchable}
                onPress={() => setExpiryCalendarOpen(true)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.expiryInputText,
                    !currentExpiry && styles.expiryInputPlaceholder,
                  ]}
                  numberOfLines={1}
                >
                  {currentExpiry && /^\d{4}-\d{2}-\d{2}$/.test(currentExpiry)
                    ? formatExpiryDisplay(currentExpiry, locale)
                    : t('kirimExpiryPlaceholder')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.expiryCalendarBtn}
                onPress={() => setExpiryCalendarOpen(true)}
              >
                <Icon name="calendar" size={24} color="#1a237e" />
              </TouchableOpacity>
            </View>
            <ExpiryDatePicker
              visible={expiryCalendarOpen}
              onClose={() => setExpiryCalendarOpen(false)}
              value={currentExpiry || null}
              onChange={(iso) => {
                setCurrentExpiry(iso || '');
                setExpiryCalendarOpen(false);
              }}
              minDate={todayISO()}
              locale={locale}
              darkMode={false}
            />
            <TouchableOpacity
              style={[styles.addLineBtn, !canAddLine && styles.addLineBtnDisabled]}
              onPress={addLine}
              disabled={!canAddLine}
            >
              <Text style={styles.addLineBtnText}>{t('returnsAddLine')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {lines.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('returnsLines')} ({lines.length})</Text>
            {lines.map((line) => (
              <View key={line.id} style={styles.lineRow}>
                <View style={styles.lineInfo}>
                  <Text style={styles.lineProduct} numberOfLines={1}>{line.productName}</Text>
                  <Text style={styles.lineMeta}>{line.locationCode} · {line.qty} dona{line.expiryDate ? ` · ${line.expiryDate}` : ''}</Text>
                </View>
                <TouchableOpacity onPress={() => removeLine(line.id)} hitSlop={12}>
                  <Icon name="close-circle-outline" size={24} color="#c62828" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Faqat mijozdan qaytgan (return) da: avval Yakunlash, keyin yig'uvchi tanlash va Yuborish */}
        {lines.length > 0 && !finished && flow === 'return' && (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleYakunlash}>
            <Text style={styles.primaryBtnText}>{t('returnsFinish')}</Text>
          </TouchableOpacity>
        )}

        {/* Yangi mahsulotlar va inventarizatsiya: bitta Yuborish (yakunlash + backend ga yuborish) */}
        {lines.length > 0 && (flow === 'new' || flow === 'inventory') && (
          <TouchableOpacity
            style={[styles.primaryBtn, styles.primaryBtnSmall]}
            onPress={handleSendToPicker}
            disabled={sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>{t('kirimSubmit')}</Text>
            )}
          </TouchableOpacity>
        )}

        {finished && lines.length > 0 && flow === 'return' && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('returnsAssignPicker')}</Text>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => setPickerModalVisible(true)}
            >
              <Text style={styles.secondaryBtnText}>
                {selectedPickerId
                  ? pickers.find((p) => p.id === selectedPickerId)?.full_name || pickers.find((p) => p.id === selectedPickerId)?.username
                  : t('returnsSelectPicker')}
              </Text>
              <Icon name="account-outline" size={22} color="#1a237e" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, styles.primaryBtnSmall, !selectedPickerId && styles.primaryBtnDisabled]}
              onPress={handleSendToPicker}
              disabled={!selectedPickerId || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>{t('returnsSendToPicker')}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>

      {flow === 'return' && (
        <Modal
          visible={pickerModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setPickerModalVisible(false)}
        >
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setPickerModalVisible(false)}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t('returnsSelectPicker')}</Text>
                <TouchableOpacity onPress={() => setPickerModalVisible(false)}>
                  <Icon name="close" size={24} color="#333" />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.modalList}>
                {pickers.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.modalItem, selectedPickerId === p.id && styles.modalItemActive]}
                    onPress={() => setSelectedPickerId(p.id)}
                  >
                    <Text style={styles.modalItemText}>{p.full_name || p.username}</Text>
                    {selectedPickerId === p.id && <Icon name="check-circle" size={22} color="#1a237e" />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 24 },
  barcodeBlockTop: {
    marginBottom: 12,
  },
  scanBtnTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#1976d2',
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 20,
  },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#1976d2',
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 12,
  },
  scanBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  manualEntryLabel: { fontSize: 13, color: '#666', marginBottom: 6 },
  inventoryLocationBlock: { marginBottom: 16 },
  inventoryLocationLabel: { fontSize: 13, color: '#666', marginBottom: 6 },
  inventoryLocationReadOnly: { marginBottom: 12 },
  inventoryLocationCode: { fontSize: 14, fontWeight: '600', color: '#333' },
  inventoryLocationChosenBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#e3f2fd',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  inventoryLocationChosenText: { fontSize: 14, color: '#1565c0', fontWeight: '600' },
  inventoryLocationChangeLink: { fontSize: 14, color: '#1976d2', textDecorationLine: 'underline' },
  buttonDisabled: { opacity: 0.6 },
  inventoryChoiceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  inventoryChoiceCardIconWrap: { marginRight: 14 },
  inventoryChoiceCardBody: { flex: 1, minWidth: 0 },
  inventoryChoiceCardTitle: { fontSize: 17, fontWeight: '600', color: '#333', marginBottom: 4 },
  inventoryChoiceCardDesc: { fontSize: 13, color: '#666' },
  inventoryViewContentsLink: { alignItems: 'center', paddingVertical: 12, marginBottom: 16 },
  inventoryViewContentsLinkText: { fontSize: 15, color: '#1976d2', textDecorationLine: 'underline' },
  changeProductBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 8, marginBottom: 16 },
  changeProductBtnText: { fontSize: 15, color: '#1976d2', textDecorationLine: 'underline' },
  inventoryScanAnotherBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 8 },
  inventoryScanAnotherBtnText: { fontSize: 15, color: '#1976d2', textDecorationLine: 'underline' },
  locationWrap: { marginBottom: 12 },
  locationInputFull: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#333',
  },
  locationDropdownInline: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    height: 220,
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  locationDropdownScroll: { flex: 1 },
  locationDropdownScrollContent: { paddingBottom: 8 },
  locationDropdownEmpty: { padding: 20, alignItems: 'center' },
  locationDropdownEmptyText: { fontSize: 14, color: '#666' },
  locationDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  locationDropdownItemSelected: { backgroundColor: '#e8f5e9' },
  locationDropdownItemCode: { fontSize: 14, fontWeight: '600', color: '#333', marginRight: 8 },
  locationDropdownItemName: { fontSize: 12, color: '#666', flex: 1 },
  locationRows: { marginBottom: 12 },
  manualLocationRow: { marginTop: 8, marginBottom: 12 },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  locationRowSelected: { backgroundColor: '#c8e6c9', borderColor: '#2e7d32' },
  locationRowText: { fontSize: 14, color: '#333', flex: 1 },
  locationRowTextSelected: { color: '#1b5e20', fontWeight: '600' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  loadingText: { fontSize: 14, color: '#666' },
  errorRow: { marginBottom: 12 },
  errorText: { fontSize: 14, color: '#c62828' },
  card: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  productName: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 12 },
  label: { fontSize: 13, color: '#666', marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  expiryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  expiryInputTouchable: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#fff',
    justifyContent: 'center',
  },
  expiryInputText: { fontSize: 16, color: '#333' },
  expiryInputPlaceholder: { color: '#999' },
  expiryCalendarBtn: {
    width: 48,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLineBtn: {
    backgroundColor: '#1a237e',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  addLineBtnDisabled: { backgroundColor: '#9e9e9e', opacity: 0.8 },
  addLineBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 12 },
  sectionLabel: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 8 },
  muted: { fontSize: 14, color: '#666', marginBottom: 12 },
  contentsList: { marginBottom: 16 },
  contentsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  contentsRowInfo: { flex: 1, minWidth: 0, marginRight: 12 },
  contentsRowName: { fontSize: 14, color: '#333', fontWeight: '500' },
  contentsRowMeta: { fontSize: 12, color: '#666', marginTop: 2 },
  contentsActualInput: {
    width: 72,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 14,
    textAlign: 'center',
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  lineInfo: { flex: 1 },
  lineProduct: { fontSize: 15, color: '#333', fontWeight: '500' },
  lineMeta: { fontSize: 13, color: '#666', marginTop: 2 },
  primaryBtn: {
    backgroundColor: '#1a237e',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  primaryBtnSmall: { marginTop: 8 },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#1a237e',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  secondaryBtnText: { fontSize: 16, color: '#1a237e', fontWeight: '500' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: { fontSize: 18, fontWeight: '600', color: '#333' },
  modalList: { maxHeight: 320 },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  modalItemActive: { backgroundColor: '#e8eaf6' },
  modalItemText: { fontSize: 16, color: '#333' },
});
