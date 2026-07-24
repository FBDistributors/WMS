import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/errors/api_error_localization.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/offline/offline_database.dart';
import '../../../core/offline/offline_providers.dart';
import '../../../core/offline/offline_sync_service.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';

class QueueScreen extends ConsumerWidget {
  const QueueScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final loc = ref.watch(appLocaleProvider);
    final AsyncValue<List<OfflineQueueRow>> pending = ref.watch(_pendingRowsProvider);
    final AsyncValue<List<OfflineQueueRow>> failed = ref.watch(_failedRowsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Offline navbat'),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop()),
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.sync),
            onPressed: () async {
              final OfflineSyncService? sync = ref.read(offlineSyncServiceProvider);
              if (sync == null) {
                return;
              }
              final SyncResult r = await sync.syncPendingQueue();
              ref.invalidate(_pendingRowsProvider);
              ref.invalidate(_failedRowsProvider);
              ref.invalidate(pendingQueueCountProvider);
              if (context.mounted && !r.ok) {
                showAppSnackBar(
                  context,
                  SnackBar(content: Text(r.error ?? StringLookup.t(loc, 'syncFailed'))),
                );
              }
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          const Text('Kutilmoqda', style: TextStyle(fontWeight: FontWeight.bold)),
          pending.when(
            data: (List<OfflineQueueRow> rows) => Column(
              children: rows
                  .map(
                    (OfflineQueueRow r) => ListTile(
                      title: Text(r.type),
                      subtitle: Text(r.id),
                    ),
                  )
                  .toList(),
            ),
            loading: () => const CircularProgressIndicator(),
            error: (Object e, _) =>
                Text(localizeApiErrorMessage(ref.read(appLocaleProvider), e)),
          ),
          const SizedBox(height: 24),
          const Text('Xato', style: TextStyle(fontWeight: FontWeight.bold)),
          failed.when(
            data: (List<OfflineQueueRow> rows) => Column(
              children: rows
                  .map(
                    (OfflineQueueRow r) => ListTile(
                      title: Text(r.type),
                      subtitle: Text(r.error ?? ''),
                    ),
                  )
                  .toList(),
            ),
            loading: () => const CircularProgressIndicator(),
            error: (Object e, _) =>
                Text(localizeApiErrorMessage(ref.read(appLocaleProvider), e)),
          ),
        ],
      ),
    );
  }
}

final _pendingRowsProvider = FutureProvider<List<OfflineQueueRow>>((Ref ref) async {
  final OfflineDatabase? db = await ref.watch(offlineDatabaseProvider.future);
  if (db == null) {
    return const <OfflineQueueRow>[];
  }
  return db.queueGetPending();
});

final _failedRowsProvider = FutureProvider<List<OfflineQueueRow>>((Ref ref) async {
  final OfflineDatabase? db = await ref.watch(offlineDatabaseProvider.future);
  if (db == null) {
    return const <OfflineQueueRow>[];
  }
  return db.queueGetFailed();
});
