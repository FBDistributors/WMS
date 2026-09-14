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

/// Ro'yxat ekrani uchun: serverdagi menga ochiq ro'yxatlar + telefondagi nusxalarim.
class DealerSheetsView {
  const DealerSheetsView({required this.server, required this.local, this.error});

  final List<DealerCount> server;

  /// Joriy xodimning nusxalari (serverda hali ochiq, yoki server javob bermadi).
  final List<DealerSheetDraft> local;

  /// Server ro'yxati ochilmadi (internet yo'q) — faqat telefondagi nusxalar.
  final Object? error;
}

/// Server javob bersa — unda yo'q nusxalarim eskirgan (web'da o'chirilgan, yuborilgan
/// yoki qulf ochilib boshqa xodim olgan): ularni yuborib bo'lmaydi, telefondan o'chiriladi.
/// Aks holda "Tayyor ro'yxatlar"da serverda yo'q ro'yxat ko'rinib turadi.
final dealerSheetsViewProvider = FutureProvider<DealerSheetsView>((Ref ref) async {
  final String? me = ref.watch(authControllerProvider).valueOrNull?.me?.id;
  final List<DealerSheetDraft> mine = (await ref.watch(dealerSheetDraftsProvider.future))
      .where((DealerSheetDraft d) => d.belongsTo(me))
      .toList(growable: false);
  final List<DealerCount> server;
  try {
    server = await ref.watch(dealerCountsRepositoryProvider).listSheets();
  } on Exception catch (e) {
    return DealerSheetsView(server: const <DealerCount>[], local: mine, error: e);
  }
  final Set<String> open = server.map((DealerCount c) => c.id).toSet();
  final List<DealerSheetDraft> stale = mine.where((DealerSheetDraft d) => !open.contains(d.countId)).toList();
  if (stale.isNotEmpty) {
    final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
    for (final DealerSheetDraft d in stale) {
      await db?.dealerDraftDelete(DealerSheetDraft.storageKey(d.countId));
    }
    // Keyingi o'qishda (ro'yxat ekrani, ro'yxat ichi) o'chirilganlar qaytmasin.
    Future<void>.microtask(() => ref.invalidate(dealerSheetDraftsProvider));
  }
  return DealerSheetsView(
    server: server,
    local: mine.where((DealerSheetDraft d) => open.contains(d.countId)).toList(growable: false),
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

/// Mening yuborgan sanovlarim (Tarix).
final myDealerCountsProvider = FutureProvider<List<DealerCount>>((Ref ref) {
  return ref.watch(dealerCountsRepositoryProvider).listMine();
});

final dealerCountDetailProvider =
    FutureProvider.family<DealerCount, String>((Ref ref, String id) {
  return ref.watch(dealerCountsRepositoryProvider).get(id);
});
