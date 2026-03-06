/**
 * Qaytgan mahsulotlar — skaner, miqdor, lokatsiya, yakunlash, yig'uvchini tanlab yuborish.
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
import { useTheme } from '../theme/ThemeContext';
import { useNetwork } from '../network';
import { getPickerProductDetail, type PickerProductDetailResponse, type PickerProductLocation } from '../api/inventory';
import { getPickers, type PickerUser } from '../api/picking';
import { AppHeader } from '../components/AppHeader';
import { BarcodeSearchInput } from '../components/BarcodeSearchInput';
import { formatExpiryDisplay } from '../components/ExpiryDatePicker';

type Nav = StackNavigationProp<RootStackParamList, 'Returns'>;
type ReturnsRoute = RouteProp<RootStackParamList, 'Returns'>;

type ReturnLine = {
  id: string;
  productId: string;
  productName: string;
  locationCode: string;
  locationId: string;
  lotId: string;
  qty: number;
};

/** Lokatsiyalarni muddat bo'yicha keyin miqdor bo'yicha tartiblash (FEFO, keyin eng ko'p mavjud) */
function sortLocations(locs: PickerProductLocation[]): PickerProductLocation[] {
  return [...locs].sort((a, b) => {
    const expA = a.expiry_date ? new Date(a.expiry_date).getTime() : Infinity;
    const expB = b.expiry_date ? new Date(b.expiry_date).getTime() : Infinity;
    if (expA !== expB) return expA - expB;
    return Number(b.available_qty) - Number(a.available_qty);
  });
}

