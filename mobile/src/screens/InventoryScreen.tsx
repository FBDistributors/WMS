/**
 * Inventar ro'yxati — webapp PickerInventoryPage ga mos.
 * Qidiruv, joy bo'yicha filtr, mahsulot kartalari, kengaytiriladigan joylar.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import {
  listPickerInventory,
  listPickerLocations,
  type PickerInventoryItem,
  type PickerLocationOption,
} from '../api/inventory';
import { BRAND } from '../config/branding';

type Nav = StackNavigationProp<RootStackParamList, 'Inventory'>;

function formatExpiry(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

function InventoryCard({
  item,
  expanded,
  onToggle,
  onDetails,
  t,
}: {
  item: PickerInventoryItem;
  expanded: boolean;
  onToggle: () => void;
  onDetails: () => void;
  t: (key: string) => string;
}) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onToggle}
      activeOpacity={0.8}
    >
      <View style={styles.cardRow}>
        <View style={styles.cardMain}>
          <Text style={styles.cardTitle}>{item.name}</Text>
          {item.main_barcode ? (
            <Text style={styles.cardBarcode}>{item.main_barcode}</Text>
          ) : null}
        </View>
        <Icon
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={22}
          color="#666"
        />
      </View>
      <View style={styles.cardMeta}>
        <Text style={styles.cardMetaText}>
          {t('invBestLocation')}: {item.best_location ?? '—'}
        </Text>
        <Text style={styles.cardMetaText}>
          {t('invAvailable')}: {item.available_qty}
        </Text>
        <Text style={styles.cardMetaText}>
          {t('invExpiry')}: {formatExpiry(item.nearest_expiry)}
        </Text>
      </View>
      {expanded && item.top_locations.length > 0 && (
        <View style={styles.expanded}>
          <Text style={styles.moreLabel}>{t('invMoreLocations')}</Text>
          {item.top_locations.map((lot, i) => (
            <View key={`${i}-${lot.location_code}`} style={styles.lotRow}>
              <Text style={styles.lotText}>
                {lot.location_code} / {lot.batch_no}
              </Text>
              <Text style={styles.lotText}>
                {lot.available_qty} {formatExpiry(lot.expiry_date)}
              </Text>
            </View>
          ))}
          <TouchableOpacity
            style={styles.detailsBtn}
            onPress={(e) => {
              e.stopPropagation();
              onDetails();
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.detailsBtnText}>{t('invFullDetails')} →</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

export function InventoryScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<PickerLocationOption[]>([]);
  const [items, setItems] = useState<PickerInventoryItem[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationModalVisible, setLocationModalVisible] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listPickerInventory({
        q: query || undefined,
        location_id: locationId || undefined,
        limit: 30,
      });
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('invLoadError'));
    } finally {
      setLoading(false);
    }
  }, [query, locationId, t]);

  const loadLocations = useCallback(async () => {
    try {
      const locs = await listPickerLocations();
      setLocations(locs);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  const toggleExpand = (productId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const renderItem = ({ item }: { item: PickerInventoryItem }) => (
    <InventoryCard
      item={item}
      expanded={expanded.has(item.product_id)}
      onToggle={() => toggleExpand(item.product_id)}
      onDetails={() =>
        navigation.navigate('InventoryDetail', { productId: item.product_id })
      }
      t={t}
    />
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="arrow-left" size={24} color="#1a237e" />
        </TouchableOpacity>
        <Image
          source={require('../assets/logo.png')}
          style={[styles.headerLogo, { width: BRAND.headerLogoSize, height: BRAND.headerLogoSize }]}
          resizeMode="contain"
        />
        <Text style={styles.headerTitle}>{t('invTitle')}</Text>
      </View>

      {/* Search + location */}
      <View style={styles.toolbar}>
        <View style={styles.searchWrap}>
          <Icon name="magnify" size={20} color="#666" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('invSearchPlaceholder')}
            placeholderTextColor="#999"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={load}
            returnKeyType="search"
          />
        </View>
        <TouchableOpacity style={styles.searchBtn} onPress={load} activeOpacity={0.7}>
          <Text style={styles.searchBtnText}>{t('invSearch')}</Text>
        </TouchableOpacity>
      </View>
      {locations.length > 0 && (
        <>
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>{t('invBestLocation')}:</Text>
            <TouchableOpacity
              style={styles.pickerTouch}
              onPress={() => setLocationModalVisible(true)}
              activeOpacity={0.7}
            >
              <Icon name="map-marker" size={18} color="#666" style={styles.pickerIcon} />
              <Text style={styles.pickerText}>
                {locationId
                  ? locations.find((l) => l.id === locationId)?.code ?? locationId
                  : t('invAllLocations')}
              </Text>
              <Icon name="chevron-down" size={20} color="#666" />
            </TouchableOpacity>
          </View>
          <Modal
            visible={locationModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setLocationModalVisible(false)}
          >
            <TouchableOpacity
              style={styles.modalOverlay}
              activeOpacity={1}
              onPress={() => setLocationModalVisible(false)}
            >
              <View style={styles.modalContent}>
                <TouchableOpacity
                  style={styles.modalRow}
                  onPress={() => {
                    setLocationId('');
                    setLocationModalVisible(false);
                  }}
                >
                  <Text style={styles.modalRowText}>{t('invAllLocations')}</Text>
                </TouchableOpacity>
                {locations.map((loc) => (
                  <TouchableOpacity
                    key={loc.id}
                    style={styles.modalRow}
                    onPress={() => {
                      setLocationId(loc.id);
                      setLocationModalVisible(false);
                    }}
                  >
                    <Text style={styles.modalRowText}>{loc.code} — {loc.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          </Modal>
        </>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#1a237e" />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Icon name="alert-circle-outline" size={48} color="#c62828" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load} activeOpacity={0.7}>
            <Text style={styles.retryBtnText}>{t('invRetry')}</Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Icon name="package-variant-closed" size={48} color="#666" />
          <Text style={styles.emptyText}>{t('invNoResults')}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load} activeOpacity={0.7}>
            <Text style={styles.retryBtnText}>{t('invRetry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.product_id}
          contentContainerStyle={styles.listContent}
          style={styles.list}
        />
      )}
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
  headerLogo: {
    borderRadius: 8,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    gap: 8,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 15,
    color: '#333',
  },
  searchBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#1a237e',
    borderRadius: 10,
  },
  searchBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: '#fff',
  },
  filterLabel: {
    fontSize: 14,
    color: '#666',
    marginRight: 8,
  },
  pickerTouch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pickerIcon: {
    marginRight: 6,
  },
  pickerText: {
    flex: 1,
    fontSize: 14,
    color: '#333',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    maxHeight: 360,
  },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  modalRowText: {
    fontSize: 16,
    color: '#333',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardMain: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  cardBarcode: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  cardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    gap: 12,
  },
  cardMetaText: {
    fontSize: 13,
    color: '#666',
  },
  expanded: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
  },
  moreLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  lotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  lotText: {
    fontSize: 13,
    color: '#555',
  },
  detailsBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  detailsBtnText: {
    fontSize: 14,
    color: '#1a237e',
    fontWeight: '600',
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
  emptyText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
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
