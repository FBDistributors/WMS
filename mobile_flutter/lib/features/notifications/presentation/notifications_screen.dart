import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/errors/api_error_localization.dart';
import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../l10n/string_lookup.dart';
import '../data/notification_item.dart';
import '../notifications_providers.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final AsyncValue<List<NotificationItem>> async = ref.watch(notificationsControllerProvider);

    final Color appBarFg =
        Theme.of(context).appBarTheme.foregroundColor ?? Theme.of(context).colorScheme.onSurface;
    return Scaffold(
      appBar: AppBar(
        foregroundColor: appBarFg,
        title: Text(
          StringLookup.t(loc, 'notifications'),
          style: TextStyle(color: appBarFg),
        ),
        actions: <Widget>[
          IconButton(
            tooltip: StringLookup.t(loc, 'notificationsMarkAllRead'),
            onPressed: () =>
                ref.read(notificationsControllerProvider.notifier).markAllRead(),
            icon: const Icon(Icons.done_all_rounded),
          ),
        ],
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (Object e, StackTrace st) => Center(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(localizeApiErrorMessage(ref.read(appLocaleProvider), e), textAlign: TextAlign.center),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: () =>
                      ref.read(notificationsControllerProvider.notifier).refresh(),
                  child: Text(StringLookup.t(loc, 'retry')),
                ),
              ],
            ),
          ),
        ),
        data: (List<NotificationItem> list) {
          if (list.isEmpty) {
            return Center(
              child: Text(StringLookup.t(loc, 'notificationsEmpty')),
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(12),
            itemCount: list.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (BuildContext context, int index) {
              final NotificationItem item = list[index];
              final String date = _prettyDate(item.createdAt, loc);
              final Color bg = item.isRead
                  ? Theme.of(context).colorScheme.surface
                  : Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.45);
              return Card(
                color: bg,
                child: ListTile(
                  onTap: item.isRead
                      ? null
                      : () => ref.read(notificationsControllerProvider.notifier).markRead(item.id),
                  title: Text(
                    item.title,
                    style: TextStyle(
                      fontWeight: item.isRead ? FontWeight.w500 : FontWeight.w700,
                    ),
                  ),
                  subtitle: Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text('${item.body}\n$date'),
                  ),
                  isThreeLine: true,
                  trailing: item.isRead
                      ? null
                      : Icon(
                          Icons.circle,
                          size: 10,
                          color: Theme.of(context).colorScheme.primary,
                        ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

String _prettyDate(DateTime dt, AppLocale loc) {
  final String tag = switch (loc) {
    AppLocale.uz => 'uz_UZ',
    AppLocale.ru => 'ru_RU',
    AppLocale.en => 'en_US',
  };
  return DateFormat.yMd(tag).add_jm().format(dt.toLocal());
}