export function ReturnsScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ReturnsRoute>();
  const { t, locale } = useLocale();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { isOnline } = useNetwork();
  const params = route.params as { scannedProductId?: string; scannedBarcode?: string } | undefined;

  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [finished, setFinished] = useState(false);
  const [currentProduct, setCurrentProduct] = useState<PickerProductDetailResponse | null>(null);
  const [currentQty, setCurrentQty] = useState('');
  const [currentLocation, setCurrentLocation] = useState<PickerProductLocation | null>(null);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const [pickerModalVisible, setPickerModalVisible] = useState(false);
  const [pickers, setPickers] = useState<PickerUser[]>([]);
  const [selectedPickerId, setSelectedPickerId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [barcodeSearchValue, setBarcodeSearchValue] = useState('');

  const loadProductByScan = useCallback(async (productId: string) => {
    setLoadingProduct(true);
    setProductError(null);
    setCurrentProduct(null);
    setCurrentLocation(null);
    setCurrentQty('');
    try {
      const res = await getPickerProductDetail(productId);
      setCurrentProduct(res);
      const sorted = sortLocations(res.locations);
      if (sorted.length > 0) setCurrentLocation(sorted[0]);
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
        loadProductByScan(pid);
        navigation.setParams({ scannedProductId: undefined, scannedBarcode: undefined } as any);
      }
    }, [params?.scannedProductId, loadProductByScan, navigation])
  );

  useEffect(() => {
    if (pickerModalVisible && isOnline) {
      getPickers().then(setPickers).catch(() => setPickers([]));
    }
  }, [pickerModalVisible, isOnline]);

  const handleScan = useCallback(() => {
    navigation.navigate('Scanner', { returnToReturns: true });
  }, [navigation]);

  const addLine = useCallback(() => {
    if (!currentProduct || !currentLocation) return;
    const qty = Math.floor(Number(currentQty) || 0);
    const maxQty = Number(currentLocation.available_qty);
    if (qty < 1 || qty > maxQty) {
      Alert.alert(t('error'), t('qtyRangeError', { max: maxQty }));
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        id: `${currentProduct.product_id}-${currentLocation.lot_id}-${Date.now()}`,
        productId: currentProduct.product_id,
        productName: currentProduct.name,
        locationCode: currentLocation.location_code,
        locationId: currentLocation.location_id,
        lotId: currentLocation.lot_id,
        qty,
      },
    ]);
    setCurrentProduct(null);
    setCurrentLocation(null);
    setCurrentQty('');
    setLocationDropdownOpen(false);
  }, [currentProduct, currentLocation, currentQty, t]);

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

  const handleSendToPicker = useCallback(() => {
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
  }, [selectedPickerId, t]);

  const locations = currentProduct ? sortLocations(currentProduct.locations) : [];
  const canAddLine = currentProduct && currentLocation && currentQty.trim().length > 0;

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]} edges={['top']}>
      <AppHeader
        title={t('returnsTitle')}
        showLogo={false}
        showBack={true}
        onBack={() => navigation.goBack()}
      />

      <ScrollView style={[styles.scroll, isDark && styles.scrollDark]} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Shtrix maydoni eng yuqorida — dropdown uchun joy */}
        <Text style={[styles.manualEntryLabel, isDark && styles.manualEntryLabelDark]}>{t('kirimManualEntry')}</Text>
        <BarcodeSearchInput
          value={barcodeSearchValue}
          onChangeText={setBarcodeSearchValue}
          onSelectProduct={(productId) => loadProductByScan(productId)}
          placeholder={t('kirimBarcodePlaceholder')}
          emptyLabel={t('barcodeSearchNoResults')}
          loading={loadingProduct}
          error={productError}
          onClearError={() => setProductError(null)}
          dropdownMaxHeight={200}
        />
        <TouchableOpacity style={styles.scanBtn} onPress={handleScan} activeOpacity={0.8}>
          <Icon name="barcode-scan" size={32} color="#fff" />
          <Text style={styles.scanBtnText}>{t('scanButton')}</Text>
        </TouchableOpacity>

        {loadingProduct && (
          <View style={[styles.loadingRow, isDark && styles.loadingRowDark]}>
            <ActivityIndicator size="small" color={isDark ? '#93c5fd' : '#1a237e'} />
            <Text style={[styles.loadingText, isDark && styles.loadingTextDark]}>{t('loading')}</Text>
          </View>
        )}

        {productError && (
          <View style={styles.errorRow}>
            <Text style={[styles.errorText, isDark && styles.errorTextDark]}>{productError}</Text>
          </View>
        )}

        {/* Current product: quantity + location */}
        {currentProduct && !loadingProduct && (
          <View style={[styles.card, isDark && styles.cardDark]}>
            <Text style={[styles.productName, isDark && styles.productNameDark]} numberOfLines={2}>{currentProduct.name}</Text>
            <Text style={[styles.label, isDark && styles.labelDark]}>{t('quantity')}</Text>
            <TextInput
              style={[styles.input, isDark && styles.inputDark]}
              value={currentQty}
              onChangeText={setCurrentQty}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={isDark ? '#64748b' : '#999'}
            />
            <Text style={[styles.label, isDark && styles.labelDark]}>{t('locationLabel')}</Text>
            <TouchableOpacity
              style={[styles.dropdownTrigger, isDark && styles.dropdownTriggerDark]}
              onPress={() => setLocationDropdownOpen((v) => !v)}
            >
              <Text style={[styles.dropdownTriggerText, isDark && styles.dropdownTriggerTextDark]}>
                {currentLocation ? currentLocation.location_code : t('returnsSelectLocation')}
              </Text>
              <Icon name={locationDropdownOpen ? 'chevron-up' : 'chevron-down'} size={22} color={isDark ? '#94a3b8' : '#555'} />
            </TouchableOpacity>
            {locationDropdownOpen && (
              <>
                <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setLocationDropdownOpen(false)} />
                <View style={[styles.dropdown, isDark && styles.dropdownDark]}>
                  {locations.map((loc) => (
                    <TouchableOpacity
                      key={loc.lot_id + loc.location_id}
                      style={[styles.dropdownItem, isDark && styles.dropdownItemDark]}
                      onPress={() => {
                        setCurrentLocation(loc);
                        setLocationDropdownOpen(false);
                      }}
                    >
                      <Text style={[styles.dropdownItemText, isDark && styles.dropdownItemTextDark]}>
                        {loc.location_code} — {loc.batch_no} {loc.expiry_date ? `(${formatExpiryDisplay(loc.expiry_date, locale)})` : ''} — {Math.round(Number(loc.available_qty))} {t('invAvailable')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
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

        {/* List of added lines */}
        {lines.length > 0 && (
          <View style={[styles.card, isDark && styles.cardDark]}>
            <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}>{t('returnsLines')} ({lines.length})</Text>
            {lines.map((line) => (
              <View key={line.id} style={[styles.lineRow, isDark && styles.lineRowDark]}>
                <View style={styles.lineInfo}>
                  <Text style={[styles.lineProduct, isDark && styles.lineProductDark]} numberOfLines={1}>{line.productName}</Text>
                  <Text style={[styles.lineMeta, isDark && styles.lineMetaDark]}>{line.locationCode} · {line.qty} dona</Text>
                </View>
                <TouchableOpacity onPress={() => removeLine(line.id)} hitSlop={12}>
                  <Icon name="close-circle-outline" size={24} color={isDark ? '#f87171' : '#c62828'} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Yakunlash */}
        {lines.length > 0 && !finished && (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleYakunlash}>
            <Text style={styles.primaryBtnText}>{t('returnsFinish')}</Text>
          </TouchableOpacity>
        )}

        {/* Yig'uvchini tanlab yuborish */}
        {finished && lines.length > 0 && (
          <View style={[styles.card, isDark && styles.cardDark]}>
            <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}>{t('returnsAssignPicker')}</Text>
            <TouchableOpacity
              style={[styles.secondaryBtn, isDark && styles.secondaryBtnDark]}
              onPress={() => setPickerModalVisible(true)}
            >
              <Text style={[styles.secondaryBtnText, isDark && styles.secondaryBtnTextDark]}>
                {selectedPickerId
                  ? pickers.find((p) => p.id === selectedPickerId)?.full_name || pickers.find((p) => p.id === selectedPickerId)?.username
                  : t('returnsSelectPicker')}
              </Text>
              <Icon name="account-outline" size={22} color={isDark ? '#93c5fd' : '#1a237e'} />
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

      {/* Picker modal */}
      <Modal
        visible={pickerModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerModalVisible(false)}
      >
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setPickerModalVisible(false)}>
          <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
            <View style={[styles.modalHeader, isDark && styles.modalHeaderDark]}>
              <Text style={[styles.modalTitle, isDark && styles.modalTitleDark]}>{t('returnsSelectPicker')}</Text>
              <TouchableOpacity onPress={() => setPickerModalVisible(false)}>
                <Icon name="close" size={24} color={isDark ? '#e2e8f0' : '#333'} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalList}>
              {pickers.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.modalItem, selectedPickerId === p.id && styles.modalItemActive, isDark && styles.modalItemDark, selectedPickerId === p.id && isDark && styles.modalItemActiveDark]}
                  onPress={() => setSelectedPickerId(p.id)}
                >
                  <Text style={[styles.modalItemText, isDark && styles.modalItemTextDark]}>{p.full_name || p.username}</Text>
                  {selectedPickerId === p.id && <Icon name="check-circle" size={22} color={isDark ? '#93c5fd' : '#1a237e'} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#1976d2',
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 20,
  },
  scanBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  manualEntryLabel: { fontSize: 13, color: '#666', marginTop: 8, marginBottom: 6 },
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
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  dropdownTriggerText: { fontSize: 15, color: '#333' },
  dropdown: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    maxHeight: 200,
    marginBottom: 12,
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownItemText: { fontSize: 14, color: '#333', flex: 1 },
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
  containerDark: { backgroundColor: '#0f172a' },
  scrollDark: {},
  manualEntryLabelDark: { color: '#94a3b8' },
  loadingRowDark: {},
  loadingTextDark: { color: '#94a3b8' },
  errorTextDark: { color: '#f87171' },
  cardDark: { backgroundColor: '#1e293b' },
  productNameDark: { color: '#f1f5f9' },
  labelDark: { color: '#94a3b8' },
  inputDark: { borderColor: '#334155', backgroundColor: '#1e293b', color: '#f1f5f9' },
  dropdownTriggerDark: { borderColor: '#334155', backgroundColor: '#1e293b' },
  dropdownTriggerTextDark: { color: '#f1f5f9' },
  dropdownDark: { backgroundColor: '#1e293b', borderColor: '#334155' },
  dropdownItemDark: { borderBottomColor: '#334155' },
  dropdownItemTextDark: { color: '#e2e8f0' },
  sectionTitleDark: { color: '#e2e8f0' },
  lineRowDark: { borderBottomColor: '#334155' },
  lineProductDark: { color: '#f1f5f9' },
  lineMetaDark: { color: '#94a3b8' },
  secondaryBtnDark: { borderColor: '#60a5fa' },
  secondaryBtnTextDark: { color: '#93c5fd' },
  modalContentDark: { backgroundColor: '#1e293b' },
  modalHeaderDark: { borderBottomColor: '#334155' },
  modalTitleDark: { color: '#f1f5f9' },
  modalItemDark: { borderBottomColor: '#334155' },
  modalItemActiveDark: { backgroundColor: '#1e3a5f' },
  modalItemTextDark: { color: '#f1f5f9' },
});
