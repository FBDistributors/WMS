import 'package:shared_preferences/shared_preferences.dart';

import '../../../core/app_state/prefs_keys.dart';
import 'notification_item.dart';
import 'notifications_repository.dart';

/// Ichki manbadan ro‘yxatni oladi va **mahalliy** o‘qilgan ID lar bilan birlashtiradi.
/// Ilova yopilganda ham badge tiklanmaydi (mock har safar bir xil ID lar bersa ham).
class PersistedNotificationsRepository implements NotificationsRepository {
  PersistedNotificationsRepository(this._prefs, this._inner);

  final SharedPreferences _prefs;
  final NotificationsRepository _inner;

  Future<Set<String>> _loadReadIds() async {
    final List<String>? list = _prefs.getStringList(PrefsKeys.notificationReadIds);
    return list?.toSet() ?? <String>{};
  }

  Future<void> _saveReadIds(Set<String> ids) async {
    await _prefs.setStringList(PrefsKeys.notificationReadIds, ids.toList());
  }

  @override
  Future<List<NotificationItem>> listNotifications() async {
    final List<NotificationItem> raw = await _inner.listNotifications();
    final Set<String> readIds = await _loadReadIds();
    return raw
        .map(
          (NotificationItem n) =>
              n.copyWith(isRead: n.isRead || readIds.contains(n.id)),
        )
        .toList(growable: false);
  }

  @override
  Future<void> markRead(String id) async {
    await _inner.markRead(id);
    final Set<String> readIds = await _loadReadIds();
    readIds.add(id);
    await _saveReadIds(readIds);
  }

  @override
  Future<void> markAllRead() async {
    final List<NotificationItem> snapshot = await _inner.listNotifications();
    await _inner.markAllRead();
    final Set<String> readIds = await _loadReadIds();
    for (final NotificationItem n in snapshot) {
      readIds.add(n.id);
    }
    await _saveReadIds(readIds);
  }
}
