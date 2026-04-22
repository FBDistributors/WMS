import 'dart:async' show unawaited;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'data/notification_item.dart';
import 'data/notifications_repository.dart';

final notificationsRepositoryProvider = Provider<NotificationsRepository>((Ref ref) {
  return MockNotificationsRepository();
});

class NotificationsController extends StateNotifier<AsyncValue<List<NotificationItem>>> {
  NotificationsController(this._repo) : super(const AsyncValue.loading()) {
    unawaited(refresh());
  }

  final NotificationsRepository _repo;

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(_repo.listNotifications);
  }

  Future<void> markRead(String id) async {
    await _repo.markRead(id);
    await refresh();
  }

  Future<void> markAllRead() async {
    await _repo.markAllRead();
    await refresh();
  }
}

final notificationsControllerProvider =
    StateNotifierProvider<NotificationsController, AsyncValue<List<NotificationItem>>>(
  (Ref ref) {
    return NotificationsController(ref.watch(notificationsRepositoryProvider));
  },
);

final notificationsUnreadCountProvider = Provider<int>((Ref ref) {
  return ref.watch(notificationsControllerProvider).maybeWhen(
        data: (List<NotificationItem> list) =>
            list.where((NotificationItem n) => !n.isRead).length,
        orElse: () => 0,
      );
});
