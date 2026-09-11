import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/app_dio.dart';
import '../../core/offline/offline_database.dart';
import '../../core/offline/offline_providers.dart';
import 'data/dealer_counts_models.dart';
import 'data/dealer_counts_repository.dart';

final dealerCountsRepositoryProvider = Provider<DealerCountsRepository>((Ref ref) {
  return DealerCountsRepository(ref.watch(appDioProvider));
});

final dealersProvider = FutureProvider<List<Dealer>>((Ref ref) {
  return ref.watch(dealerCountsRepositoryProvider).listDealers();
});

/// Telefondagi draftlar (sqflite). Har saqlashdan keyin `invalidate` qilinadi.
final dealerCountDraftsProvider = FutureProvider<List<DealerCountDraft>>((Ref ref) async {
  final OfflineDatabase? db = await ref.watch(offlineDatabaseProvider.future);
  if (db == null) {
    return const <DealerCountDraft>[];
  }
  final List<Map<String, Object?>> rows = await db.dealerDraftsAll();
  return rows.map(DealerCountDraft.fromJson).toList(growable: false);
});

final dealerCountDraftProvider =
    FutureProvider.family<DealerCountDraft?, String>((Ref ref, String clientUuid) async {
  final List<DealerCountDraft> all = await ref.watch(dealerCountDraftsProvider.future);
  for (final DealerCountDraft d in all) {
    if (d.clientUuid == clientUuid) {
      return d;
    }
  }
  return null;
});

/// Mening serverga yuborilgan sanovlarim (oxirgilari).
final myDealerCountsProvider = FutureProvider<List<DealerCount>>((Ref ref) {
  return ref.watch(dealerCountsRepositoryProvider).listMine();
});

final dealerCountDetailProvider =
    FutureProvider.family<DealerCount, String>((Ref ref, String id) {
  return ref.watch(dealerCountsRepositoryProvider).get(id);
});
