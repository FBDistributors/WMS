import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_state/app_locale.dart';
import '../../core/app_state/locale_controller.dart';
import '../../features/notifications/presentation/notification_bell_button.dart';
import '../../l10n/string_lookup.dart';
import 'app_header.dart';

/// Asosiy picker tablari uchun yagona yuqori panel: hisob, [actionsBeforeNotification], bildirishnoma, yangilash.
class PickerTabAppHeader extends ConsumerWidget {
  const PickerTabAppHeader({
    super.key,
    required this.title,
    this.onRefresh,
    this.refreshing = false,
    this.headerBackgroundColor,
    this.titleColor,
    this.accentColor,
    this.actionsBeforeNotification = const <Widget>[],
    this.notificationIconColor = Colors.white,
  });

  final String title;
  final VoidCallback? onRefresh;
  final bool refreshing;
  final Color? headerBackgroundColor;
  final Color? titleColor;
  final Color? accentColor;
  final List<Widget> actionsBeforeNotification;
  final Color? notificationIconColor;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    return AppHeader(
      title: title,
      headerBackgroundColor: headerBackgroundColor,
      titleColor: titleColor,
      accentColor: accentColor,
      leading: IconButton(
        icon: const Icon(Icons.person_outline),
        onPressed: () => context.pushNamed('account'),
        tooltip: StringLookup.t(loc, 'tabAccount'),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          ...actionsBeforeNotification,
          NotificationBellButton(iconColor: notificationIconColor),
        ],
      ),
      onRefresh: onRefresh,
      refreshing: refreshing,
    );
  }
}
