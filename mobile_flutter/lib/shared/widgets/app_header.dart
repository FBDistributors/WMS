import 'package:flutter/material.dart';

import '../../core/config/brand.dart';

/// ERP-style app bar matching React Native `AppHeader.tsx` (logo, title, refresh).
/// [SafeArea] (top) bilan status bar ostida kontent — tizim vaqt/batareya bilan ustma-ust tushmaydi.
class AppHeader extends StatelessWidget {
  const AppHeader({
    super.key,
    required this.title,
    this.showBack = false,
    this.onBack,
    this.showLogo = false,
    this.onRefresh,
    this.refreshing = false,
    this.headerBackgroundColor,
    this.titleColor,
    this.accentColor = const Color(0xFF1A237E),
    this.leading,
    this.trailing,
  });

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
  Widget build(BuildContext context) {
    final Color bg = headerBackgroundColor ?? Colors.white;
    final Color fg = titleColor ?? const Color(0xFF333333);
    final Color border = Theme.of(context).brightness == Brightness.dark
        ? const Color(0xFF334155)
        : Colors.grey.shade300;

    return Material(
      color: bg,
      elevation: 0,
      child: SafeArea(
        bottom: false,
        left: false,
        right: false,
        top: true,
        child: Container(
          decoration: BoxDecoration(
            color: bg,
            border: Border(
              bottom: BorderSide(color: border, width: 1),
            ),
          ),
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
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
                  child: Icon(Icons.business,
                      size: Brand.headerLogoSize, color: accentColor),
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
      ),
    );
  }
}
