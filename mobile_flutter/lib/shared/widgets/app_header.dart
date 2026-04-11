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
    this.accentColor,
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
  /// Null: oq (yorug‘, `pickerHeaderNavy` fon) yoki `0xFF93C5FD` (qorong‘i).
  final Color? accentColor;
  final Widget? leading;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final bool isDark = Theme.of(context).brightness == Brightness.dark;
    final Color bg = headerBackgroundColor ??
        (isDark ? const Color(0xFF1E293B) : Brand.pickerHeaderNavy);
    final Color fg = titleColor ?? (isDark ? const Color(0xFFF1F5F9) : Colors.white);
    final Color accent =
        accentColor ?? (isDark ? const Color(0xFF93C5FD) : Colors.white);
    final Color border = isDark
        ? const Color(0xFF334155)
        : (bg == Brand.pickerHeaderNavy
            ? Colors.white.withValues(alpha: 0.18)
            : Colors.grey.shade300);

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
          child: IconTheme(
            data: IconThemeData(color: accent),
            child: Row(
              children: <Widget>[
                if (leading != null) leading!,
                if (showBack && onBack != null)
                  IconButton(
                    onPressed: onBack,
                    icon: const Icon(Icons.arrow_back),
                    tooltip: 'Orqaga',
                  ),
                if (showLogo)
                  Padding(
                    padding: const EdgeInsets.only(right: 12),
                    child: Icon(Icons.business, size: Brand.headerLogoSize),
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
                      color: refreshing ? Colors.grey.shade400 : accent,
                    ),
                    tooltip: 'Yangilash',
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
