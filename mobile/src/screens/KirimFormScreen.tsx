/**
 * Kirim forma — flow: new (yangi mahsulotlar) yoki return (mijozdan qaytgan).
 * Skan, miqdor, lokatsiya avtomat (FEFO), qatorlar, yakunlash; return da yig'uvchiga yuborish.
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { useNetwork } from '../network';
import { getPickerProductDetail, getInventoryByBarcode, listPickerLocations, type PickerProductDetailResponse, type PickerProductLocation, type PickerLocationOption } from '../api/inventory';
import { getPickers, type PickerUser } from '../api/picking';
import { createReceipt, completeReceipt } from '../api/receiving';
import { AppHeader } from '../components/AppHeader';

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

const CALENDAR_YEARS = (() => {
  const current = new Date().getFullYear();
  const out: number[] = [];
  for (let y = current - 2; y <= current + 12; y++) out.push(y);
  return out;
})();

const MONTH_NAMES = [
  '01', '02', '03', '04', '05', '06',
  '07', '08', '09', '10', '11', '12',
];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function KirimFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<KirimFormRoute>();
  const { t } = useLocale();
  const { isOnline } = useNetwork();
  const flow = route.params?.flow ?? 'return';
  const params = route.params as { flow: 'new' | 'return'; scannedProductId?: string; scannedBarcode?: string } | undefined;

  const [lines, setLines] = useState<FormLine[]>([]);
  const [finished, setFinished] = useState(false);
  const [currentProduct, setCurrentProduct] = useState<PickerProductDetailResponse | null>(null);
  const [currentQty, setCurrentQty] = useState('');
  const [currentBatch, setCurrentBatch] = useState('');
  const [currentExpiry, setCurrentExpiry] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<PickerLocationOption | null>(null);
  const [allLocations, setAllLocations] = useState<PickerLocationOption[]>([]);
  const [locationSearch, setLocationSearch] = useState('');
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [pickerModalVisible, setPickerModalVisible] = useState(false);
  const [pickers, setPickers] = useState<PickerUser[]>([]);
  const [selectedPickerId, setSelectedPickerId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [expiryCalendarOpen, setExpiryCalendarOpen] = useState(false);
  const [calendarStep, setCalendarStep] = useState<'year' | 'month' | 'day'>('year');
  const [pickerYear, setPickerYear] = useState<number | null>(null);
  const [pickerMonth, setPickerMonth] = useState<number | null>(null);

  const title = flow === 'new' ? t('kirimNewProducts') : t('kirimCustomerReturns');

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

  const handleManualFind = useCallback(async () => {
    const barcode = manualBarcode.trim();
    if (!barcode) {
      setProductError(t('kirimBarcodePlaceholder'));
      return;
    }
    setLoadingProduct(true);
    setProductError(null);
    setCurrentProduct(null);
    setCurrentQty('');
    try {
      const byBarcode = await getInventoryByBarcode(barcode);
      const res = await getPickerProductDetail(byBarcode.product_id);
      setCurrentProduct(res);
      setManualBarcode('');
    } catch (e) {
      setProductError(e instanceof Error ? e.message : t('invLoadError'));
    } finally {
      setLoadingProduct(false);
    }
  }, [manualBarcode, t]);

  useFocusEffect(
    useCallback(() => {
      const pid = params?.scannedProductId;
      if (pid) {
        loadProductById(pid);
        navigation.setParams({ flow: route.params?.flow ?? 'return', scannedProductId: undefined, scannedBarcode: undefined } as any);
      }
    }, [params?.scannedProductId, loadProductById, navigation, route.params])
  );

  useEffect(() => {
    if (isOnline) {
      listPickerLocations().then(setAllLocations).catch(() => setAllLocations([]));
    }
  }, [isOnline]);

  useEffect(() => {
    if (!currentProduct || allLocations.length === 0) return;
    setSelectedLocation((prev) => {
      if (prev != null) return prev;
      const sorted = sortLocations(currentProduct.locations);
      const firstCode = sorted.length > 0 ? sorted[0].location_code : null;
      const found = firstCode ? allLocations.find((l) => l.code === firstCode) : null;
      return found ?? allLocations[0] ?? null;
    });
  }, [currentProduct?.product_id, allLocations.length]);

  useEffect(() => {
    if (pickerModalVisible && isOnline && flow === 'return') {
      getPickers().then(setPickers).catch(() => setPickers([]));
    }
  }, [pickerModalVisible, isOnline, flow]);

  const handleScan = useCallback(() => {
    navigation.navigate('Scanner', { returnToKirimForm: true, flow });
  }, [navigation, flow]);

  const addLine = useCallback(() => {
    if (!currentProduct || !selectedLocation) return;
    const qty = Math.floor(Number(currentQty) || 0);
    // Kirim: dono qo‘shiladi, mavjud zaxoraga bog‘lamaymiz; faqat 1–99999 oralig‘ida
    const maxQty = 99999;
    if (qty < 1 || qty > maxQty) {
      Alert.alert(t('error'), t('qtyRangeError', { max: maxQty }));
      return;
    }
    const batch = currentBatch.trim();
    if (batch.length < 1 || batch.length > 64) {
      Alert.alert(t('error'), t('kirimBatchRequired'));
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
        id: `${currentProduct.product_id}-${selectedLocation.id}-${Date.now()}`,
        productId: currentProduct.product_id,
        productName: currentProduct.name,
        locationCode: selectedLocation.code,
        locationId: selectedLocation.id,
        lotId: '',
        qty,
        batch,
        expiryDate: expiryVal,
      },
    ]);
    setCurrentProduct(null);
    setCurrentQty('');
    setCurrentBatch('');
    setCurrentExpiry('');
  }, [currentProduct, selectedLocation, currentQty, currentBatch, currentExpiry, t]);

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
          batch: l.batch,
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
      const msg = e && typeof e === 'object' && 'response' in e && e.response && typeof e.response === 'object' && 'data' in e.response
        ? (e.response as { data?: { detail?: string } }).data?.detail
        : e instanceof Error ? e.message : t('kirimSubmitError');
      Alert.alert(t('error'), String(msg));
    } finally {
      setSending(false);
    }
  }, [flow, selectedPickerId, lines, t]);

  const filteredLocations = locationSearch.trim()
    ? allLocations
        .filter(
          (l) =>
            l.code.toLowerCase().includes(locationSearch.toLowerCase()) ||
            (l.name && l.name.toLowerCase().includes(locationSearch.toLowerCase()))
        )
        .slice(0, 10)
    : allLocations.slice(0, 10);
  const canAddLine = currentProduct && selectedLocation && currentQty.trim().length > 0 && currentBatch.trim().length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader
        title={title}
        showLogo={false}
        showBack={true}
        onBack={() => navigation.goBack()}
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {loadingProduct && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#1a237e" />
            <Text style={styles.loadingText}>{t('loading')}</Text>
          </View>
        )}

        {productError && (
          <View style={styles.errorRow}>
            <Text style={styles.errorText}>{productError}</Text>
          </View>
        )}

        {currentProduct && !loadingProduct && (
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
            <Text style={styles.label}>{t('locationLabel')}</Text>
            <View style={styles.locationInputRow}>
              <TextInput
                style={styles.locationInput}
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
              <TouchableOpacity
                style={styles.locationDropdownBtn}
                onPress={() => setLocationDropdownOpen(true)}
              >
                <Icon name="chevron-down" size={24} color="#1a237e" />
              </TouchableOpacity>
            </View>
            <Text style={styles.label}>{t('kirimBatchLabel')}</Text>
            <TextInput
              style={styles.input}
              value={currentBatch}
              onChangeText={setCurrentBatch}
              placeholder={t('kirimBatchPlaceholder')}
              placeholderTextColor="#999"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Text style={styles.label}>{t('kirimExpiryLabel')}</Text>
            <View style={styles.expiryRow}>
              <TextInput
                style={styles.expiryInput}
                value={currentExpiry}
                onChangeText={setCurrentExpiry}
                placeholder={t('kirimExpiryPlaceholder')}
                placeholderTextColor="#999"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.expiryCalendarBtn}
                onPress={() => {
                  setPickerYear(null);
                  setPickerMonth(null);
                  setCalendarStep('year');
                  setExpiryCalendarOpen(true);
                }}
              >
                <Icon name="calendar" size={24} color="#1a237e" />
              </TouchableOpacity>
            </View>
            {locationDropdownOpen && (
              <Modal
                visible={locationDropdownOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setLocationDropdownOpen(false)}
              >
                <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setLocationDropdownOpen(false)}>
                  <TouchableOpacity style={styles.locationDropdownModal} activeOpacity={1} onPress={() => {}}>
                    <ScrollView style={styles.locationDropdownList} keyboardShouldPersistTaps="handled">
                      {filteredLocations.map((loc) => (
                        <TouchableOpacity
                          key={loc.id}
                          style={[styles.locationDropdownItem, selectedLocation?.id === loc.id && styles.locationDropdownItemSelected]}
                          onPress={() => {
                            setSelectedLocation(loc);
                            setLocationSearch(loc.code);
                            setLocationDropdownOpen(false);
                          }}
                        >
                          <Text style={styles.locationDropdownItemCode} numberOfLines={1}>{loc.code}</Text>
                          {loc.name && loc.name !== loc.code ? <Text style={styles.locationDropdownItemName} numberOfLines={1}>{loc.name}</Text> : null}
                          {selectedLocation?.id === loc.id ? <Icon name="check-circle" size={20} color="#2e7d32" /> : null}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </TouchableOpacity>
                </TouchableOpacity>
              </Modal>
            )}

            {expiryCalendarOpen && (
              <Modal
                visible={expiryCalendarOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setExpiryCalendarOpen(false)}
              >
                <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setExpiryCalendarOpen(false)}>
                  <View style={styles.calendarModal} onStartShouldSetResponder={() => true}>
                    <View style={styles.calendarHeader}>
                      {calendarStep !== 'year' ? (
                        <TouchableOpacity
                          onPress={() => {
                            if (calendarStep === 'day') {
                              setCalendarStep('month');
                            } else {
                              setPickerYear(null);
                              setPickerMonth(null);
                              setCalendarStep('year');
                            }
                          }}
                          style={styles.calendarBackBtn}
                        >
                          <Icon name="chevron-left" size={24} color="#1a237e" />
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.calendarBackBtn} />
                      )}
                      <Text style={styles.calendarTitle}>
                        {calendarStep === 'year' && t('kirimExpiryLabel')}
                        {calendarStep === 'month' && pickerYear != null && `${pickerYear}`}
                        {calendarStep === 'day' && pickerYear != null && pickerMonth != null && `${pickerYear}-${String(pickerMonth).padStart(2, '0')}`}
                      </Text>
                      <TouchableOpacity onPress={() => setExpiryCalendarOpen(false)}>
                        <Icon name="close" size={24} color="#333" />
                      </TouchableOpacity>
                    </View>
                    {calendarStep === 'year' && (
                      <View style={styles.calendarGrid}>
                        {CALENDAR_YEARS.map((y) => (
                          <TouchableOpacity
                            key={y}
                            style={[styles.calendarCell, pickerYear === y && styles.calendarCellSelected]}
                            onPress={() => {
                              setPickerYear(y);
                              setCalendarStep('month');
                            }}
                          >
                            <Text style={[styles.calendarCellText, pickerYear === y && styles.calendarCellTextSelected]}>{y}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    {calendarStep === 'month' && pickerYear != null && (
                      <View style={styles.calendarGrid}>
                        {MONTH_NAMES.map((m, i) => (
                          <TouchableOpacity
                            key={m}
                            style={[styles.calendarCell, pickerMonth === i + 1 && styles.calendarCellSelected]}
                            onPress={() => {
                              setPickerMonth(i + 1);
                              setCalendarStep('day');
                            }}
                          >
                            <Text style={[styles.calendarCellText, pickerMonth === i + 1 && styles.calendarCellTextSelected]}>{m}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    {calendarStep === 'day' && pickerYear != null && pickerMonth != null && (() => {
                      const days = getDaysInMonth(pickerYear, pickerMonth);
                      const dayNumbers = Array.from({ length: days }, (_, i) => i + 1);
                      return (
                        <View style={styles.calendarGrid}>
                          {dayNumbers.map((d) => {
                            const dateStr = `${pickerYear}-${String(pickerMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                            return (
                              <TouchableOpacity
                                key={d}
                                style={styles.calendarCell}
                                onPress={() => {
                                  setCurrentExpiry(dateStr);
                                  setExpiryCalendarOpen(false);
                                }}
                              >
                                <Text style={styles.calendarCellText}>{String(d).padStart(2, '0')}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      );
                    })()}
                  </View>
                </TouchableOpacity>
              </Modal>
            )}

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
                  <Text style={styles.lineMeta}>{line.locationCode} · {line.qty} dona · {line.batch}{line.expiryDate ? ` · ${line.expiryDate}` : ''}</Text>
                </View>
                <TouchableOpacity onPress={() => removeLine(line.id)} hitSlop={12}>
                  <Icon name="close-circle-outline" size={24} color="#c62828" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {lines.length > 0 && !finished && (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleYakunlash}>
            <Text style={styles.primaryBtnText}>{t('returnsFinish')}</Text>
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

        {finished && lines.length > 0 && flow === 'new' && (
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
      </ScrollView>

      <View style={styles.scanFooter}>
        <TouchableOpacity style={styles.scanBtn} onPress={handleScan} activeOpacity={0.8}>
          <Icon name="barcode-scan" size={28} color="#fff" />
          <Text style={styles.scanBtnText}>{t('scanButton')}</Text>
        </TouchableOpacity>
        <View style={styles.manualEntryBlock}>
          <Text style={styles.manualEntryLabel}>{t('kirimManualEntry')}</Text>
          <View style={styles.manualEntryRow}>
            <TextInput
              style={styles.manualBarcodeInput}
              value={manualBarcode}
              onChangeText={(text) => { setManualBarcode(text); setProductError(null); }}
              placeholder={t('kirimBarcodePlaceholder')}
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.findProductBtn} onPress={handleManualFind} disabled={loadingProduct}>
              <Text style={styles.findProductBtnText}>{t('kirimFindProduct')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

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
  scanFooter: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
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
  manualEntryBlock: { marginTop: 8 },
  manualEntryLabel: { fontSize: 13, color: '#666', marginBottom: 6 },
  manualEntryRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  manualBarcodeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  findProductBtn: {
    backgroundColor: '#1a237e',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    justifyContent: 'center',
  },
  findProductBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  locationInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  locationInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#333',
  },
  locationDropdownBtn: {
    width: 48,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationDropdownModal: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginHorizontal: 24,
    maxHeight: 280,
    paddingTop: 12,
  },
  locationDropdownList: { maxHeight: 260 },
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
  expiryInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
  },
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
  calendarModal: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: 20,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  calendarBackBtn: { width: 40, alignItems: 'flex-start' },
  calendarTitle: { fontSize: 18, fontWeight: '600', color: '#333', flex: 1, textAlign: 'center' },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    gap: 8,
    justifyContent: 'flex-start',
  },
  calendarCell: {
    width: '22%',
    minWidth: 72,
    aspectRatio: 1.2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarCellSelected: {
    backgroundColor: '#e8eaf6',
    borderColor: '#1a237e',
  },
  calendarCellText: { fontSize: 16, color: '#333', fontWeight: '500' },
  calendarCellTextSelected: { color: '#1a237e', fontWeight: '600' },
  addLineBtn: {
    backgroundColor: '#1a237e',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  addLineBtnDisabled: { backgroundColor: '#9e9e9e', opacity: 0.8 },
  addLineBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 12 },
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
