import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { useTheme } from '../theme/ThemeContext';
import type { PickingListItem } from '../api/picking.types';
import { UNAUTHORIZED_MSG } from '../api/client';
import { getOpenTasks, getControllers, sendToController, completePickDocument, INCOMPLETE_REASON_KEYS, type ControllerUser } from '../api/picking';
import { useNetwork } from '../network';
import { getCachedPickTasks, saveCachedPickTasks } from '../offline/offlineDb';
import { ConsolidatedPickContent } from '../components/ConsolidatedPickContent';
import { useProfileType } from '../context/ProfileTypeContext';

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
  isDark,
}: {
  item: PickingListItem;
  profileType: 'picker' | 'controller';
  onPress: () => void;
  onSendToController?: (doc: PickingListItem) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  isDark?: boolean;
}) {
  const statusText =
    profileType === 'controller' && item.status === 'picked'
      ? t('statusPendingVerify')
      : t(STATUS_KEYS[item.status] ?? item.status);
  const isFullyPicked =
    item.lines_total > 0 && item.lines_done >= item.lines_total;
  const showSendBtn =
    profileType === 'picker' &&
    item.lines_done > 0 &&
    !item.controlled_by_user_id;

  return (
    <View style={styles.rowWrap}>
      <TouchableOpacity
        style={[
          styles.row,
          isFullyPicked && styles.rowFullyPicked,
          isDark && styles.rowDark,
          isFullyPicked && isDark && styles.rowFullyPickedDark,
        ]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        <Text style={[styles.rowRef, isDark && styles.rowRefDark]}>{item.reference_number}</Text>
        <Text style={[styles.rowMeta, isDark && styles.rowMetaDark]}>
          {t('linesCount', { done: item.lines_done, total: item.lines_total })}
        </Text>
        {profileType === 'controller' && (item.assigned_to_user_name != null || item.assigned_to_user_id != null) && (
          <Text style={[styles.rowPickerName, isDark && styles.rowPickerNameDark]} numberOfLines={1}>
            {t('pickerNameLabel')}: {item.assigned_to_user_name ?? '—'}
          </Text>
        )}
        <View style={[styles.badge, isDark && styles.badgeDark]}>
          <Text style={[styles.badgeText, isDark && styles.badgeTextDark]}>{statusText}</Text>
        </View>
        {profileType === 'picker' && item.status === 'picked' && item.controlled_by_user_id && (
          <Text style={[styles.sentLabel, isDark && styles.sentLabelDark]}>{t('sendToControllerDone')}</Text>
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
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { isOnline } = useNetwork();
  const profileType = route.params?.profileType ?? useProfileType().profileType ?? 'picker';
  const completedMessage = route.params?.completedMessage;
  const [showCompletedBanner, setShowCompletedBanner] = useState(!!completedMessage);
  const [list, setList] = useState<PickingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [controllerModalDoc, setControllerModalDoc] = useState<PickingListItem | null>(null);
  const [controllers, setControllers] = useState<ControllerUser[]>([]);
  const [sending, setSending] = useState(false);
  const [showConsolidated, setShowConsolidated] = useState(false);
  const [pendingScannedBarcode, setPendingScannedBarcode] = useState<string | null>(null);
  const [selectedProductKey, setSelectedProductKey] = useState<string | null>(null);
  const [incompleteReasonModalDoc, setIncompleteReasonModalDoc] = useState<PickingListItem | null>(null);
  const [selectedIncompleteReasonForSend, setSelectedIncompleteReasonForSend] = useState<string | null>(null);
  const [completingForController, setCompletingForController] = useState(false);

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
        Alert.alert(t('error'), t('authErrorPleaseLogin'), [
          { text: 'OK', onPress: () => navigation.replace('Login') },
        ]);
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

  useEffect(() => {
    if (!completedMessage) return;
    setShowCompletedBanner(true);
    const t = setTimeout(() => setShowCompletedBanner(false), 2500);
    return () => clearTimeout(t);
  }, [completedMessage]);

  useFocusEffect(
    useCallback(() => {
      const params = route.params ?? {};
      if (params.openConsolidated) {
        setShowConsolidated(true);
      }
      if (params.scannedBarcode) {
        setPendingScannedBarcode(params.scannedBarcode);
        navigation.setParams({ scannedBarcode: undefined });
      }
      if (params.selectedProductKey !== undefined) {
        setSelectedProductKey(params.selectedProductKey ?? null);
        navigation.setParams({ selectedProductKey: undefined });
      }
    }, [route.params, navigation])
  );

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

  const handleSendToControllerPress = useCallback(
    (doc: PickingListItem) => {
      const isFullyPicked = doc.lines_total > 0 && doc.lines_done >= doc.lines_total;
      if (isFullyPicked) {
        openControllerModal(doc);
      } else {
        setSelectedIncompleteReasonForSend(null);
        setIncompleteReasonModalDoc(doc);
      }
    },
    [openControllerModal]
  );

  const confirmIncompleteReasonForSend = useCallback(async () => {
    if (!incompleteReasonModalDoc || !selectedIncompleteReasonForSend || !isOnline) return;
    setCompletingForController(true);
    try {
      await completePickDocument(incompleteReasonModalDoc.id, { incomplete_reason: selectedIncompleteReasonForSend });
      const doc = incompleteReasonModalDoc;
      setIncompleteReasonModalDoc(null);
      setSelectedIncompleteReasonForSend(null);
      openControllerModal(doc);
    } catch (e) {
      Alert.alert(t('error'), e instanceof Error ? e.message : t('error'));
    } finally {
      setCompletingForController(false);
    }
  }, [incompleteReasonModalDoc, selectedIncompleteReasonForSend, isOnline, openControllerModal, t]);

  const sendToControllerConfirm = useCallback(
    async (controllerId: string) => {
      if (!controllerModalDoc || sending) return;
      setSending(true);
      try {
        if (controllerModalDoc.status !== 'picked') {
          await completePickDocument(controllerModalDoc.id);
        }
        await sendToController(controllerModalDoc.id, controllerId);
        setControllerModalDoc(null);
        setList((prev) => prev.filter((d) => d.id !== controllerModalDoc.id));
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
      <View style={[styles.centered, isDark && styles.centeredDark]}>
        <ActivityIndicator size="large" color={isDark ? '#93c5fd' : '#1976d2'} />
        <Text style={[styles.loadingText, isDark && styles.loadingTextDark]}>{t('loading')}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.centered, isDark && styles.centeredDark]}>
        <Text style={[styles.errorText, isDark && styles.errorTextDark]}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryBtnText}>{t('retry')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.reset({ index: 0, routes: [{ name: 'PickerHome' }] })} activeOpacity={0.7} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="arrow-left" size={24} color="#1976d2" />
        </TouchableOpacity>
      </View>
    );
  }

  const isPicker = profileType === 'picker';

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {showCompletedBanner && completedMessage ? (
        <View style={styles.completedBanner}>
          <Icon name="check-circle" size={20} color="#fff" />
          <Text style={styles.completedBannerText}>{completedMessage}</Text>
        </View>
      ) : null}
      <View style={[styles.header, isDark && styles.headerDark]}>
        <View style={styles.headerCenter}>
          <Text style={[styles.title, isDark && styles.titleDark]}>
            {showConsolidated ? t('consolidatedPickTitle') : t('openTasks')}
          </Text>
          <Text style={[styles.count, isDark && styles.countDark]}>
            {showConsolidated ? t('consolidatedMyTasks') : `${list.length}${t('countTa')}`}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => load()}
          style={styles.refreshBtn}
          disabled={loading}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="refresh" size={24} color={loading ? '#999' : (isDark ? '#93c5fd' : '#1976d2')} />
        </TouchableOpacity>
      </View>
      <View style={styles.toggleAndContent}>
      {showConsolidated && isPicker ? (
        <ConsolidatedPickContent
          embeddedInPickTaskList
          pendingScannedBarcode={pendingScannedBarcode}
          onClearPendingBarcode={() => setPendingScannedBarcode(null)}
          selectedProductKey={selectedProductKey}
          onProductSelect={setSelectedProductKey}
        />
      ) : list.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, isDark && styles.emptyTextDark]}>{t('openTasksEmpty')}</Text>
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
              isDark={isDark}
              onPress={() =>
                navigation.navigate('PickTaskDetails', { taskId: item.id, profileType })
              }
              onSendToController={profileType === 'picker' ? handleSendToControllerPress : undefined}
            />
          )}
          contentContainerStyle={styles.listContent}
        />
      )}
      </View>

      {isPicker && (
        <View style={[styles.toggleWrapBottom, isDark && styles.toggleWrapDark]}>
          <TouchableOpacity
            style={[styles.toggleSegment, !showConsolidated && styles.toggleSegmentActive, isDark && styles.toggleSegmentDark, !showConsolidated && isDark && styles.toggleSegmentActiveDark]}
            onPress={() => { setShowConsolidated(false); load(); }}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.toggleSegmentText,
                !showConsolidated && styles.toggleSegmentTextActive,
                isDark && styles.toggleSegmentTextDark,
                !showConsolidated && isDark && styles.toggleSegmentTextActiveDark,
              ]}
              numberOfLines={1}
            >
              {t('toggleOrdersList')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleSegment, showConsolidated && styles.toggleSegmentActive, isDark && styles.toggleSegmentDark, showConsolidated && isDark && styles.toggleSegmentActiveDark]}
            onPress={() => setShowConsolidated(true)}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.toggleSegmentText,
                showConsolidated && styles.toggleSegmentTextActive,
                isDark && styles.toggleSegmentTextDark,
                showConsolidated && isDark && styles.toggleSegmentTextActiveDark,
              ]}
              numberOfLines={1}
            >
              {t('toggleGeneralList')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal
        visible={!!incompleteReasonModalDoc}
        transparent
        animationType="slide"
        onRequestClose={() => { if (!completingForController) setIncompleteReasonModalDoc(null); }}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => { if (!completingForController) setIncompleteReasonModalDoc(null); }}
        >
          <View style={[styles.modalContent, styles.incompleteReasonModal, isDark && styles.modalContentDark]} onStartShouldSetResponder={() => true}>
            <Text style={[styles.incompleteReasonTitle, isDark && styles.incompleteReasonTitleDark]}>{t('incompleteReasonTitle')}</Text>
            <Text style={[styles.incompleteReasonHint, isDark && styles.incompleteReasonHintDark]}>{t('incompleteReasonSelect')}</Text>
            <ScrollView style={styles.incompleteReasonList} nestedScrollEnabled>
              {INCOMPLETE_REASON_KEYS.map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.incompleteReasonRow,
                    selectedIncompleteReasonForSend === key && styles.incompleteReasonRowSelected,
                    isDark && styles.incompleteReasonRowDark,
                    selectedIncompleteReasonForSend === key && isDark && styles.incompleteReasonRowSelectedDark,
                  ]}
                  onPress={() => setSelectedIncompleteReasonForSend(key)}
                  activeOpacity={0.7}
                  disabled={completingForController}
                >
                  <Icon
                    name={selectedIncompleteReasonForSend === key ? 'radiobox-marked' : 'radiobox-blank'}
                    size={22}
                    color={selectedIncompleteReasonForSend === key ? (isDark ? '#93c5fd' : '#1976d2') : (isDark ? '#94a3b8' : '#666')}
                  />
                  <Text style={[styles.incompleteReasonRowText, isDark && styles.incompleteReasonRowTextDark]}>{t(`reason_${key}`)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.incompleteReasonActions}>
              <TouchableOpacity
                style={[styles.incompleteReasonConfirm, (!selectedIncompleteReasonForSend || completingForController) && styles.incompleteReasonConfirmDisabled]}
                onPress={confirmIncompleteReasonForSend}
                disabled={!selectedIncompleteReasonForSend || completingForController}
              >
                <Text style={styles.incompleteReasonConfirmText}>
                  {completingForController ? '…' : t('incompleteConfirmComplete')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.incompleteReasonCancel} onPress={() => setIncompleteReasonModalDoc(null)} disabled={completingForController}>
                <Text style={[styles.incompleteReasonCancelText, isDark && styles.incompleteReasonCancelTextDark]}>{t('cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

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
          <View style={[styles.modalContent, isDark && styles.modalContentDark]} onStartShouldSetResponder={() => true}>
            <Text style={[styles.modalTitle, isDark && styles.modalTitleDark]}>{t('selectController')}</Text>
            {controllers.length === 0 && !loading && (
              <Text style={[styles.modalEmpty, isDark && styles.modalEmptyDark]}>{t('openTasksEmpty')}</Text>
            )}
            {controllers.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.controllerRow, isDark && styles.controllerRowDark]}
                onPress={() => sendToControllerConfirm(c.id)}
                disabled={sending}
              >
                <Text style={[styles.controllerName, isDark && styles.controllerNameDark]}>
                  {c.full_name || c.username}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setControllerModalDoc(null)}
            >
              <Text style={[styles.modalCancelText, isDark && styles.modalCancelTextDark]}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  completedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#2e7d32',
  },
  completedBannerText: { color: '#fff', fontSize: 14, fontWeight: '600' },
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
    flexDirection: 'row',
    alignItems: 'center',
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
  headerCenter: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700', color: '#111' },
  count: { fontSize: 14, color: '#666', marginTop: 4 },
  refreshBtn: { padding: 4 },
  toggleAndContent: { flex: 1 },
  toggleWrap: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: '#e0e0e0',
    borderRadius: 12,
    padding: 4,
    marginTop: 10,
    marginBottom: 18,
    gap: 0,
  },
  toggleWrapBottom: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: '#e0e0e0',
    borderRadius: 12,
    padding: 4,
    marginTop: 8,
    marginBottom: 12,
    marginHorizontal: 16,
    gap: 0,
  },
  toggleSegment: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  toggleSegmentActive: {
    backgroundColor: '#fff',
  },
  toggleSegmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  toggleSegmentTextActive: {
    color: '#111',
  },
  toggleSegmentTextDark: {
    color: '#94a3b8',
  },
  toggleSegmentTextActiveDark: {
    color: '#f1f5f9',
  },
  listContent: { padding: 16, paddingBottom: 24 },
  rowWrap: { marginBottom: 12 },
  row: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  rowFullyPicked: {
    backgroundColor: '#e8f5e9',
    borderColor: '#c8e6c9',
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
  rowPickerName: { fontSize: 12, color: '#555', marginTop: 2 },
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
  incompleteReasonModal: { maxHeight: '80%' },
  incompleteReasonTitle: { fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 8 },
  incompleteReasonHint: { fontSize: 14, color: '#666', marginBottom: 12 },
  incompleteReasonList: { maxHeight: 280, marginBottom: 16 },
  incompleteReasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: '#f5f5f5',
  },
  incompleteReasonRowSelected: { backgroundColor: '#e3f2fd' },
  incompleteReasonRowText: { fontSize: 16, color: '#111', flex: 1, marginLeft: 10 },
  incompleteReasonActions: { gap: 10 },
  incompleteReasonConfirm: {
    backgroundColor: '#1976d2',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  incompleteReasonConfirmDisabled: { opacity: 0.5 },
  incompleteReasonConfirmText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  incompleteReasonCancel: { paddingVertical: 12, alignItems: 'center' },
  incompleteReasonCancelText: { color: '#666', fontSize: 16 },
  // Dark
  containerDark: { backgroundColor: '#0f172a' },
  headerDark: { backgroundColor: '#1e293b', borderBottomColor: '#334155' },
  titleDark: { color: '#f1f5f9' },
  countDark: { color: '#94a3b8' },
  toggleWrapDark: { backgroundColor: '#334155' },
  toggleSegmentDark: {},
  toggleSegmentActiveDark: { backgroundColor: '#475569' },
  rowDark: { backgroundColor: '#1e293b', borderColor: '#334155' },
  rowFullyPickedDark: { backgroundColor: '#14532d', borderColor: '#166534' },
  rowRefDark: { color: '#f1f5f9' },
  rowMetaDark: { color: '#94a3b8' },
  rowPickerNameDark: { color: '#94a3b8' },
  badgeDark: { backgroundColor: '#1e3a5f' },
  badgeTextDark: { color: '#93c5fd' },
  sentLabelDark: { color: '#86efac' },
  emptyTextDark: { color: '#94a3b8' },
  centeredDark: { backgroundColor: '#0f172a' },
  loadingTextDark: { color: '#94a3b8' },
  errorTextDark: { color: '#fca5a5' },
  modalContentDark: { backgroundColor: '#1e293b' },
  modalTitleDark: { color: '#f1f5f9' },
  modalEmptyDark: { color: '#94a3b8' },
  controllerRowDark: { borderBottomColor: '#334155' },
  controllerNameDark: { color: '#f1f5f9' },
  modalCancelTextDark: { color: '#93c5fd' },
  incompleteReasonTitleDark: { color: '#f1f5f9' },
  incompleteReasonHintDark: { color: '#94a3b8' },
  incompleteReasonRowDark: { backgroundColor: '#334155' },
  incompleteReasonRowSelectedDark: { backgroundColor: '#1e3a5f' },
  incompleteReasonRowTextDark: { color: '#f1f5f9' },
  incompleteReasonCancelTextDark: { color: '#93c5fd' },
});
