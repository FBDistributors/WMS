import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/picking/picking_repository_provider.dart';
import 'offline_database.dart';
import 'offline_sync_service.dart';

final offlineDatabaseProvider = FutureProvider<OfflineDatabase?>((Ref ref) async {
  if (kIsWeb) {
    return null;
  }
  return OfflineDatabase.instance();
});

final offlineSyncServiceProvider = Provider<OfflineSyncService?>((Ref ref) {
  final AsyncValue<OfflineDatabase?> db = ref.watch(offlineDatabaseProvider);
  return db.maybeWhen(
    data: (OfflineDatabase? d) {
      if (d == null) {
        return null;
      }
      return OfflineSyncService(d, ref.watch(pickingRepositoryProvider));
    },
    orElse: () => null,
  );
});

final pendingQueueCountProvider = FutureProvider<int>((Ref ref) async {
  final OfflineDatabase? db = await ref.watch(offlineDatabaseProvider.future);
  if (db == null) {
    return 0;
  }
  return db.queueGetPendingCount();
});
