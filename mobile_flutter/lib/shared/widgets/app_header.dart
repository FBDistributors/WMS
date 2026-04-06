import 'package:flutter/material.dart';

import '../../core/config/brand.dart';

/// ERP-style app bar matching React Native `AppHeader.tsx` (logo, title, refresh).
class AppHeader extends StatelessWidget implements PreferredSizeWidget {
  const AppHeader({
    super.key,
    required this.title,
    this.showBack = false,
    this.onBack,
    this.showLogo = true,
    this.onRefresh,
    this.refreshing = false,
    this.headerBackgroundColor,
    this.titleColor,
    this.accentColor = const Color(0xFF1A237E),
    this.leading,
    this.trailing,
  });

  static const double _toolbarHeight = kToolbarHeight + 8;

  final String title;
  final bool showBack;
  final VoidCallback? onBack;
  final bool showLogo;
  final VoidCallback? onRefresh;
  final bool refreshing;
  final Color? headerBackgroundColor;
  final Color? titleColor;
  final Color accentColor;
  final Widget? leading;
  final Widget? trailing;

  @override
  Size get preferredSize => const Size.fromHeight(_toolbarHeight);

  @override
  Widget build(BuildContext context) {
    final Color bg = headerBackgroundColor ?? Colors.white;
    final Color fg = titleColor ?? const Color(0xFF333333);

    return Material(
      color: bg,
      elevation: 0,
      child: Container(
        decoration: BoxDecoration(
          color: bg,
          border: Border(
            bottom: BorderSide(color: Colors.grey.shade300, width: 1),
          ),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: <Widget>[
            if (leading != null) leading!,
            if (showBack && onBack != null)
              IconButton(
                onPressed: onBack,
                icon: Icon(Icons.arrow_back, color: accentColor),
                tooltip: 'Orqaga',
              ),
            if (showLogo)
              Padding(
                padding: const EdgeInsets.only(right: 12),
                child: Icon(Icons.business, size: Brand.headerLogoSize, color: accentColor),
              ),
            Expanded(
              child: Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: fg,
                ),
              ),
            ),
            if (trailing != null) trailing!,
            if (onRefresh != null)
              IconButton(
                onPressed: refreshing ? null : onRefresh,
                icon: Icon(
                  Icons.refresh,
                  color: refreshing ? Colors.grey.shade400 : accentColor,
                ),
                tooltip: 'Yangilash',
              ),
          ],
        ),
      ),
    );
  }
}
