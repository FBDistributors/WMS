/**
 * Mijoz qaytarishi: controller tasdiq, yig'uvchini biriktirish, joylashtirishni yakunlash.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { useNetwork } from '../network';
import { getMe } from '../api/auth';
import {
  assignPickerCustomerReturn,
  completeCustomerReturn,
  controllerApproveCustomerReturn,
  listCustomerReturns,
  type CustomerReturn,
} from '../api/customerReturns';
import { getPickers, type PickerUser } from '../api/picking';
import { AppHeader } from '../components/AppHeader';

type Nav = StackNavigationProp<RootStackParamList, 'CustomerReturnsQueue'>;

const PENDING = 'pending_controller';
const APPROVED = 'approved';
const ASSIGNED = 'assigned_to_picker';

export function CustomerReturnsQueueScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useLocale();
  const { isOnline } = useNetwork();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<CustomerReturn[]>([]);
  const [approved, setApproved] = useState<CustomerReturn[]>([]);
  const [assignedMine, setAssignedMine] = useState<CustomerReturn[]>([]);
  const [canController, setCanController] = useState(false);
  const [canPicker, setCanPicker] = useState(false);
  const [assignForId, setAssignForId] = useState<string | null>(null);
  const [pickers, setPickers] = useState<PickerUser[]>([]);
  const [selectedPickerId, setSelectedPickerId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const me = await getMe();
      const perms = new Set(me.permissions ?? []);
      const ctrl = perms.has('documents:edit_status');
      const pick = perms.has('picking:write');
      setCanController(ctrl);
      setCanPicker(pick);
      const tasks: Promise<void>[] = [];
      if (ctrl) {
        tasks.push(
          listCustomerReturns({ status: PENDING, limit: 100 })
            .then((r) => setPending(r.items))
            .catch(() => setPending([])),
          listCustomerReturns({ status: APPROVED, limit: 100 })
            .then((r) => setApproved(r.items))
            .catch(() => setApproved([])),
        );
      } else {
        setPending([]);
        setApproved([]);
      }
      if (pick) {
        tasks.push(
          listCustomerReturns({ status: ASSIGNED, mine_as_picker: true, limit: 100 })
            .then((r) => setAssignedMine(r.items))
            .catch(() => setAssignedMine([])),
        );
      } else {
        setAssignedMine([]);
      }
      await Promise.all(tasks);
    } catch {
      setPending([]);
      setApproved([]);
      setAssignedMine([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (assignForId && isOnline) {
      getPickers().then(setPickers).catch(() => setPickers([]));
    }
  }, [assignForId, isOnline]);

  const errDetail = (e: unknown): string => {
    if (e && typeof e === 'object' && 'response' in e && e.response && typeof e.response === 'object' && 'data' in e.response) {
      const detail = (e.response as { data?: { detail?: string } }).data?.detail;
      if (typeof detail === 'string') return detail;
    }
    return e instanceof Error ? e.message : t('kirimSubmitError');
  };

  const onApprove = async (id: string) => {
    if (!isOnline) {
      Alert.alert(t('error'), t('returnsOfflineSubmit'));
      return;
    }
    setActionId(id);
    try {
      await controllerApproveCustomerReturn(id);
      await load();
      Alert.alert(t('success'), t('returnsApprovedOk'));
    } catch (e) {
      Alert.alert(t('error'), errDetail(e));
    } finally {
      setActionId(null);
    }
  };

  const onAssign = async () => {
    if (!assignForId || !selectedPickerId) return;
    if (!isOnline) {
      Alert.alert(t('error'), t('returnsOfflineSubmit'));
      return;
    }
    setActionId(assignForId);
    try {
      await assignPickerCustomerReturn(assignForId, selectedPickerId);
      setAssignForId(null);
      setSelectedPickerId(null);
      await load();
      Alert.alert(t('success'), t('returnsAssignedOk'));
    } catch (e) {
      Alert.alert(t('error'), errDetail(e));
    } finally {
      setActionId(null);
    }
  };

  const onComplete = async (id: string) => {
    if (!isOnline) {
      Alert.alert(t('error'), t('returnsOfflineSubmit'));
      return;
    }
    setActionId(id);
    try {
      await completeCustomerReturn(id);
      await load();
      Alert.alert(t('success'), t('returnsCompletedOk'));
    } catch (e) {
      Alert.alert(t('error'), errDetail(e));
    } finally {
      setActionId(null);
    }
  };

  const renderDoc = (cr: CustomerReturn, kind: 'pending' | 'approved' | 'assigned') => (
    <View key={cr.id} style={styles.docCard}>
      <Text style={styles.docNo}>{cr.doc_no}</Text>
      <Text style={styles.docMeta}>
        {(cr.lines ?? []).length} {t('returnsLines').toLowerCase()} · {cr.status}
      </Text>
      {kind === 'pending' && canController && (
        <TouchableOpacity
          style={[styles.primaryBtn, actionId === cr.id && styles.btnDisabled]}
          onPress={() => onApprove(cr.id)}
          disabled={actionId === cr.id}
        >
          {actionId === cr.id ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>{t('returnsApprove')}</Text>
          )}
        </TouchableOpacity>
      )}
      {kind === 'approved' && canController && (
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => {
            setAssignForId(cr.id);
            setSelectedPickerId(null);
          }}
        >
          <Text style={styles.secondaryBtnText}>{t('returnsAssignPickerAction')}</Text>
        </TouchableOpacity>
      )}
      {kind === 'assigned' && canPicker && (
        <TouchableOpacity
          style={[styles.primaryBtn, actionId === cr.id && styles.btnDisabled]}
          onPress={() => onComplete(cr.id)}
          disabled={actionId === cr.id}
        >
          {actionId === cr.id ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>{t('returnsCompletePutaway')}</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title={t('returnsQueueTitle')} showLogo={false} showBack onBack={() => navigation.goBack()} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {loading ? (
          <View style={styles.centerRow}>
            <ActivityIndicator color="#1a237e" />
            <Text style={styles.muted}>{t('loading')}</Text>
          </View>
        ) : (
          <>
            {!canController && !canPicker ? (
              <Text style={styles.muted}>{t('returnsQueueNoRole')}</Text>
            ) : null}
            {canController && pending.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>{t('returnsSectionPending')}</Text>
                {pending.map((cr) => renderDoc(cr, 'pending'))}
              </>
            ) : null}
            {canController && approved.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>{t('returnsSectionApproved')}</Text>
                {approved.map((cr) => renderDoc(cr, 'approved'))}
              </>
            ) : null}
            {canPicker && assignedMine.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>{t('returnsSectionMyPutaway')}</Text>
                {assignedMine.map((cr) => renderDoc(cr, 'assigned'))}
              </>
            ) : null}
            {!loading && (canController || canPicker) && pending.length === 0 && approved.length === 0 && assignedMine.length === 0 ? (
              <Text style={styles.muted}>{t('returnsQueueEmpty')}</Text>
            ) : null}
          </>
        )}
      </ScrollView>

      <Modal visible={assignForId != null} transparent animationType="fade" onRequestClose={() => setAssignForId(null)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setAssignForId(null)}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('returnsSelectPicker')}</Text>
              <TouchableOpacity onPress={() => setAssignForId(null)}>
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
                  {selectedPickerId === p.id ? <Icon name="check-circle" size={22} color="#1a237e" /> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={[styles.primaryBtn, styles.modalFooterBtn, !selectedPickerId && styles.btnDisabled]}
              onPress={onAssign}
              disabled={!selectedPickerId || actionId != null}
            >
              <Text style={styles.primaryBtnText}>{t('returnsConfirmAssign')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 32 },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 24 },
  muted: { fontSize: 14, color: '#666', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1a237e', marginTop: 8, marginBottom: 10 },
  docCard: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  docNo: { fontSize: 15, fontWeight: '600', color: '#333' },
  docMeta: { fontSize: 13, color: '#666', marginBottom: 10 },
  primaryBtn: {
    backgroundColor: '#1a237e',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryBtn: {
    borderWidth: 2,
    borderColor: '#1a237e',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#1a237e', fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.6 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 14,
    maxHeight: '80%',
    overflow: 'hidden',
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
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  modalItemActive: { backgroundColor: '#e8eaf6' },
  modalItemText: { fontSize: 16, color: '#333' },
  modalFooterBtn: { margin: 16 },
});
