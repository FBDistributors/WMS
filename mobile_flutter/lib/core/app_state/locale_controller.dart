import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../storage/shared_preferences_provider.dart';
import 'app_locale.dart';
import 'prefs_keys.dart';

final appLocaleProvider = NotifierProvider<LocaleController, AppLocale>(
  LocaleController.new,
);

class LocaleController extends Notifier<AppLocale> {
  @override
  AppLocale build() {
    final String? stored =
        ref.read(sharedPreferencesProvider).getString(PrefsKeys.locale);
    return AppLocale.fromCode(stored);
  }

  Future<void> setLocale(AppLocale locale) async {
    state = locale;
    await ref.read(sharedPreferencesProvider).setString(
          PrefsKeys.locale,
          locale.code,
        );
  }
}
