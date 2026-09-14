import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/app_dio.dart';
import '../../core/offline/offline_database.dart';
import '../../core/offline/offline_providers.dart';
import '../auth/presentation/auth_providers.dart';
import 'data/dealer_counts_models.dart';
import 'data/dealer_counts_repository.dart';

final dealerCountsRepositoryProvider = Provider<DealerCountsRepository>((Ref ref) {
  return DealerCountsRepository(ref.watch(appDioProvider));
});

/// Telefonga yuklab olingan sanovlar (sqflite).
///
/// 1.0.45 gacha telefonda noldan boshlangan bo'sh draftlar ham shu jadvalda edi
/// (`kind` yo'q, kalit — `client_uuid`). Ular endi yuborilmaydi — shu yerda tozalanadi.
final dealerSheetDraftsProvider = FutureProvider<List<DealerSheetDraft>>((Ref ref) async {
  final OfflineDatabase? db = await ref.watch(offlineDatabaseProvider.future);
  if (db == null) {
    return const <DealerSheetDraft>[];
  }
  final List<Map<String, Object?>> rows = await db.dealerDraftsAll();
  final List<DealerSheetDraft> sheets = <DealerSheetDraft>[];
  for (final Map<String, Object?> r in rows) {
    if (r['kind'] == DealerSheetDraft.kind) {
      sheets.add(DealerSheetDraft.fromJson(r));
    } else if (r['client_uuid'] is String) {
      await db.dealerDraftDelete(r['client_uuid']! as String);
    }
  }
  return sheets;
});

/// Ro'yxat ekrani: faol sanovlar + telefondagi nusxalarim.
class DealerSheetsView {
  const DealerSheetsView({required this.server, required this.local, this.error});

  final List<DealerCount> server;

  /// Joriy xodimning nusxalari: serverda faol, yoki hali yuborilmagan qatori bor
  /// (sanov yopilgan/o'chirilgan bo'lsa ham — ichiga kirilganda yuboriladi yoki tozalanadi).
  final List<DealerSheetDraft> local;

  /// Server ro'yxati ochilmadi (internet yo'q) — faqat telefondagi nusxalar.
  final Object? error;
}

/// Server javob bersa — faol bo'lmagan va yuborilmagan qatori yo'q nusxalar o'chiriladi
/// (sanov yopilgan yoki o'chirilgan): aks holda ro'yxatda serverda yo'q sanov osilib qoladi.
final dealerSheetsViewProvider = FutureProvider<DealerSheetsView>((Ref ref) async {
  final String? me = ref.watch(authControllerProvider).valueOrNull?.me?.id;
  final List<DealerSheetDraft> mine = (await ref.watch(dealerSheetDraftsProvider.future))
      .where((DealerSheetDraft d) => d.belongsTo(me))
      .toList(growable: false);
  final List<DealerCount> server;
  try {
    server = await ref.watch(dealerCountsRepositoryProvider).listActive();
  } on Exception catch (e) {
    return DealerSheetsView(server: const <DealerCount>[], local: mine, error: e);
  }
  final Set<String> active = server.map((DealerCount c) => c.id).toSet();
  final List<DealerSheetDraft> stale = mine
      .where((DealerSheetDraft d) => !active.contains(d.countId) && d.pendingCount == 0)
      .toList(growable: false);
  if (stale.isNotEmpty) {
    final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
    for (final DealerSheetDraft d in stale) {
      await db?.dealerDraftDelete(DealerSheetDraft.storageKey(d.countId));
    }
    // Keyingi o'qishda (ro'yxat ekrani, sanov ichi) o'chirilganlar qaytmasin.
    Future<void>.microtask(() => ref.invalidate(dealerSheetDraftsProvider));
  }
  return DealerSheetsView(
    server: server,
    local: mine.where((DealerSheetDraft d) => !stale.contains(d)).toList(growable: false),
  );
});

final dealerSheetDraftProvider =
    FutureProvider.family<DealerSheetDraft?, String>((Ref ref, String countId) async {
  final List<DealerSheetDraft> all = await ref.watch(dealerSheetDraftsProvider.future);
  for (final DealerSheetDraft d in all) {
    if (d.countId == countId) {
      return d;
    }
  }
  return null;
});
