import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../notifications_providers.dart';

class NotificationBellButton extends ConsumerWidget {
  const NotificationBellButton({
    super.key,
    this.iconColor,
  });

  final Color? iconColor;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final int unread = ref.watch(notificationsUnreadCountProvider);
    return Stack(
      clipBehavior: Clip.none,
      children: <Widget>[
        IconButton(
          tooltip: 'Bildirishnomalar',
          onPressed: () => context.pushNamed('notifications'),
          icon: Icon(Icons.notifications_none_rounded, color: iconColor),
        ),
        if (unread > 0)
          Positioned(
            right: 8,
            top: 8,
            child: Container(
              constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
              padding: const EdgeInsets.symmetric(horizontal: 4),
              decoration: const BoxDecoration(
                color: Color(0xFFE53935),
                borderRadius: BorderRadius.all(Radius.circular(8)),
              ),
              child: Center(
                child: Text(
                  unread > 99 ? '99+' : '$unread',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 9,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
