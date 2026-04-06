import 'dart:convert';

import '../../features/picking/data/picking_repository.dart';
import '../network/app_dio.dart';
import 'offline_database.dart';

/// RN `syncEngine.syncPendingQueue` paritet.
class OfflineSyncService {
  OfflineSyncService(this._db, this._picking);

  final OfflineDatabase _db;
  final PickingRepository _picking;

  Future<SyncResult> syncPendingQueue({void Function(String id)? onItemDone}) async {
    final List<OfflineQueueRow> pending = await _db.queueGetPending();
    for (final OfflineQueueRow item in pending) {
      try {
        await _db.queueUpdateStatus(item.id, 'syncing');
        final Map<String, Object?> payload =
            Map<String, Object?>.from(jsonDecode(item.payloadJson) as Map);
        switch (item.type) {
          case 'PICK_SCAN':
            final String taskId = payload['taskId']! as String;
            final String barcode = payload['barcode']! as String;
            await _picking.submitScan(taskId, barcode: barcode, qty: 1);
            break;
          case 'PICK_SET_QTY':
          case 'PICK_CONFIRM_ITEM':
            final String lineId = payload['itemId']! as String;
            final int count = (payload['qty'] as num?)?.toInt() ?? 1;
            await _picking.pickLine(
              lineId,
              count,
              'sync-${item.id}-${DateTime.now().millisecondsSinceEpoch}',
            );
            break;
          case 'PICK_CLOSE_TASK':
            final String taskId = payload['taskId']! as String;
            final String? reason = payload['incomplete_reason'] as String?;
            await _picking.completePickDocument(
              taskId,
              incompleteReason: reason,
            );
            break;
          default:
            await _db.queueUpdateStatus(
              item.id,
              'failed',
              'Unknown type: ${item.type}',
            );
            continue;
        }
        await _db.queueUpdateStatus(item.id, 'done');
        onItemDone?.call(item.id);
      } on Exception catch (e) {
        final String msg = e.toString();
        if (msg.contains(unauthorizedMessage)) {
          await _db.queueUpdateStatus(item.id, 'pending');
          return SyncResult(ok: false, needReauth: true, error: msg);
        }
        await _db.queueUpdateStatus(item.id, 'failed', msg);
        return SyncResult(ok: false, error: msg);
      }
    }
    return const SyncResult(ok: true);
  }
}

class SyncResult {
  const SyncResult({
    required this.ok,
    this.needReauth = false,
    this.error,
  });

  final bool ok;
  final bool needReauth;
  final String? error;
}
