import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_state/network_status_provider.dart';
import '../../core/offline/offline_database.dart';
import '../../core/offline/offline_providers.dart';
import '../../core/storage/shared_preferences_provider.dart';
import '../auth/presentation/auth_providers.dart';
import 'data/picking_models.dart';
import 'picking_repository_provider.dart';

export 'picking_repository_provider.dart';

/// Ochiq vazifalar ro'yxati uchun limit.
///
/// Controller navbati shahar/region va navbat/menda bo'yicha mijoz tomonida
/// ajratiladi — limit past bo'lsa bir bo'lim yolg'ondan bo'sh ko'rinardi.
const int _openTasksLimit = 200;

class OpenPickTasksNotifier extends AutoDisposeAsyncNotifier<List<PickingListItem>> {
  Future<List<PickingListItem>> _loadCache(OfflineDatabase? db) async {
    if (db == null) {
      return const <PickingListItem>[];
    }
    final List<Map<String, Object?>> rows = await db.getCachedPickTasks();
    return rows
        .map((Map<String, Object?> m) => PickingListItem.fromJson(m))
        .toList(growable: false);
  }

  @override
  Future<List<PickingListItem>> build() async {
    final bool online = ref.watch(networkOnlineProvider).valueOrNull ?? true;
    final OfflineDatabase? db = await ref.watch(offlineDatabaseProvider.future);
    final List<PickingListItem> cached = await _loadCache(db);

    if (!online) {
      return cached;
    }

    try {
      final List<PickingListItem> list =
          await ref.read(pickingRepositoryProvider).getOpenTasks(limit: _openTasksLimit);
      await db?.saveCachedPickTasks(
        list.map((PickingListItem e) => e.toJson()).toList(growable: false),
      );
      return list;
    } on Object catch (e, st) {
      if (kDebugMode) {
        debugPrint('OpenPickTasksNotifier network-first fallback to cache: $e\n$st');
      }
      return cached;
    }
  }

  Future<void> refreshFromNetwork() async {
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
    if (!online) {
      state = AsyncData<List<PickingListItem>>(await _loadCache(db));
      return;
    }
    state = await AsyncValue.guard(() async {
      final List<PickingListItem> list =
          await ref.read(pickingRepositoryProvider).getOpenTasks(limit: _openTasksLimit);
      await db?.saveCachedPickTasks(
        list.map((PickingListItem e) => e.toJson()).toList(growable: false),
      );
      return list;
    });
  }
}

final openPickTasksProvider =
    AsyncNotifierProvider.autoDispose<OpenPickTasksNotifier, List<PickingListItem>>(
  OpenPickTasksNotifier.new,
);

class PickTaskDetailNotifier extends AutoDisposeFamilyAsyncNotifier<PickingDocument, String> {
  /// Har optimistik pick yangilanishida oshadi — eskirgan reconcile fetch
  /// yangiroq holatni ustiga yozib yubormasligi uchun (poyga himoyasi).
  int _pickSeq = 0;

  Future<void> _silentFetch(String taskId) async {
    try {
      final PickingDocument d =
          await ref.read(pickingRepositoryProvider).getTaskById(taskId);
      final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
      await db?.saveCachedPickTaskDetail(taskId, d.toJson());
      state = AsyncData<PickingDocument>(d);
    } on Object catch (e) {
      if (kDebugMode) {
        debugPrint('PickTaskDetailNotifier silent fetch: $e');
      }
    }
  }

  @override
  Future<PickingDocument> build(String taskId) async {
    final bool online = ref.watch(networkOnlineProvider).valueOrNull ?? true;
    final OfflineDatabase? db = await ref.watch(offlineDatabaseProvider.future);
    if (db != null) {
      final Map<String, Object?>? raw = await db.getCachedPickTaskDetail(taskId);
      if (raw != null && raw.isNotEmpty) {
        final PickingDocument doc = PickingDocument.fromJson(raw);
        if (online) {
          unawaited(_silentFetch(taskId));
        }
        return doc;
      }
    }
    if (!online) {
      throw Exception('Oflayn: vazifa keshda yo‘q');
    }
    final PickingDocument d =
        await ref.read(pickingRepositoryProvider).getTaskById(taskId);
    await db?.saveCachedPickTaskDetail(taskId, d.toJson());
    return d;
  }

  Future<void> applyPickLineResponse(String taskId, PickLineResponse res) async {
    final PickingDocument? cur = state.valueOrNull;
    if (cur == null) {
      return;
    }
    final PickingDocument next = cur.applyPickLineResponse(res);
    final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
    await db?.saveCachedPickTaskDetail(taskId, next.toJson());
    final int seq = ++_pickSeq;
    state = AsyncData<PickingDocument>(next);
    // Bitta qatorli javob server tomonidagi kaskadlarni (qo'shni promo qatori,
    // hujjat holati va h.k.) to'liq aks ettirmasligi mumkin — natijada karta
    // yashil bo'lmay qolib, faqat chiqib-kirgach yangilanadi. Jimgina qayta
    // o'qib, holatni server bilan moslashtiramiz (spinner yo'q). Oraliqda
    // yangiroq pick bo'lsa (seq o'zgargan bo'lsa), natija tashlab yuboriladi.
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    if (online) {
      unawaited(_reconcileAfterPick(taskId, seq));
    }
  }

