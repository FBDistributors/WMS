import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'core/config/brand.dart';
import 'core/theme/app_colors.dart';
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
  bool _pickPushHandlerRegistered = false;
  /// FCM token backendga muvaffaqiyatli yuborilgach true (xato bo‘lsa qayta uriniladi).
  bool _fcmTokenSentThisSession = false;
  bool _fcmTokenRegisterInFlight = false;
  DateTime? _fcmRegisterBackoffUntil;

  void _tryRegisterFcmWithBackend(WidgetRef ref, {bool bypassBackoff = false}) {
    if (_fcmTokenSentThisSession || _fcmTokenRegisterInFlight) {
      return;
    }
    final AuthSession? session = ref.read(authControllerProvider).valueOrNull;
    if (session == null || !session.isAuthenticated) {
      return;
    }
    final DateTime now = DateTime.now();
    if (!bypassBackoff &&
        _fcmRegisterBackoffUntil != null &&
        now.isBefore(_fcmRegisterBackoffUntil!)) {
      return;
    }
    if (!bypassBackoff) {
      _fcmRegisterBackoffUntil = now.add(const Duration(seconds: 12));
    } else {
      _fcmRegisterBackoffUntil = null;
    }
    _fcmTokenRegisterInFlight = true;
    FcmService.registerTokenIfPossible(ref.read(pickingRepositoryProvider)).then((bool ok) {
      _fcmTokenRegisterInFlight = false;
      if (ok) {
        _fcmTokenSentThisSession = true;
        _fcmRegisterBackoffUntil = null;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!_fcmRouterBound) {
      _fcmRouterBound = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        FcmService.bindRouter(ref.read(goRouterProvider));
      });
    }
    if (!_pickPushHandlerRegistered) {
      _pickPushHandlerRegistered = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        FcmService.registerPickTasksPushHandler(({String? taskId}) {
          ref.read(openPickTasksProvider.notifier).refreshFromNetwork();
          ref.read(consolidatedViewProvider.notifier).refreshFromNetwork();
          if (taskId != null && taskId.isNotEmpty) {
            ref.invalidate(pickTaskDetailProvider(taskId));
          }
        });
      });
    }

    ref.watch(authControllerProvider).whenData((AuthSession session) {
      if (!session.isAuthenticated) {
        _fcmTokenSentThisSession = false;
        _fcmTokenRegisterInFlight = false;
        _fcmRegisterBackoffUntil = null;
      } else {
        _tryRegisterFcmWithBackend(ref);
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
        if (ref.read(authControllerProvider).valueOrNull?.isAuthenticated ?? false) {
          _tryRegisterFcmWithBackend(ref, bypassBackoff: true);
        }
      }
    });

    final GoRouter router = ref.watch(goRouterProvider);
    final ThemeMode themeMode = ref.watch(appThemeModeProvider);
    final AppLocale appLoc = ref.watch(appLocaleProvider);
    final AsyncValue<bool> startupReady = ref.watch(startupBootstrapProvider);

    if (startupReady.isLoading || startupReady.hasError) {
      return MaterialApp(
        title: 'WMS',
        themeMode: themeMode,
        theme: ThemeData(
          useMaterial3: true,
          extensions: const <ThemeExtension<dynamic>>[AppColors.light],
          colorScheme: ColorScheme.fromSeed(seedColor: _accent, brightness: Brightness.light),
        ),
        darkTheme: ThemeData(
          useMaterial3: true,
          brightness: Brightness.dark,
          extensions: const <ThemeExtension<dynamic>>[AppColors.dark],
        ),
        home: Scaffold(
          body: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                const CircularProgressIndicator(),
                const SizedBox(height: 12),
                Text(
                  startupReady.hasError ? 'Yuklashda xatolik. Qayta urinilmoqda...' : 'Yuklanmoqda...',
                ),
              ],
            ),
          ),
        ),
      );
    }

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
        extensions: const <ThemeExtension<dynamic>>[AppColors.light],
        colorScheme: ColorScheme.fromSeed(seedColor: _accent, brightness: Brightness.light),
        scaffoldBackgroundColor: const Color(0xFFF5F5F5),
        appBarTheme: const AppBarTheme(
          backgroundColor: Brand.pickerHeaderNavy,
          foregroundColor: Colors.white,
          surfaceTintColor: Colors.transparent,
          elevation: 2,
          shadowColor: Colors.black26,
          systemOverlayStyle: SystemUiOverlayStyle.light,
          iconTheme: IconThemeData(color: Colors.white),
          actionsIconTheme: IconThemeData(color: Colors.white),
          titleTextStyle: TextStyle(
            color: Colors.white,
            fontSize: 20,
            fontWeight: FontWeight.w600,
          ),
        ),
        listTileTheme: const ListTileThemeData(
          contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          minLeadingWidth: 28,
        ),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        extensions: const <ThemeExtension<dynamic>>[AppColors.dark],
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
          systemOverlayStyle: SystemUiOverlayStyle.light,
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
