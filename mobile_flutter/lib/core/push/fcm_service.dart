import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';

import '../../features/picking/data/picking_repository.dart';

/// RN `pushNotifications.ts` — token ro‘yxatdan o‘tkazish + bildirishnoma → vazifa.
class FcmService {
  FcmService._();

  static bool _inited = false;
  static GoRouter? _router;
  static String? _pendingTaskId;

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

  static void _handleOpen(Map<String, dynamic> data) {
    final Object? tid = data['taskId'];
    final String? taskId = tid is String ? tid : tid?.toString();
    if (taskId != null && taskId.isNotEmpty) {
      _navigateToTask(taskId);
    }
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
