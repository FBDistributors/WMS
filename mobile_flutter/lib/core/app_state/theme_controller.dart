import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../storage/shared_preferences_provider.dart';
import 'prefs_keys.dart';

/// RN `ThemeContext`: light / dark saqlanadi; Flutter `ThemeMode` ga map qilinadi.
final appThemeModeProvider = NotifierProvider<ThemeModeController, ThemeMode>(
  ThemeModeController.new,
);

class ThemeModeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    final String? stored =
        ref.read(sharedPreferencesProvider).getString(PrefsKeys.theme);
    return switch (stored) {
      'dark' => ThemeMode.dark,
      'light' => ThemeMode.light,
      _ => ThemeMode.light,
    };
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = mode;
    final String v = switch (mode) {
      ThemeMode.dark => 'dark',
      ThemeMode.light => 'light',
      ThemeMode.system => 'light',
    };
    await ref.read(sharedPreferencesProvider).setString(PrefsKeys.theme, v);
  }

  bool get isDark => state == ThemeMode.dark;
}
