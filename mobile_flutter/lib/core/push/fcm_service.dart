import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:go_router/go_router.dart';

import '../../features/picking/data/picking_repository.dart';

/// Android channel id — backend `push_notifications.FCM_ANDROID_CHANNEL_ID` bilan mos.
const String _androidChannelId = 'wms_picking';

/// Admin tayinlash / ro‘yxat yangilashi: ilova [registerPickTasksPushHandler] orqali sinxron.
typedef PickTasksPushCallback = void Function({String? taskId});

/// RN `pushNotifications.ts` — token ro‘yxatdan o‘tkazish + bildirishnoma → vazifa.
class FcmService {
  FcmService._();

  static bool _inited = false;
  static GoRouter? _router;
  static String? _pendingTaskId;
  static PickTasksPushCallback? _onPickTasksPush;
  static final FlutterLocalNotificationsPlugin _local = FlutterLocalNotificationsPlugin();
  static int _localNotifyId = 0;

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

  static Map<String, dynamic> _payloadMapForTap(RemoteMessage m) {
    final Map<String, dynamic> data = Map<String, dynamic>.from(m.data);
    if (m.notification?.title != null) {
      data.putIfAbsent('_title', () => m.notification!.title!);
    }
    if (m.notification?.body != null) {
      data.putIfAbsent('_body', () => m.notification!.body!);
    }
    return data;
  }

  static Future<void> _ensureLocalNotificationsReady() async {
    const AndroidInitializationSettings androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const DarwinInitializationSettings iosInit = DarwinInitializationSettings();
    await _local.initialize(
      const InitializationSettings(android: androidInit, iOS: iosInit),
      onDidReceiveNotificationResponse: _onLocalNotificationResponse,
    );
    final AndroidFlutterLocalNotificationsPlugin? android =
        _local.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    await android?.createNotificationChannel(
      const AndroidNotificationChannel(
        _androidChannelId,
        'WMS terish',
        description: 'Buyurtma tayinlash va tizim xabarlari',
        importance: Importance.high,
      ),
    );
    await android?.requestNotificationsPermission();
  }

  static void _onLocalNotificationResponse(NotificationResponse response) {
    final String? payload = response.payload;
    if (payload == null || payload.isEmpty) {
      return;
    }
    try {
      final Object? decoded = jsonDecode(payload);
      if (decoded is Map<String, dynamic>) {
        _handleOpen(decoded);
      } else if (decoded is Map) {
        _handleOpen(Map<String, dynamic>.from(decoded));
      }
    } on Object catch (_) {
      /* ignore malformed */
    }
  }

  /// Mahalliy banner faqat foydalanuvchiga ko‘rinadigan pushlar uchun (data-only refreshlarni spam qilmaslik).
  static bool _shouldShowForegroundBanner(RemoteMessage m) {
    if (m.notification != null &&
        ((m.notification!.title ?? '').trim().isNotEmpty || (m.notification!.body ?? '').trim().isNotEmpty)) {
      return true;
    }
    final Map<String, dynamic> d = m.data;
    if (d.containsKey('taskId')) {
      return true;
    }
    final String? t = d['type']?.toString();
    return t == 'new_pick_task' || t == 'admin_test';
  }

  static Future<void> _showForegroundBanner(RemoteMessage m) async {
    if (!_shouldShowForegroundBanner(m)) {
      return;
    }
    final String title = m.notification?.title?.trim().isNotEmpty == true
        ? m.notification!.title!.trim()
        : 'WMS';
    String body = m.notification?.body?.trim() ?? '';
    if (body.isEmpty && m.data.isNotEmpty) {
      body = m.data.entries.map((MapEntry<String, dynamic> e) => '${e.key}: ${e.value}').join(', ');
    }
    if (body.isEmpty) {
      body = 'Yangi xabar';
    }
    final String payload = jsonEncode(_payloadMapForTap(m));
    final NotificationDetails details = NotificationDetails(
      android: AndroidNotificationDetails(
        _androidChannelId,
        'WMS terish',
        channelDescription: 'Buyurtma tayinlash va tizim xabarlari',
        importance: Importance.high,
        priority: Priority.high,
        icon: '@mipmap/ic_launcher',
      ),
      iOS: const DarwinNotificationDetails(presentAlert: true, presentBadge: true, presentSound: true),
    );
    _localNotifyId = (_localNotifyId + 1) % 100000;
    await _local.show(_localNotifyId, title, body, details, payload: payload);
  }

  static Future<void> ensureInitialized() async {
    if (_inited || kIsWeb) {
      return;
    }
    try {
      await Firebase.initializeApp();
      await _ensureLocalNotificationsReady();
      final NotificationAppLaunchDetails? launchDetails = await _local.getNotificationAppLaunchDetails();
      Map<String, dynamic>? coldOpenFromLocal;
      if (launchDetails?.didNotificationLaunchApp == true) {
        final String? p = launchDetails!.notificationResponse?.payload;
        if (p != null && p.isNotEmpty) {
          try {
            final Object? decoded = jsonDecode(p);
            if (decoded is Map<String, dynamic>) {
              coldOpenFromLocal = decoded;
            } else if (decoded is Map) {
              coldOpenFromLocal = Map<String, dynamic>.from(decoded);
            }
          } on Object catch (_) {
            /* ignore */
          }
        }
      }
      final FirebaseMessaging msg = FirebaseMessaging.instance;
      await msg.requestPermission();
      FirebaseMessaging.onMessage.listen((RemoteMessage m) {
        debugPrint('FCM foreground: ${m.notification?.title}');
        if (m.data.isNotEmpty) {
          _handleForegroundData(Map<String, dynamic>.from(m.data));
        }
        unawaited(_showForegroundBanner(m));
      });
      FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage m) {
        _handleOpen(Map<String, dynamic>.from(m.data));
      });
      final RemoteMessage? initial = await msg.getInitialMessage();
      if (initial != null) {
        _handleOpen(Map<String, dynamic>.from(initial.data));
      } else if (coldOpenFromLocal != null) {
        _handleOpen(coldOpenFromLocal);
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
