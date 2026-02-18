/**
 * Picker / Yig'uvchi — web'dagi DocumentDetailsPage ga 1:1 yaqin.
 * Bloklar: header, order info, scan input, item list (+/-), sticky action bar.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import type { PickItem, PickTask, PickProgress } from '../types/picker';
import { getPickTask } from '../services/pickerService';

type PickerNav = StackNavigationProp<RootStackParamList, 'Picker'>;
type PickerRoute = RouteProp<RootStackParamList, 'Picker'>;

const STATUS_LABEL: Record<string, string> = {
  draft: 'Qoralama',
  in_progress: 'Jarayonda',
  completed: 'Tugallangan',
  cancelled: 'Bekor',
  paused: 'To‘xtatilgan',
};

function computeProgress(lines: PickItem[]): PickProgress {
  const required = lines.reduce((s, l) => s + l.qty_required, 0);
  const picked = lines.reduce((s, l) => s + l.qty_picked, 0);
  const linesTotal = lines.length;
  const linesDone = lines.filter((l) => l.qty_picked >= l.qty_required).length;
  return { picked, required, linesDone, linesTotal };
}

export function PickerScreen() {
  const navigation = useNavigation<PickerNav>();
  const route = useRoute<PickerRoute>();
  const taskId = route.params?.taskId ?? 'doc-mock-1';
  const onBack = useCallback(() => navigation.goBack(), [navigation]);
  const [task, setTask] = useState<PickTask | null>(null);
  const [lines, setLines] = useState<PickItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [barcodeValue, setBarcodeValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [completing, setCompleting] = useState(false);

  const loadTask = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPickTask(taskId);
      setTask(data);
      setLines(data.lines);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Yuklash xatosi');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    loadTask();
  }, [loadTask]);

  const progress = useMemo(() => computeProgress(lines), [lines]);

  const updatePicked = useCallback((lineId: string, delta: 1 | -1) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const next = Math.max(0, Math.min(line.qty_picked + delta, line.qty_required));
        return { ...line, qty_picked: next };
      })
    );
  }, []);

  const handlePick = useCallback(
    (lineId: string, delta: 1 | -1) => {
      const line = lines.find((l) => l.id === lineId);
      if (!line) return;
      if (delta === 1 && line.qty_picked >= line.qty_required) {
        Alert.alert('Ogohlantirish', 'Kerakli miqdordan ortiq kiritib bo‘lmaydi.');
        return;
      }
      if (delta === -1 && line.qty_picked <= 0) {
        Alert.alert('Ogohlantirish', '0 dan kam bo‘lmaydi.');
        return;
      }
      updatePicked(lineId, delta);
      if (delta === 1) Alert.alert('OK', 'Terildi: +1');
      else Alert.alert('OK', 'O‘zgartirildi: -1');
    },
    [lines, updatePicked]
  );

  const handleBarcodeSubmit = useCallback(() => {
    const value = barcodeValue.trim();
    if (!value) return;
    const matched = lines.find(
      (l) => l.barcode === value || l.sku === value || l.product_name.toLowerCase().includes(value.toLowerCase())
    );
    if (!matched) {
      Alert.alert('Topilmadi', `"${value}" bo‘yicha mahsulot topilmadi.`);
      setBarcodeValue('');
      return;
    }
    if (matched.qty_picked >= matched.qty_required) {
      Alert.alert('Tugallangan', 'Bu pozitsiya allaqachon to‘ldirilgan.');
      setBarcodeValue('');
      return;
    }
    updatePicked(matched.id, 1);
    Alert.alert('OK', `${matched.product_name}: +1 terildi`);
    setBarcodeValue('');
  }, [barcodeValue, lines, updatePicked]);

  const handleComplete = useCallback(async () => {
    if (!task) return;
    setCompleting(true);
    setError(null);
    try {
      const { completePickTask } = await import('../services/pickerService');
      await completePickTask(task.id);
      Alert.alert('Muvaffaqiyat', 'Terish tugallandi.');
      onBack?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Tugatish xatosi';
      Alert.alert('Xato', msg);
    } finally {
      setCompleting(false);
    }
  }, [task, onBack]);

  const handlePause = useCallback(() => {
    Alert.alert('To‘xtatish', 'API ulanmaguncha faqat xabar (keyin pause API chaqiladi).');
  }, []);

  const handleCancel = useCallback(() => {
    Alert.alert('Bekor qilish', 'Haqiqatan ham bekor qilmoqchimisiz?', [
      { text: 'Yo‘q', style: 'cancel' },
      { text: 'Ha', onPress: () => Alert.alert('Bekor', 'API ulanmaguncha faqat xabar.') },
    ]);
  }, []);

  const filteredLines = useMemo(() => {
    if (!searchQuery.trim()) return lines;
    const q = searchQuery.toLowerCase();
    return lines.filter(
      (l) =>
        l.product_name.toLowerCase().includes(q) ||
        (l.barcode && l.barcode.toLowerCase().includes(q)) ||
        (l.sku && l.sku.toLowerCase().includes(q)) ||
        l.location_code.toLowerCase().includes(q)
    );
  }, [lines, searchQuery]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1976d2" />
        <Text style={styles.loadingText}>Yuklanmoqda…</Text>
      </View>
    );
  }

  if (error || !task) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error || 'Hujjat topilmadi'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={loadTask}>
          <Text style={styles.retryBtnText}>Qayta urinish</Text>
        </TouchableOpacity>
        {onBack && (
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <Text style={styles.backBtnText}>← Orqaga</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backLink}>
            <Text style={styles.backLinkText}>← Ro‘yxat</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>{task.reference_number}</Text>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Holat: </Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{STATUS_LABEL[task.status] ?? task.status}</Text>
          </View>
        </View>
      </View>

      {/* Progress */}
      <View style={styles.progressCard}>
        <Text style={styles.progressText}>
          Terildi: {progress.picked} / {progress.required}
        </Text>
        <Text style={styles.progressSub}>
          Qatorlar: {progress.linesDone} / {progress.linesTotal}
        </Text>
      </View>

      {/* Scan input */}
      <View style={styles.scanBlock}>
        <Text style={styles.scanLabel}>Shtrixkod / SKU</Text>
        <TextInput
          style={styles.scanInput}
          value={barcodeValue}
          onChangeText={setBarcodeValue}
          onSubmitEditing={handleBarcodeSubmit}
          returnKeyType="done"
          placeholder="Skanerlang yoki yozing"
          placeholderTextColor="#999"
        />
        <TouchableOpacity style={styles.scanSubmitBtn} onPress={handleBarcodeSubmit}>
          <Text style={styles.scanSubmitText}>Qidirish</Text>
        </TouchableOpacity>
      </View>

      {/* Search filter */}
      <View style={styles.searchBlock}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Mahsulot / shtrix / lokatsiya bo‘yicha qidirish"
          placeholderTextColor="#999"
        />
      </View>

      {/* Item list */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionTitle}>Pozitsiyalar</Text>
        {filteredLines.length === 0 ? (
          <Text style={styles.emptyList}>Qidiruv bo‘yicha hech narsa topilmadi</Text>
        ) : (
          filteredLines.map((line) => {
            const remaining = line.qty_required - line.qty_picked;
            const isDone = line.qty_picked >= line.qty_required;
            return (
              <View
                key={line.id}
                style={[styles.itemCard, isDone && styles.itemCardDone]}
              >
                <Text style={styles.itemName}>{line.product_name}</Text>
                <Text style={styles.itemMeta}>Lokatsiya: {line.location_code}</Text>
                <Text style={styles.itemMeta}>Shtrix: {line.barcode ?? '—'}</Text>
                <View style={styles.itemQtyRow}>
                  <Text style={styles.itemQtyLabel}>Kerak: {line.qty_required}</Text>
                  <Text style={styles.itemQtyLabel}>Terilgan: {line.qty_picked}</Text>
                  <Text style={styles.itemQtyLabel}>Qolgan: {remaining}</Text>
                </View>
                <Text style={styles.itemProgress}>
                  {line.qty_picked} / {line.qty_required}
                </Text>
                {isDone && (
                  <View style={styles.doneBadge}>
                    <Text style={styles.doneBadgeText}>DONE</Text>
                  </View>
                )}
                <View style={styles.buttonsRow}>
                  <TouchableOpacity
                    style={[styles.qtyBtn, line.qty_picked <= 0 && styles.qtyBtnDisabled]}
                    onPress={() => handlePick(line.id, -1)}
                    disabled={line.qty_picked <= 0}
                  >
                    <Text style={styles.qtyBtnText}>−1</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.qtyBtn, line.qty_picked >= line.qty_required && styles.qtyBtnDisabled]}
                    onPress={() => handlePick(line.id, 1)}
                    disabled={line.qty_picked >= line.qty_required}
                  >
                    <Text style={styles.qtyBtnText}>+1</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Sticky action bar */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.footerBtn, styles.footerBtnPrimary]}
          onPress={handleComplete}
          disabled={completing}
        >
          <Text style={styles.footerBtnPrimaryText}>
            {completing ? 'Jarayonda…' : 'Terishni tugatish'}
          </Text>
        </TouchableOpacity>
        <View style={styles.footerRow}>
          <TouchableOpacity style={styles.footerBtnSecondary} onPress={handlePause}>
            <Text style={styles.footerBtnSecondaryText}>To‘xtatish</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.footerBtnSecondary} onPress={handleCancel}>
            <Text style={styles.footerBtnSecondaryText}>Bekor qilish</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
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
  backLink: { marginBottom: 6 },
  backLinkText: { color: '#1976d2', fontSize: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#111' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  statusLabel: { fontSize: 14, color: '#666' },
  badge: {
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: { fontSize: 13, fontWeight: '600', color: '#1565c0' },

  progressCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  progressText: { fontSize: 16, fontWeight: '600', color: '#111' },
  progressSub: { fontSize: 14, color: '#666', marginTop: 4 },

  scanBlock: {
    marginHorizontal: 16,
    marginTop: 12,
  },
  scanLabel: { fontSize: 14, color: '#333', marginBottom: 6 },
  scanInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
  },
  scanSubmitBtn: {
    marginTop: 8,
    backgroundColor: '#333',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  scanSubmitText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  searchBlock: { marginHorizontal: 16, marginTop: 12 },
  searchInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111',
  },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#111', marginBottom: 12 },
  emptyList: { fontSize: 14, color: '#666', textAlign: 'center', marginTop: 16 },

  itemCard: {
    backgroundColor: '#fff',
    padding: 12,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  itemCardDone: { backgroundColor: '#e8f5e9', borderColor: '#c8e6c9' },
  itemName: { fontSize: 16, fontWeight: '600', color: '#111' },
  itemMeta: { fontSize: 14, color: '#666', marginTop: 4 },
  itemQtyRow: { flexDirection: 'row', gap: 12, marginTop: 6 },
  itemQtyLabel: { fontSize: 14, color: '#333' },
  itemProgress: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  doneBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#2e7d32',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 8,
  },
  doneBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  buttonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  qtyBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  qtyBtnDisabled: { opacity: 0.5 },
  qtyBtnText: { fontSize: 16, fontWeight: '600', color: '#333' },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  footerBtn: { borderRadius: 14, overflow: 'hidden' },
  footerBtnPrimary: {
    backgroundColor: '#1976d2',
    paddingVertical: 16,
    alignItems: 'center',
  },
  footerBtnPrimaryText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  footerRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  footerBtnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  footerBtnSecondaryText: { fontSize: 16, color: '#333', fontWeight: '500' },
});
