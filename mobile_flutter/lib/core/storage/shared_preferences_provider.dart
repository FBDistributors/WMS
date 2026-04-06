import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Injected from [main] via [ProviderScope.overrides].
final sharedPreferencesProvider = Provider<SharedPreferences>((Ref ref) {
  throw StateError(
    'sharedPreferencesProvider must be overridden in ProviderScope (see main.dart).',
  );
});
