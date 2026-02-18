import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import type { PickingListItem } from '../api/picking.types';
import { UNAUTHORIZED_MSG } from '../api/client';
import { getOpenTasks, getControllers, sendToController, type ControllerUser } from '../api/picking';
import { useNetwork } from '../network';
import { getCachedPickTasks, saveCachedPickTasks } from '../offline/offlineDb';

type Nav = StackNavigationProp<RootStackParamList, 'PickTaskList'>;
type PickTaskListRoute = RouteProp<RootStackParamList, 'PickTaskList'>;

const STATUS_KEYS: Record<string, string> = {
  new: 'statusNew',
  in_progress: 'statusInProgress',
  partial: 'statusPartial',
  picked: 'statusPicked',
  completed: 'statusCompleted',
  cancelled: 'statusCancelled',
};

function TaskRow({
  item,
  profileType,
  onPress,
  onSendToController,
  t,
}: {
  item: PickingListItem;
  profileType: 'picker' | 'controller';
  onPress: () => void;
  onSendToController?: (doc: PickingListItem) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const statusText =
    profileType === 'controller' && item.status === 'picked'
      ? t('statusPendingVerify')
      : t(STATUS_KEYS[item.status] ?? item.status);
  const showSendBtn =
    profileType === 'picker' &&
    item.status === 'picked' &&
    !item.controlled_by_user_id;

  return (
    <View style={styles.rowWrap}>
      <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
        <Text style={styles.rowRef}>{item.reference_number}</Text>
        <Text style={styles.rowMeta}>
          {t('linesCount', { done: item.lines_done, total: item.lines_total })}
        </Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{statusText}</Text>
        </View>
        {profileType === 'picker' && item.status === 'picked' && item.controlled_by_user_id && (
          <Text style={styles.sentLabel}>{t('sendToControllerDone')}</Text>
        )}
      </TouchableOpacity>
      {showSendBtn && onSendToController && (
        <TouchableOpacity
          style={styles.sendBtn}
          onPress={() => onSendToController(item)}
          activeOpacity={0.8}
        >
          <Text style={styles.sendBtnText}>{t('sendToController')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function PickTaskList() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<PickTaskListRoute>();
  const { t } = useLocale();
  const { isOnline } = useNetwork();
  const profileType = route.params?.profileType ?? 'picker';
  const [list, setList] = useState<PickingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [controllerModalDoc, setControllerModalDoc] = useState<PickingListItem | null>(null);
  const [controllers, setControllers] = useState<ControllerUser[]>([]);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isOnline) {
        const data = await getOpenTasks();
        setList(data as PickingListItem[]);
        await saveCachedPickTasks(data);
      } else {
        const cached = await getCachedPickTasks();
        setList(cached as PickingListItem[]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('listLoadError');
      setError(msg);
      if (msg === UNAUTHORIZED_MSG) {
        navigation.replace('Login');
        return;
      }
      if (isOnline) Alert.alert(t('error'), msg);
    } finally {
      setLoading(false);
    }
  }, [navigation, t, isOnline]);

  useEffect(() => {
    load();
  }, [load]);

  const openControllerModal = useCallback(
    async (doc: PickingListItem) => {
      setControllerModalDoc(doc);
      if (isOnline) {
        try {
          const c = await getControllers();
          setControllers(c);
        } catch (e) {
          Alert.alert(t('error'), e instanceof Error ? e.message : t('listLoadError'));
          setControllerModalDoc(null);
        }
      } else {
        setControllers([]);
      }
    },
    [isOnline, t]
  );

  const sendToControllerConfirm = useCallback(
    async (controllerId: string) => {
      if (!controllerModalDoc || sending) return;
      setSending(true);
      try {
        await sendToController(controllerModalDoc.id, controllerId);
        setControllerModalDoc(null);
        await load();
      } catch (e) {
        Alert.alert(t('error'), e instanceof Error ? e.message : t('error'));
      } finally {
        setSending(false);
      }
    },
    [controllerModalDoc, load, sending, t]
  );

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
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="arrow-left" size={24} color="#1976d2" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="arrow-left" size={24} color="#1976d2" />
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
              profileType={profileType}
              t={t}
              onPress={() =>
                navigation.navigate('PickTaskDetails', { taskId: item.id, profileType })
              }
              onSendToController={profileType === 'picker' ? openControllerModal : undefined}
            />
          )}
          contentContainerStyle={styles.listContent}
        />
      )}

      <Modal
        visible={!!controllerModalDoc}
        transparent
        animationType="slide"
        onRequestClose={() => setControllerModalDoc(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setControllerModalDoc(null)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>{t('selectController')}</Text>
            {controllers.length === 0 && !loading && (
              <Text style={styles.modalEmpty}>{t('openTasksEmpty')}</Text>
            )}
            {controllers.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={styles.controllerRow}
                onPress={() => sendToControllerConfirm(c.id)}
                disabled={sending}
              >
                <Text style={styles.controllerName}>
                  {c.full_name || c.username}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setControllerModalDoc(null)}
            >
              <Text style={styles.modalCancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
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
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backBtnIcon: { marginRight: 6 },
  backBtnText: { color: '#1976d2', fontSize: 16, fontWeight: '500' },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 4,
    borderRadius: 10,
    backgroundColor: '#f0f7ff',
  },
  backButtonText: {
    color: '#1976d2',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 6,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#111' },
  count: { fontSize: 14, color: '#666', marginTop: 4 },
  listContent: { padding: 16, paddingBottom: 24 },
  rowWrap: { marginBottom: 12 },
  row: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  sendBtn: {
    marginTop: 8,
    backgroundColor: '#2e7d32',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  sendBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  sentLabel: { fontSize: 12, color: '#2e7d32', marginTop: 6 },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    maxHeight: '70%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 16 },
  modalEmpty: { fontSize: 14, color: '#666', marginBottom: 12 },
  controllerRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  controllerName: { fontSize: 16, color: '#111' },
  modalCancel: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCancelText: { fontSize: 16, color: '#1976d2', fontWeight: '600' },
});
