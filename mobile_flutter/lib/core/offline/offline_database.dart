import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

/// React Native `offlineDb.ts` bilan bir xil sxema (`wms_offline.db`).
class OfflineDatabase {
  OfflineDatabase._(this._db);

  final Database _db;

  static const String _name = 'wms_offline.db';

  static OfflineDatabase? _instance;

  static Future<OfflineDatabase> instance() async {
    if (kIsWeb) {
      throw UnsupportedError('Offline DB is mobile/desktop only');
    }
    if (_instance != null) {
      return _instance!;
    }
    final String dir = (await getApplicationDocumentsDirectory()).path;
    final String path = p.join(dir, _name);
    final Database db = await openDatabase(
      path,
      version: 1,
      onCreate: (Database db, int v) async {
        await db.execute('''
          CREATE TABLE IF NOT EXISTS cached_pick_tasks (
            id TEXT PRIMARY KEY,
            data_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          );
        ''');
        await db.execute('''
          CREATE TABLE IF NOT EXISTS cached_pick_task_items (
            task_id TEXT PRIMARY KEY,
            data_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          );
        ''');
        await db.execute('''
          CREATE TABLE IF NOT EXISTS barcode_index (
            barcode TEXT PRIMARY KEY,
            product_id TEXT,
            task_id TEXT,
            line_id TEXT,
            payload_json TEXT,
            updated_at INTEGER NOT NULL
          );
        ''');
        await db.execute('''
          CREATE TABLE IF NOT EXISTS offline_queue (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            status TEXT NOT NULL,
            error TEXT
          );
        ''');
      },
    );
    _instance = OfflineDatabase._(db);
    return _instance!;
  }

  Future<void> saveCachedPickTasks(List<Map<String, Object?>> tasks) async {
    final int now = DateTime.now().millisecondsSinceEpoch;
    final Batch b = _db.batch();
    for (final Map<String, Object?> task in tasks) {
      final String? id = task['id'] as String?;
      if (id == null) {
        continue;
      }
      b.insert(
        'cached_pick_tasks',
        <String, Object?>{
          'id': id,
          'data_json': jsonEncode(task),
          'updated_at': now,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }
    await b.commit(noResult: true);
  }

  Future<List<Map<String, Object?>>> getCachedPickTasks() async {
    final List<Map<String, Object?>> rows = await _db.query(
      'cached_pick_tasks',
      columns: <String>['data_json'],
      orderBy: 'updated_at DESC',
    );
    return rows
        .map((Map<String, Object?> r) {
          final Object? j = r['data_json'];
          if (j is! String) {
            return <String, Object?>{};
          }
          final Object? dec = jsonDecode(j);
          return dec is Map<String, Object?>
              ? dec
              : Map<String, Object?>.from(dec as Map);
        })
        .where((Map<String, Object?> m) => m.isNotEmpty)
        .toList(growable: false);
  }

  Future<void> saveCachedPickTaskDetail(
    String taskId,
    Map<String, Object?> doc,
  ) async {
    final int now = DateTime.now().millisecondsSinceEpoch;
    await _db.insert(
      'cached_pick_task_items',
      <String, Object?>{
        'task_id': taskId,
        'data_json': jsonEncode(doc),
        'updated_at': now,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
    final List<Object?> linesRaw = doc['lines'] is List ? doc['lines']! as List : const <Object?>[];
    final Batch b = _db.batch();
    for (final Object? lineObj in linesRaw) {
      if (lineObj is! Map) {
        continue;
      }
      final Map<String, Object?> line = Map<String, Object?>.from(lineObj);
      final String barcode =
          '${line['barcode'] ?? line['sku'] ?? ''}'.trim().toLowerCase();
      if (barcode.isEmpty) {
        continue;
      }
      b.insert(
        'barcode_index',
        <String, Object?>{
          'barcode': barcode,
          'product_id': line['product_id'] ?? '',
          'task_id': taskId,
          'line_id': line['id'] ?? '',
          'payload_json': jsonEncode(line),
          'updated_at': now,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }
    await b.commit(noResult: true);
  }

  Future<Map<String, Object?>?> getCachedPickTaskDetail(String taskId) async {
    final List<Map<String, Object?>> rows = await _db.query(
      'cached_pick_task_items',
      where: 'task_id = ?',
      whereArgs: <Object>[taskId],
      limit: 1,
    );
    if (rows.isEmpty) {
      return null;
    }
    final Object? j = rows.first['data_json'];
    if (j is! String) {
      return null;
    }
    final Object? dec = jsonDecode(j);
    return dec is Map<String, Object?>
        ? dec
        : Map<String, Object?>.from(dec as Map);
  }

  Future<void> queueAdd(
    String id,
    String type,
    Map<String, Object?> payload,
    String status,
  ) async {
    final int now = DateTime.now().millisecondsSinceEpoch;
    await _db.insert(
      'offline_queue',
      <String, Object?>{
        'id': id,
        'type': type,
        'payload_json': jsonEncode(payload),
        'created_at': now,
        'status': status,
        'error': null,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> queueUpdateStatus(
    String id,
    String status, [
    String? error,
  ]) async {
    await _db.update(
      'offline_queue',
      <String, Object?>{'status': status, 'error': error},
      where: 'id = ?',
      whereArgs: <Object>[id],
    );
  }

  Future<List<OfflineQueueRow>> queueGetPending() async {
    final List<Map<String, Object?>> rows = await _db.query(
      'offline_queue',
      where: "status = 'pending'",
      orderBy: 'created_at ASC',
    );
    return rows.map(OfflineQueueRow.fromMap).toList(growable: false);
  }

  Future<List<OfflineQueueRow>> queueGetFailed() async {
    final List<Map<String, Object?>> rows = await _db.query(
      'offline_queue',
      where: "status = 'failed'",
      orderBy: 'created_at ASC',
    );
    return rows.map(OfflineQueueRow.fromMap).toList(growable: false);
  }

  Future<int> queueGetPendingCount() async {
    final List<Map<String, Object?>> r = await _db.rawQuery(
      "SELECT COUNT(*) as c FROM offline_queue WHERE status = 'pending'",
    );
    if (r.isEmpty) {
      return 0;
    }
    return (r.first['c'] as int?) ?? 0;
  }
}

class OfflineQueueRow {
  const OfflineQueueRow({
    required this.id,
    required this.type,
    required this.payloadJson,
    required this.createdAt,
    required this.status,
    required this.error,
  });

  final String id;
  final String type;
  final String payloadJson;
  final int createdAt;
  final String status;
  final String? error;

  static OfflineQueueRow fromMap(Map<String, Object?> m) {
    return OfflineQueueRow(
      id: m['id']! as String,
      type: m['type']! as String,
      payloadJson: m['payload_json']! as String,
      createdAt: (m['created_at'] as int?) ?? 0,
      status: m['status']! as String,
      error: m['error'] as String?,
    );
  }
}