  Future<void> _reconcileAfterPick(String taskId, int seq) async {
    try {
      final PickingDocument d =
          await ref.read(pickingRepositoryProvider).getTaskById(taskId);
      if (seq != _pickSeq) {
        return; // Oraliqda yangiroq optimistik yangilanish bo'ldi — ustiga yozmaymiz.
      }
      final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
      await db?.saveCachedPickTaskDetail(taskId, d.toJson());
      state = AsyncData<PickingDocument>(d);
    } on Object catch (e) {
      if (kDebugMode) {
        debugPrint('PickTaskDetailNotifier reconcile after pick: $e');
      }
    }
  }
}

final pickTaskDetailProvider = AsyncNotifierProvider.autoDispose
    .family<PickTaskDetailNotifier, PickingDocument, String>(
  PickTaskDetailNotifier.new,
);

class ConsolidatedViewNotifier extends AutoDisposeAsyncNotifier<ConsolidatedViewResponse> {
  static const String _prefsKey = 'cached_consolidated_view_v1';

  Future<ConsolidatedViewResponse?> _readPrefs() async {
    try {
      final String? raw = ref.read(sharedPreferencesProvider).getString(_prefsKey);
      if (raw == null || raw.isEmpty) {
        return null;
      }
      final Object? dec = jsonDecode(raw);
      if (dec is! Map) {
        return null;
      }
      return ConsolidatedViewResponse.fromJson(
        Map<String, Object?>.from(dec),
      );
    } on Object {
      return null;
    }
  }

  Future<void> _writePrefs(ConsolidatedViewResponse v) async {
    await ref
        .read(sharedPreferencesProvider)
        .setString(_prefsKey, jsonEncode(v.toJson()));
  }

  Future<void> _fetchBackground() async {
    try {
      final ConsolidatedViewResponse v =
          await ref.read(pickingRepositoryProvider).getConsolidatedView();
      await _writePrefs(v);
      state = AsyncData<ConsolidatedViewResponse>(v);
    } on Object catch (e) {
      if (kDebugMode) {
        debugPrint('ConsolidatedViewNotifier background: $e');
      }
    }
  }

  @override
  Future<ConsolidatedViewResponse> build() async {
    final bool online = ref.watch(networkOnlineProvider).valueOrNull ?? true;
    final ConsolidatedViewResponse? cached = await _readPrefs();

    if (!online) {
      return cached ??
          const ConsolidatedViewResponse(
            documents: <ConsolidatedDocumentSummary>[],
            products: <ConsolidatedProduct>[],
          );
    }

    if (cached != null) {
      unawaited(_fetchBackground());
      return cached;
    }

    final ConsolidatedViewResponse v =
        await ref.read(pickingRepositoryProvider).getConsolidatedView();
    await _writePrefs(v);
    return v;
  }

  Future<void> refreshFromNetwork() async {
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    if (!online) {
      final ConsolidatedViewResponse? cached = await _readPrefs();
      state = AsyncData<ConsolidatedViewResponse>(
        cached ??
            const ConsolidatedViewResponse(
              documents: <ConsolidatedDocumentSummary>[],
              products: <ConsolidatedProduct>[],
            ),
      );
      return;
    }
    state = await AsyncValue.guard(() async {
      final ConsolidatedViewResponse v =
          await ref.read(pickingRepositoryProvider).getConsolidatedView();
      await _writePrefs(v);
      return v;
    });
  }
}

final consolidatedViewProvider =
    AsyncNotifierProvider.autoDispose<ConsolidatedViewNotifier, ConsolidatedViewResponse>(
  ConsolidatedViewNotifier.new,
);

final pickerStatsProvider = FutureProvider.autoDispose<MyPickerStats>(
  (Ref ref) => ref.watch(pickingRepositoryProvider).getMyPickerStats(),
);

/// Skaner `router.go` o‘rniga `pop` qilganda vazifa detaliga skan natijasini yetkazish.
class PickTaskScanFromScanner {
  const PickTaskScanFromScanner({
    required this.taskId,
    required this.barcode,
    this.lineId,
    required this.profileQuery,
  });

  final String taskId;
  final String barcode;
  final String? lineId;
  final String profileQuery;
}

final pendingPickTaskScanProvider = StateProvider<PickTaskScanFromScanner?>((Ref ref) => null);

/// Skaner `returnToConsolidated` dan `pop` keyin ro‘yxatga skan yetkazish.
class ConsolidatedScanFromScanner {
  const ConsolidatedScanFromScanner({
    required this.profileQuery,
    required this.barcode,
    this.selectedProductKey,
  });

  final String profileQuery;
  final String barcode;
  final String? selectedProductKey;
}

final pendingConsolidatedScanProvider = StateProvider<ConsolidatedScanFromScanner?>((Ref ref) => null);

/// App startup gate: auth holati + task badge manbasi tayyor bo‘lgandan keyin
/// asosiy router UI ko‘rinadi.
final startupBootstrapProvider = FutureProvider<bool>((Ref ref) async {
  final AuthSession auth = await ref.watch(authControllerProvider.future);
  if (!auth.isAuthenticated) {
    return true;
  }
  try {
    await ref.read(openPickTasksProvider.notifier).refreshFromNetwork();
    await ref.read(consolidatedViewProvider.notifier).refreshFromNetwork();
  } on Object catch (e, st) {
    if (kDebugMode) {
      debugPrint('startupBootstrapProvider refresh warning: $e\n$st');
    }
  }
  return true;
});
