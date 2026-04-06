import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/config/brand.dart';

/// RN `HomeScreen` — Picker yoki Skaner.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final bool isDark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : const Color(0xFFF5F5F5),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Icon(Icons.business, size: Brand.loginLogoSize, color: isDark ? Colors.white70 : Colors.blue.shade800),
              Text(Brand.name, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: isDark ? Colors.white : Colors.black87)),
              const SizedBox(height: 8),
              Text('Skaner yoki terish (Picker)', style: TextStyle(color: isDark ? Colors.white70 : Colors.black54)),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => context.goNamed('pickerHome'),
                  child: const Text('Picker / Yig‘uvchi'),
                ),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: () => context.pushNamed('scanner'),
                child: const Text('Skaner (barcode)'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
