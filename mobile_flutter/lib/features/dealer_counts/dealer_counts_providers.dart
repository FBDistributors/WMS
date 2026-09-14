import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/app_dio.dart';
import '../../core/offline/offline_database.dart';
import '../../core/offline/offline_providers.dart';
import 'data/dealer_counts_models.dart';
import 'data/dealer_counts_repository.dart';

final dealerCountsRepositoryProvider = Provider<DealerCountsRepository>((Ref ref) {
  return DealerCountsRepository(ref.watch(appDioProvider));
});

/// Menga ochiq ro'yxatlar (web'da yaratilgan): olinmagan + men olgan.
final dealerSheetsProvider = FutureProvider<List<DealerCount>>((Ref ref) {
  return ref.watch(dealerCountsRepositoryProvider).listSheets();
});

/// Telefonga yuklab olingan ro'yxatlar (sqflite).
///
/// 1.0.45 gacha telefonda noldan boshlangan bo'sh draftlar ham shu jadvalda edi
/// (`kind` yo'q, kalit — `client_uuid`). Telefondan sanov yaratish yopilgan,
/// ular endi yuborilmaydi — shu yerda bir marta tozalanadi.
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

/// Mening yuborgan sanovlarim (Tarix).
final myDealerCountsProvider = FutureProvider<List<DealerCount>>((Ref ref) {
  return ref.watch(dealerCountsRepositoryProvider).listMine();
});

final dealerCountDetailProvider =
    FutureProvider.family<DealerCount, String>((Ref ref, String id) {
  return ref.watch(dealerCountsRepositoryProvider).get(id);
});
