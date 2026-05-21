import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_state/app_locale.dart';
import '../../core/app_state/locale_controller.dart';
import '../../core/config/brand.dart';
import '../../core/network/app_dio.dart';
import '../../core/app_state/prefs_keys.dart';
import '../../core/storage/shared_preferences_provider.dart';
import '../../l10n/string_lookup.dart';
import '../../shared/feedback/app_top_snackbar.dart' show AppToastType, showAppSnackBar;
import '../../shared/input/input_clear_button.dart';
import 'presentation/auth_providers.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final TextEditingController _user = TextEditingController();
  final TextEditingController _pass = TextEditingController();
  bool _showPassword = false;
  bool _submitting = false;
  String? _submitError;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadLastUser());
  }

  Future<void> _loadLastUser() async {
    final String? u =
        ref.read(sharedPreferencesProvider).getString(PrefsKeys.lastUsername);
    if (u != null && mounted) {
      setState(() {
        _user.text = u;
      });
    }
  }

  @override
  void dispose() {
    _user.dispose();
    _pass.dispose();
    super.dispose();
  }

  SystemUiOverlayStyle _loginStatusBarStyle(bool isDark) {
    if (isDark) {
      return SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent);
    }
    return SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent);
  }

  Future<void> _submit() async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final String u = _user.text.trim();
    final String p = _pass.text.trim();
    if (u.isEmpty || p.isEmpty) {
      setState(() => _submitError = null);
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'enterLoginPassword'))),
      );
      return;
    }
    setState(() {
      _submitting = true;
      _submitError = null;
    });
    final bool ok = await ref.read(authControllerProvider.notifier).login(u, p);
    if (!mounted) {
      return;
    }
    if (ok) {
      await ref.read(sharedPreferencesProvider).setString(PrefsKeys.lastUsername, u);
      if (!mounted) {
        return;
      }
      context.goNamed('pickerHome');
      if (mounted) {
        setState(() {
          _submitting = false;
          _submitError = null;
        });
      }
      return;
    }
    final String? err = ref.read(authControllerProvider.notifier).lastLoginError;
    if (!mounted) {
      return;
    }
    final String msg;
    if (err != null) {
      final String raw = err.replaceFirst(RegExp(r'^Exception:\s*'), '');
      final String lower = raw.toLowerCase();
      final bool badCreds = raw.contains(unauthorizedMessage) ||
          lower.contains('invalid credentials');
      msg = badCreds ? StringLookup.t(loc, 'invalidCredentialsError') : raw;
    } else {
      msg = StringLookup.t(loc, 'loginError');
    }
    if (mounted) {
      setState(() {
        _submitError = msg;
        _submitting = false;
      });
    }
    if (!mounted) {
      return;
    }
    showAppSnackBar(
      context,
      SnackBar(content: Text(msg)),
      type: AppToastType.error,
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final AsyncValue<AuthSession> auth = ref.watch(authControllerProvider);
    final ThemeData theme = Theme.of(context);
    final bool isDark = theme.brightness == Brightness.dark;

    return auth.when(
      loading: () => _form(context, loc, isDark),
      error: (_, __) => _form(context, loc, isDark),
      data: (AuthSession s) {
        if (s.isAuthenticated) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (context.mounted) {
              context.goNamed('pickerHome');
            }
          });
        }
        return _form(context, loc, isDark);
      },
    );
  }

  Widget _form(BuildContext context, AppLocale loc, bool isDark) {
    final bool busy = _submitting;
    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : const Color(0xFFF5F5F5),
      appBar: AppBar(
        automaticallyImplyLeading: false,
        elevation: 0,
        backgroundColor: isDark ? const Color(0xFF0F172A) : const Color(0xFFF5F5F5),
        systemOverlayStyle: _loginStatusBarStyle(isDark),
        actions: _languageMenuActions(loc, isDark),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 320),
            child: Column(
              children: <Widget>[
                    const SizedBox(height: 8),
                    Image.asset(
                      'assets/branding/logo.png',
                      width: Brand.loginLogoSize,
                      height: Brand.loginLogoSize,
                      fit: BoxFit.contain,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      Brand.name,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w600,
                        color: isDark ? Colors.white : Colors.black87,
                      ),
                    ),
                    Text(
                      StringLookup.t(loc, 'loginSubtitle'),
                      style: TextStyle(color: isDark ? Colors.white70 : Colors.black54),
                    ),
                    const SizedBox(height: 24),
                    TextField(
                      controller: _user,
                      decoration: InputDecoration(
                        labelText: StringLookup.t(loc, 'loginPlaceholder'),
                        border: const OutlineInputBorder(),
                        suffixIcon: buildInputClearButton(
                          visible: _user.text.trim().isNotEmpty,
                          onPressed: () => setState(() {
                            _user.clear();
                            _submitError = null;
                          }),
                        ),
                      ),
                      textInputAction: TextInputAction.next,
                      autocorrect: false,
                      onChanged: (_) => setState(() => _submitError = null),
                      enabled: !busy,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _pass,
                      decoration: InputDecoration(
                        labelText: StringLookup.t(loc, 'passwordPlaceholder'),
                        border: const OutlineInputBorder(),
                        suffixIcon: IconButton(
                          icon: Icon(_showPassword ? Icons.visibility_off : Icons.visibility),
                          onPressed: () => setState(() => _showPassword = !_showPassword),
                        ),
                      ),
                      obscureText: !_showPassword,
                      onChanged: (_) => setState(() => _submitError = null),
                      onSubmitted: (_) => _submit(),
                      enabled: !busy,
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: busy ? null : _submit,
                        child: busy
                            ? const SizedBox(
                                height: 22,
                                width: 22,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : Text(StringLookup.t(loc, 'loginButton')),
                      ),
                    ),
                    if (_submitError != null) ...<Widget>[
                      const SizedBox(height: 12),
                      Text(
                        _submitError!,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: isDark ? const Color(0xFFFCA5A5) : const Color(0xFFB91C1C),
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
      ),
    );
  }

  List<Widget> _languageMenuActions(AppLocale current, bool isDark) {
    return <Widget>[
      PopupMenuButton<AppLocale>(
        tooltip: StringLookup.t(current, 'language'),
        icon: Icon(Icons.language_rounded, color: isDark ? const Color(0xFF93C5FD) : const Color(0xFF1A237E)),
        onSelected: (AppLocale v) {
          unawaited(ref.read(appLocaleProvider.notifier).setLocale(v));
        },
        itemBuilder: (BuildContext ctx) => <PopupMenuEntry<AppLocale>>[
          CheckedPopupMenuItem<AppLocale>(
            value: AppLocale.uz,
            checked: current == AppLocale.uz,
            child: Text(StringLookup.t(AppLocale.uz, 'langUz')),
          ),
          CheckedPopupMenuItem<AppLocale>(
            value: AppLocale.ru,
            checked: current == AppLocale.ru,
            child: Text(StringLookup.t(AppLocale.ru, 'langRu')),
          ),
          CheckedPopupMenuItem<AppLocale>(
            value: AppLocale.en,
            checked: current == AppLocale.en,
            child: Text(StringLookup.t(AppLocale.en, 'langEn')),
          ),
        ],
      ),
    ];
  }

}
