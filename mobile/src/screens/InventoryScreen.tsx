/**
 * Inventar ro'yxati — webapp PickerInventoryPage ga mos.
 * Qidiruv, joy bo'yicha filtr, mahsulot kartalari, kengaytiriladigan joylar.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import { AppHeader } from '../components/AppHeader';

type Nav = StackNavigationProp<RootStackParamList, 'Inventory'>;

function InventoryCard({
  item,
  onPress,
  t,
}: {
  item: PickerInventoryItem;
  onPress: () => void;
  t: (key: string) => string;
}) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.cardRow}>
        <View style={styles.cardMain}>
          <Text style={styles.cardTitle}>{item.name}</Text>
          {item.main_barcode ? (
            <Text style={styles.cardBarcode}>{item.main_barcode}</Text>
          ) : null}
          <Text style={styles.cardCode}>{item.code}</Text>
          <Text style={styles.cardMetaText}>
            {t('invQoldiq')}: {item.available_qty}
          </Text>
        </View>
        <Icon name="chevron-right" size={22} color="#666" />
      </View>
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
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const PAGE_SIZE = 100;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNextCursor(null);
    try {
      const res = await listPickerInventory({
        q: query || undefined,
        location_id: locationId || undefined,
        limit: PAGE_SIZE,
      });
      setItems(res.items);
      setNextCursor(res.next_cursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('invLoadError'));
    } finally {
      setLoading(false);
    }
  }, [query, locationId, t]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await listPickerInventory({
        q: query || undefined,
        location_id: locationId || undefined,
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });
      setItems((prev) => [...prev, ...res.items]);
      setNextCursor(res.next_cursor);
    } catch {
      // keep current nextCursor so user can retry by scrolling again
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, query, locationId]);

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

  const renderItem = ({ item }: { item: PickerInventoryItem }) => (
    <InventoryCard
      item={item}
      onPress={() =>
        navigation.navigate('InventoryDetail', { productId: item.product_id })
      }
      t={t}
    />
  );

  const onHeaderRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <AppHeader
        title={t('invTitle')}
        showBack
        onBack={() => navigation.goBack()}
        showLogo={true}
        onRefresh={onHeaderRefresh}
        refreshing={refreshing}
      />

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
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator size="small" color="#1a237e" />
              </View>
            ) : null
          }
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
  footerLoader: {
    paddingVertical: 16,
    alignItems: 'center',
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
  cardCode: {
    fontSize: 13,
    color: '#1a237e',
    fontWeight: '600',
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
