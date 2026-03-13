/**
 * Mahsulot bo'yicha inventar tafsiloti — webapp PickerInventoryDetailPage ga mos.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { useTheme } from '../theme/ThemeContext';
import {
  getPickerProductDetail,
  type PickerProductDetailResponse,
  type PickerProductLocation,
} from '../api/inventory';
import { formatExpiryDisplay } from '../components/ExpiryDatePicker';

type Nav = StackNavigationProp<RootStackParamList, 'InventoryDetail'>;
type DetailRoute = RouteProp<RootStackParamList, 'InventoryDetail'>;

function LocationBlock({
  title,
  locations,
  t,
  locale,
  isDark,
}: {
  title: string;
  locations: PickerProductLocation[];
  t: (key: string) => string;
  locale: string;
  isDark: boolean;
}) {
  return (
    <>
      <Text style={[styles.sectionLabel, isDark && styles.sectionLabelDark]}>{title}</Text>
      {locations.length === 0 ? (
        <Text style={[styles.emptyLocations, isDark && styles.emptyLocationsDark]}>{t('invNoResults')}</Text>
      ) : (
        locations.map((loc) => (
          <View key={`${loc.location_id}-${loc.lot_id}`} style={[styles.locCard, isDark && styles.locCardDark]}>
            <View style={styles.locRow}>
              <Text style={[styles.locCode, isDark && styles.locCodeDark]}>{loc.location_code}</Text>
              <Text style={[styles.locExpiry, isDark && styles.locExpiryDark]}>{formatExpiryDisplay(loc.expiry_date, locale)}</Text>
            </View>
            <Text style={[styles.locMeta, isDark && styles.locMetaDark]}>
              {t('invQoldiq')}: {Math.round(Number(loc.available_qty))}
            </Text>
          </View>
        ))
      )}
    </>
  );
}

export function InventoryDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const { t, locale } = useLocale();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const productId = route.params?.productId;
  const [dataMain, setDataMain] = useState<PickerProductDetailResponse | null>(null);
  const [dataShowroom, setDataShowroom] = useState<PickerProductDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const [resMain, resShowroom] = await Promise.all([
        getPickerProductDetail(productId, 'main'),
        getPickerProductDetail(productId, 'showroom'),
      ]);
      setDataMain(resMain);
      setDataShowroom(resShowroom);
    } catch {
      setError(t('invLoadError'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (!productId) {
    navigation.goBack();
    return null;
  }

  if (loading) {
    return (
      <View style={[styles.container, isDark && styles.containerDark]}>
        <View style={[styles.header, isDark && styles.headerDark]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon name="arrow-left" size={24} color={isDark ? '#93c5fd' : '#1a237e'} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, isDark && styles.headerTitleDark]}>{t('invTitle')}</Text>
        </View>
        <View style={[styles.centered, isDark && styles.centeredDark]}>
          <ActivityIndicator size="large" color={isDark ? '#93c5fd' : '#1a237e'} />
        </View>
      </View>
    );
  }

  if (error || (!dataMain && !dataShowroom)) {
    return (
      <View style={[styles.container, isDark && styles.containerDark]}>
        <View style={[styles.header, isDark && styles.headerDark]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon name="arrow-left" size={24} color={isDark ? '#93c5fd' : '#1a237e'} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, isDark && styles.headerTitleDark]}>{t('invTitle')}</Text>
        </View>
        <View style={[styles.centered, isDark && styles.centeredDark]}>
          <Icon name="alert-circle-outline" size={48} color="#f87171" />
          <Text style={[styles.errorText, isDark && styles.errorTextDark]}>{error ?? t('invNoResults')}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryBtnText}>{t('invRetry')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="arrow-left" size={24} color={isDark ? '#93c5fd' : '#1a237e'} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, isDark && styles.headerTitleDark]} numberOfLines={1}>{dataMain?.name ?? dataShowroom?.name ?? ''}</Text>
      </View>
      <ScrollView style={[styles.scroll, isDark && styles.scrollDark]} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.card, isDark && styles.cardDark]}>
          <Text style={[styles.productName, isDark && styles.productNameDark]}>{dataMain?.name ?? dataShowroom?.name ?? ''}</Text>
          {(dataMain?.main_barcode ?? dataShowroom?.main_barcode) ? (
            <Text style={[styles.barcode, isDark && styles.barcodeDark]}>{t('invShtrixKod')}: {dataMain?.main_barcode ?? dataShowroom?.main_barcode ?? ''}</Text>
          ) : null}
          <Text style={[styles.productCode, isDark && styles.productCodeDark]}>{t('invKod')}: {dataMain?.code ?? dataShowroom?.code ?? ''}</Text>
        </View>

        <LocationBlock title={t('kirimWarehouseMain')} locations={dataMain?.locations ?? []} t={t} locale={locale} isDark={isDark} />
        <LocationBlock title={t('kirimWarehouseShowroom')} locations={dataShowroom?.locations ?? []} t={t} locale={locale} isDark={isDark} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: {
    marginRight: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  productName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
  },
  barcode: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  productCode: {
    fontSize: 14,
    color: '#1a237e',
    fontWeight: '600',
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 10,
    marginTop: 8,
  },
  emptyLocations: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  emptyLocationsDark: { color: '#64748b' },
  locCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  locRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  locCode: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  locExpiry: {
    fontSize: 13,
    color: '#666',
  },
  locMeta: {
    fontSize: 12,
    color: '#666',
    marginTop: 6,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    marginTop: 12,
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#1a237e',
    borderRadius: 10,
  },
  retryBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  // Dark
  containerDark: { backgroundColor: '#0f172a' },
  headerDark: { backgroundColor: '#1e293b', borderBottomColor: '#334155' },
  headerTitleDark: { color: '#f1f5f9' },
  scrollDark: { backgroundColor: '#0f172a' },
  cardDark: { backgroundColor: '#1e293b' },
  productNameDark: { color: '#f1f5f9' },
  barcodeDark: { color: '#94a3b8' },
  productCodeDark: { color: '#93c5fd' },
  sectionLabelDark: { color: '#94a3b8' },
  locCardDark: { backgroundColor: '#1e293b' },
  locCodeDark: { color: '#f1f5f9' },
  locExpiryDark: { color: '#94a3b8' },
  locMetaDark: { color: '#94a3b8' },
  centeredDark: { backgroundColor: '#0f172a' },
  errorTextDark: { color: '#fca5a5' },
});
