import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';

import '../../features/picking/data/picking_repository.dart';

/// Admin tayinlash / ro‘yxat yangilashi: ilova [registerPickTasksPushHandler] orqali sinxron.
typedef PickTasksPushCallback = void Function({String? taskId});

/// RN `pushNotifications.ts` — token ro‘yxatdan o‘tkazish + bildirishnoma → vazifa.
class FcmService {
  FcmService._();

  static bool _inited = false;
  static GoRouter? _router;
  static String? _pendingTaskId;
  static PickTasksPushCallback? _onPickTasksPush;

  static void bindRouter(GoRouter router) {
    _router = router;
    final String? p = _pendingTaskId;
    if (p != null && p.isNotEmpty) {
      _pendingTaskId = null;
      router.goNamed(
        'pickTaskDetail',
        pathParameters: <String, String>{'taskId': p},
      );
    }
  }

  static void _navigateToTask(String taskId) {
    final GoRouter? r = _router;
    if (r != null) {
      r.goNamed(
        'pickTaskDetail',
        pathParameters: <String, String>{'taskId': taskId},
      );
    } else {
      _pendingTaskId = taskId;
    }
  }

  static void registerPickTasksPushHandler(PickTasksPushCallback? cb) {
    _onPickTasksPush = cb;
  }

  static String? _taskIdFromData(Map<String, dynamic> data) {
    final Object? tid = data['taskId'];
    final String? taskId = tid is String ? tid : tid?.toString();
    if (taskId == null || taskId.isEmpty) {
      return null;
    }
    return taskId;
  }

  /// Data-only xabar: `type: open_tasks_refresh` yoki `taskId` (tayinlash).
  static void _handlePickTasksData(Map<String, dynamic> data) {
    final String? type = data['type']?.toString();
    final String? taskId = _taskIdFromData(data);
    final bool refresh =
        type == 'open_tasks_refresh' || (taskId != null && taskId.isNotEmpty);
    if (refresh) {
      _onPickTasksPush?.call(taskId: taskId);
    }
  }

  static void _handleOpen(Map<String, dynamic> data) {
    _handlePickTasksData(data);
    final String? taskId = _taskIdFromData(data);
    if (taskId != null) {
      _navigateToTask(taskId);
    }
  }

  static void _handleForegroundData(Map<String, dynamic> data) {
    _handlePickTasksData(data);
  }

  static Future<void> ensureInitialized() async {
    if (_inited || kIsWeb) {
      return;
    }
    try {
      await Firebase.initializeApp();
      final FirebaseMessaging msg = FirebaseMessaging.instance;
      await msg.requestPermission();
      FirebaseMessaging.onMessage.listen((RemoteMessage m) {
        debugPrint('FCM foreground: ${m.notification?.title}');
        if (m.data.isNotEmpty) {
          _handleForegroundData(Map<String, dynamic>.from(m.data));
        }
      });
      FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage m) {
        _handleOpen(Map<String, dynamic>.from(m.data));
      });
      final RemoteMessage? initial = await msg.getInitialMessage();
      if (initial != null) {
        _handleOpen(Map<String, dynamic>.from(initial.data));
      }
      final String? token = await msg.getToken();
      debugPrint('FCM token: ${token != null ? 'ok' : 'null'}');
      _inited = true;
    } on Object catch (e) {
      debugPrint('FCM init skipped: $e');
    }
  }

  static Future<void> registerTokenIfPossible(PickingRepository pickingRepo) async {
    try {
      final String? t = await FirebaseMessaging.instance.getToken();
      if (t == null || t.isEmpty) {
        return;
      }
      await pickingRepo.registerFcmToken(token: t);
    } on Object catch (e) {
      debugPrint('FCM register skipped: $e');
    }
  }
}
