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
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import type { PickingListItem } from '../api/picking.types';
import { UNAUTHORIZED_MSG } from '../api/client';
import { getOpenTasks } from '../api/picking';

type Nav = StackNavigationProp<RootStackParamList, 'PickTaskList'>;

const STATUS_KEYS: Record<string, string> = {
  new: 'statusNew',
  in_progress: 'statusInProgress',
  partial: 'statusPartial',
  completed: 'statusCompleted',
  cancelled: 'statusCancelled',
};

function TaskRow({
  item,
  onPress,
  t,
}: {
  item: PickingListItem;
  onPress: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const statusText = t(STATUS_KEYS[item.status] ?? item.status);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.rowRef}>{item.reference_number}</Text>
      <Text style={styles.rowMeta}>
        {t('linesCount', { done: item.lines_done, total: item.lines_total })}
      </Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{statusText}</Text>
      </View>
    </TouchableOpacity>
  );
}

export function PickTaskList() {
  const navigation = useNavigation<Nav>();
  const { t } = useLocale();
  const [list, setList] = useState<PickingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getOpenTasks();
      setList(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('listLoadError');
      setError(msg);
      if (msg === UNAUTHORIZED_MSG) {
        navigation.replace('Login');
        return;
      }
      Alert.alert(t('error'), msg);
    } finally {
      setLoading(false);
    }
  }, [navigation, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1976d2" />
        <Text style={styles.loadingText}>{t('loading')}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryBtnText}>{t('retry')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>← {t('back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backLink}>← {t('back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('openTasks')}</Text>
        <Text style={styles.count}>{list.length}{t('countTa')}</Text>
      </View>
      {list.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{t('openTasksEmpty')}</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TaskRow
              item={item}
              t={t}
              onPress={() => navigation.navigate('PickTaskDetails', { taskId: item.id })}
            />
          )}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: { marginTop: 12, fontSize: 16, color: '#666' },
  errorText: { fontSize: 16, color: '#c62828', textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: '#1976d2',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  retryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  backBtn: { paddingVertical: 8 },
  backBtnText: { color: '#1976d2', fontSize: 16 },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backLink: { color: '#1976d2', fontSize: 16, marginBottom: 6 },
  title: { fontSize: 20, fontWeight: '700', color: '#111' },
  count: { fontSize: 14, color: '#666', marginTop: 4 },
  listContent: { padding: 16, paddingBottom: 24 },
  row: {
    backgroundColor: '#fff',
    padding: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  rowRef: { fontSize: 18, fontWeight: '600', color: '#111' },
  rowMeta: { fontSize: 14, color: '#666', marginTop: 4 },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  badgeText: { fontSize: 13, fontWeight: '600', color: '#1565c0' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#666' },
});
