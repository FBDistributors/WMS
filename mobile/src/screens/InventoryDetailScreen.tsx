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
import {
  getPickerProductDetail,
  type PickerProductDetailResponse,
} from '../api/inventory';

type Nav = StackNavigationProp<RootStackParamList, 'InventoryDetail'>;
type DetailRoute = RouteProp<RootStackParamList, 'InventoryDetail'>;

function formatExpiry(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

export function InventoryDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const { t } = useLocale();
  const productId = route.params?.productId;
  const [data, setData] = useState<PickerProductDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getPickerProductDetail(productId);
      setData(res);
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
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon name="arrow-left" size={24} color="#1a237e" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('invTitle')}</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#1a237e" />
        </View>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon name="arrow-left" size={24} color="#1a237e" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('invTitle')}</Text>
        </View>
        <View style={styles.centered}>
          <Icon name="alert-circle-outline" size={48} color="#c62828" />
          <Text style={styles.errorText}>{error ?? t('invNoResults')}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryBtnText}>{t('invRetry')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="arrow-left" size={24} color="#1a237e" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{data.name}</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.productName}>{data.name}</Text>
          {data.main_barcode ? (
            <Text style={styles.barcode}>Barcode: {data.main_barcode}</Text>
          ) : null}
        </View>
        <Text style={styles.sectionLabel}>{t('invMoreLocations')}</Text>
        {data.locations.map((loc) => (
          <View key={`${loc.location_id}-${loc.lot_id}`} style={styles.locCard}>
            <View style={styles.locRow}>
              <Text style={styles.locCode}>{loc.location_code}</Text>
              <Text style={styles.locExpiry}>{formatExpiry(loc.expiry_date)}</Text>
            </View>
            <Text style={styles.locMeta}>
              Batch: {loc.batch_no} • On hand: {loc.on_hand_qty} • Reserved:{' '}
              {loc.reserved_qty} • Available: {loc.available_qty}
            </Text>
          </View>
        ))}
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
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 10,
  },
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
});
