import 'notification_item.dart';

abstract class NotificationsRepository {
  Future<List<NotificationItem>> listNotifications();
  Future<void> markRead(String id);
  Future<void> markAllRead();
}

class MockNotificationsRepository implements NotificationsRepository {
  MockNotificationsRepository()
      : _items = <NotificationItem>[
          NotificationItem(
            id: 'n-1',
            title: 'Yangi pick vazifa',
            body: 'Sizga yangi yig‘ish vazifasi biriktirildi.',
            createdAt: DateTime.now().subtract(const Duration(minutes: 6)),
            isRead: false,
            type: 'pick_task',
          ),
          NotificationItem(
            id: 'n-2',
            title: 'Qaytim navbati',
            body: 'Mijoz qaytarish navbatida yangi hujjat bor.',
            createdAt: DateTime.now().subtract(const Duration(hours: 1, minutes: 20)),
            isRead: false,
            type: 'customer_return',
          ),
          NotificationItem(
            id: 'n-3',
            title: 'Inventarizatsiya eslatmasi',
            body: 'Asosiy ombor bo‘yicha inventarizatsiya davom etmoqda.',
            createdAt: DateTime.now().subtract(const Duration(hours: 4)),
            isRead: true,
            type: 'inventory',
          ),
        ];

  List<NotificationItem> _items;

  @override
  Future<List<NotificationItem>> listNotifications() async {
    await Future<void>.delayed(const Duration(milliseconds: 120));
    final List<NotificationItem> copy = <NotificationItem>[..._items];
    copy.sort((NotificationItem a, NotificationItem b) => b.createdAt.compareTo(a.createdAt));
    return copy;
  }

  @override
  Future<void> markRead(String id) async {
    _items = _items
        .map(
          (NotificationItem n) => n.id == id ? n.copyWith(isRead: true) : n,
        )
        .toList(growable: false);
  }

  @override
  Future<void> markAllRead() async {
    _items = _items
        .map((NotificationItem n) => n.isRead ? n : n.copyWith(isRead: true))
        .toList(growable: false);
  }
}
