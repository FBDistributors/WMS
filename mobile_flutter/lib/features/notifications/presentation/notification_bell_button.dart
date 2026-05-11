import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../notifications_providers.dart';

class NotificationBellButton extends ConsumerWidget {
  const NotificationBellButton({
    super.key,
    this.iconColor,
    /// AppHeader sarlavha rangi bilan bir xil — raqamli badge aniq ko‘rinsin.
    this.badgeLabelColor,
  });

  final Color? iconColor;
  final Color? badgeLabelColor;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final int unread = ref.watch(notificationsUnreadCountProvider);
    final Color? bl = badgeLabelColor;
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
              decoration: BoxDecoration(
                color: bl != null ? bl.withValues(alpha: 0.22) : const Color(0xFFE53935),
                borderRadius: const BorderRadius.all(Radius.circular(8)),
                border: bl != null ? Border.all(color: bl, width: 1) : null,
              ),
              child: Center(
                child: Text(
                  unread > 99 ? '99+' : '$unread',
                  style: TextStyle(
                    color: bl ?? Colors.white,
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
