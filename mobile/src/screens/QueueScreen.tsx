/**
 * Offline queue: pending + failed list, Sync now, Retry failed.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useLocale } from '../i18n/LocaleContext';
import { useNetwork } from '../network';
import { getQueueForUI, retryFailedItem, type OfflineQueueItem } from '../offline/offlineQueue';
import { syncPendingQueue } from '../offline/syncEngine';
import { UNAUTHORIZED_MSG } from '../api/client';

export function QueueScreen() {
  const { t } = useLocale();
  const navigation = useNavigation();
  const { isOnline } = useNetwork();
  const [pending, setPending] = useState<OfflineQueueItem[]>([]);
  const [failed, setFailed] = useState<OfflineQueueItem[]>([]);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const { pending: p, failed: f } = await getQueueForUI();
    setPending(p);
    setFailed(f);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleSyncNow = useCallback(async () => {
    if (!isOnline) {
      Alert.alert(t('error'), 'Internet ulanmagan');
      return;
    }
    setSyncing(true);
    try {
      const result = await syncPendingQueue();
      await load();
      if (result.needReauth) {
        Alert.alert(t('error'), 'Qayta kiring');
        navigation.replace('Login');
        return;
      }
      if (!result.ok && result.error) {
        Alert.alert(t('error'), result.error);
      }
    } finally {
      setSyncing(false);
    }
  }, [isOnline, navigation, t, load]);

  const handleRetry = useCallback(
    async (id: string) => {
      await retryFailedItem(id);
      await load();
      if (isOnline) {
        setSyncing(true);
        try {
          await syncPendingQueue();
          await load();
        } finally {
          setSyncing(false);
        }
      }
    },
    [isOnline, load]
  );

  const renderItem = useCallback(
    ({ item }: { item: OfflineQueueItem }) => {
      const isFailed = item.status === 'failed';
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(item.payload_json);
      } catch {}
      const label = `${item.type} ${payload.taskId ?? item.id}`;
      return (
        <View style={[styles.row, isFailed && styles.rowFailed]}>
          <View style={styles.rowBody}>
            <Text style={styles.rowType}>{item.type}</Text>
            <Text style={styles.rowPayload} numberOfLines={1}>
              {label}
            </Text>
            {isFailed && item.error ? (
              <Text style={styles.rowError} numberOfLines={2}>
                {item.error}
              </Text>
            ) : null}
          </View>
          {isFailed && (
            <TouchableOpacity style={styles.retryBtn} onPress={() => handleRetry(item.id)}>
              <Text style={styles.retryBtnText}>{t('retry')}</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    },
    [handleRetry, t]
  );

  const total = pending.length + failed.length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="arrow-left" size={24} color="#1976d2" />
        </TouchableOpacity>
        <Text style={styles.title}>{t('offlineQueue')}</Text>
        {isOnline && total > 0 && (
          <TouchableOpacity
            style={[styles.syncBtn, syncing && styles.syncBtnDisabled]}
            onPress={handleSyncNow}
            disabled={syncing}
          >
            {syncing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.syncBtnText}>{t('syncNow')}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
      {total === 0 ? (
        <View style={styles.empty}>
          <Icon name="check-circle-outline" size={64} color="#4caf50" />
          <Text style={styles.emptyText}>{t('queueEmpty')}</Text>
        </View>
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>{t('queuePending')} ({pending.length})</Text>
              <FlatList
                data={pending}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                scrollEnabled={false}
              />
            </>
          )}
          {failed.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, styles.sectionFailed]}>
                {t('queueFailed')} ({failed.length})
              </Text>
              <FlatList
                data={failed}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                scrollEnabled={false}
              />
            </>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: { marginRight: 12 },
  backText: { color: '#1976d2', fontSize: 16 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: '#111' },
  syncBtn: {
    backgroundColor: '#1976d2',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  syncBtnDisabled: { opacity: 0.7 },
  syncBtnText: { color: '#fff', fontWeight: '600' },
  sectionTitle: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, fontSize: 14, fontWeight: '600', color: '#666' },
  sectionFailed: { color: '#c62828' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  rowFailed: { borderColor: '#ffcdd2', backgroundColor: '#ffebee' },
  rowBody: { flex: 1 },
  rowType: { fontSize: 12, fontWeight: '600', color: '#666' },
  rowPayload: { fontSize: 14, color: '#111', marginTop: 2 },
  rowError: { fontSize: 12, color: '#c62828', marginTop: 4 },
  retryBtn: {
    backgroundColor: '#1976d2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
  },
  retryBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { fontSize: 16, color: '#666', marginTop: 12 },
});
