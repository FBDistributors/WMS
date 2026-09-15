import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/app_dio.dart';
import '../../core/offline/offline_database.dart';
import 'data/dealer_counts_models.dart';
import 'data/dealer_counts_repository.dart';

final dealerCountsRepositoryProvider = Provider<DealerCountsRepository>((Ref ref) {
  return DealerCountsRepository(ref.watch(appDioProvider));
});

/// Faol sanovlar (har dillerda bitta) — faqat serverdan, telefonda nusxa yo'q.
final dealerActiveCountsProvider = FutureProvider.autoDispose<List<DealerCount>>((Ref ref) {
  return ref.watch(dealerCountsRepositoryProvider).listActive();
});

/// 1.0.49 gacha telefonda saqlangan nusxalar (sqflite `dealer_count_drafts`) — onlayn versiyaga
/// o'tishda bir marta ko'rib chiqiladi: yuborilmagan kiritishlar yuboriladi (o'sha `op_id` lar
/// bilan — takror qo'shilmaydi), keyin nusxa o'chiriladi. Sanov o'chirilgan bo'lsa (404) —
/// kiritishlar tashlanadi. Internet yo'q bo'lsa nusxa keyingi safargacha qoladi.
/// Qaytaradi: tashlangan (o'chirilgan sanovdagi) kiritishlar soni.
Future<int> migrateLegacyDealerDrafts(OfflineDatabase db, DealerCountsRepository repo) async {
  int dropped = 0;
  for (final Map<String, Object?> row in await db.dealerDraftsAll()) {
    final ({String countId, List<Map<String, Object?>> entries})? legacy = legacyDraftEntries(row);
    if (legacy == null) {
      // 1.0.45 gacha noldan boshlangan bo'sh draftlar — kalit `client_uuid`.
      if (row['client_uuid'] is String) {
        await db.dealerDraftDelete(row['client_uuid']! as String);
      }
      continue;
    }
    final String key = 'sheet:${legacy.countId}';
    if (legacy.entries.isEmpty) {
      await db.dealerDraftDelete(key);
      continue;
    }
    try {
      await repo.putCounts(legacy.countId, legacy.entries);
      await db.dealerDraftDelete(key);
    } on DealerSheetGoneException {
      dropped += legacy.entries.length;
      await db.dealerDraftDelete(key);
    } on Exception {
      // internet yo'q / server xatosi — keyingi safar yana urinadi
    }
  }
  return dropped;
}
