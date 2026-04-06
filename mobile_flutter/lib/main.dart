import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'core/app_state/locale_controller.dart';
import 'core/app_state/network_status_provider.dart';
import 'core/app_state/theme_controller.dart';
import 'core/app_state/app_locale.dart';
import 'core/offline/offline_providers.dart';
import 'core/offline/offline_sync_service.dart';
import 'core/push/fcm_service.dart';
import 'core/router.dart';
import 'core/storage/shared_preferences_provider.dart';
import 'features/auth/presentation/auth_providers.dart';
import 'features/picking/picking_providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await FcmService.ensureInitialized();
  final SharedPreferences prefs = await SharedPreferences.getInstance();
  runApp(
    ProviderScope(
      overrides: <Override>[
        sharedPreferencesProvider.overrideWithValue(prefs),
      ],
      child: const MobileFlutterApp(),
    ),
  );
}

class MobileFlutterApp extends ConsumerStatefulWidget {
  const MobileFlutterApp({super.key});

  @override
  ConsumerState<MobileFlutterApp> createState() => _MobileFlutterAppState();
}

class _MobileFlutterAppState extends ConsumerState<MobileFlutterApp> {
  static const Color _accent = Color(0xFF1A237E);
  bool _fcmRouterBound = false;

  @override
  Widget build(BuildContext context) {
    if (!_fcmRouterBound) {
      _fcmRouterBound = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        FcmService.bindRouter(ref.read(goRouterProvider));
      });
    }

    ref.listen<AsyncValue<AuthSession>>(authControllerProvider, (
      AsyncValue<AuthSession>? prev,
      AsyncValue<AuthSession> next,
    ) {
      final bool wasAuthed = prev?.valueOrNull?.isAuthenticated ?? false;
      final bool nowAuthed = next.valueOrNull?.isAuthenticated ?? false;
      if (!wasAuthed && nowAuthed) {
        FcmService.registerTokenIfPossible(ref.read(pickingRepositoryProvider));
      }
    });

    ref.listen<AsyncValue<bool>>(networkOnlineProvider, (AsyncValue<bool>? prev, AsyncValue<bool> next) {
      final bool? was = prev?.valueOrNull;
      final bool? now = next.valueOrNull;
      if (was == false && now == true) {
        final OfflineSyncService? sync = ref.read(offlineSyncServiceProvider);
        sync?.syncPendingQueue().then((SyncResult r) {
          if (r.ok) {
            ref.invalidate(pendingQueueCountProvider);
          }
        });
      }
    });

    final GoRouter router = ref.watch(goRouterProvider);
    final ThemeMode themeMode = ref.watch(appThemeModeProvider);
    final AppLocale appLoc = ref.watch(appLocaleProvider);

    return MaterialApp.router(
      title: 'WMS',
      themeMode: themeMode,
      locale: Locale(appLoc.code),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const <Locale>[
        Locale('uz'),
        Locale('ru'),
        Locale('en'),
      ],
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: _accent, brightness: Brightness.light),
        scaffoldBackgroundColor: const Color(0xFFF5F5F5),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          foregroundColor: Color(0xFF333333),
          elevation: 0,
        ),
        listTileTheme: const ListTileThemeData(
          contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          minLeadingWidth: 28,
        ),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0F172A),
        colorScheme: ColorScheme.dark(
          primary: const Color(0xFF93C5FD),
          surface: const Color(0xFF1E293B),
          onSurface: const Color(0xFFF1F5F9),
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF1E293B),
          foregroundColor: Color(0xFFF1F5F9),
          elevation: 0,
        ),
        listTileTheme: const ListTileThemeData(
          contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          minLeadingWidth: 28,
        ),
      ),
      routerConfig: router,
    );
  }
}
