import 'package:flutter/material.dart';

/// RN `ProductCard` — ixcham ko‘rinish.
class ProductCard extends StatelessWidget {
  const ProductCard({
    super.key,
    required this.title,
    this.subtitle,
    this.barcode,
  });

  final String title;
  final String? subtitle;
  final String? barcode;

  @override
  Widget build(BuildContext context) {
    final bool isDark = Theme.of(context).brightness == Brightness.dark;
    return Card(
      color: isDark ? const Color(0xFF1E293B) : Colors.white,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              title,
              style: TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 16,
                color: isDark ? const Color(0xFFF1F5F9) : const Color(0xFF111827),
              ),
            ),
            if (subtitle != null)
              Text(
                subtitle!,
                style: TextStyle(
                  color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF6B7280),
                ),
              ),
            if (barcode != null)
              Text(
                'EAN: $barcode',
                style: TextStyle(
                  fontSize: 12,
                  color: isDark ? const Color(0xFF64748B) : const Color(0xFF9CA3AF),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
