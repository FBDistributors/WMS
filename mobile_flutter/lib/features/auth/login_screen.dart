import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_state/app_locale.dart';
import '../../core/app_state/locale_controller.dart';
import '../../core/app_state/prefs_keys.dart';
import '../../core/storage/shared_preferences_provider.dart';
import '../../l10n/string_lookup.dart';
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
  bool _dropdownOpen = false;
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

  Future<void> _submit() async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final String u = _user.text.trim();
    final String p = _pass.text.trim();
    if (u.isEmpty || p.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(StringLookup.t(loc, 'enterLoginPassword'))),
      );
      return;
    }
    final bool ok =
        await ref.read(authControllerProvider.notifier).login(u, p);
    if (!mounted) {
      return;
    }
    if (ok) {
      await ref.read(sharedPreferencesProvider).setString(PrefsKeys.lastUsername, u);
      if (!mounted) {
        return;
      }
      context.goNamed('pickerHome');
      return;
    }
    final Object? err = ref.read(authControllerProvider).error;
    if (!mounted) {
      return;
    }
    if (err != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(err.toString())),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(StringLookup.t(loc, 'loginError'))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final AsyncValue<AuthSession> auth = ref.watch(authControllerProvider);
    final ThemeData theme = Theme.of(context);
    final bool isDark = theme.brightness == Brightness.dark;

    return auth.when(
      loading: () => Scaffold(
        backgroundColor: isDark ? const Color(0xFF0F172A) : const Color(0xFFF5F5F5),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              const CircularProgressIndicator(),
              const SizedBox(height: 12),
              Text(StringLookup.t(loc, 'loading')),
            ],
          ),
        ),
      ),
      error: (_, __) => _form(context, loc, isDark, false),
      data: (AuthSession s) {
        if (s.isAuthenticated) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (context.mounted) {
              context.goNamed('pickerHome');
            }
          });
        }
        return _form(context, loc, isDark, false);
      },
    );
  }

  Widget _form(BuildContext context, AppLocale loc, bool isDark, bool _) {
    final bool busy = ref.watch(authControllerProvider).isLoading;
    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : const Color(0xFFF5F5F5),
      body: Stack(
        children: <Widget>[
          if (_dropdownOpen)
            Positioned.fill(
              child: GestureDetector(
                onTap: () => setState(() => _dropdownOpen = false),
                child: Container(color: Colors.black26),
              ),
            ),
          Positioned(
            top: 48,
            right: 16,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                Material(
                  color: isDark ? const Color(0xFF1E293B) : Colors.white,
                  borderRadius: BorderRadius.circular(8),
                  child: InkWell(
                    onTap: () => setState(() => _dropdownOpen = !_dropdownOpen),
                    borderRadius: BorderRadius.circular(8),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Text(_langLabel(loc)),
                          Icon(_dropdownOpen ? Icons.expand_less : Icons.expand_more),
                        ],
                      ),
                    ),
                  ),
                ),
                if (_dropdownOpen)
                  Material(
                    elevation: 4,
                    borderRadius: BorderRadius.circular(8),
                    color: isDark ? const Color(0xFF1E293B) : Colors.white,
                    child: Column(
                      children: <Widget>[
                        _langTile(AppLocale.uz, loc),
                        _langTile(AppLocale.ru, loc),
                        _langTile(AppLocale.en, loc),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 320),
                child: Column(
                  children: <Widget>[
                    const SizedBox(height: 40),
                    Icon(Icons.business, size: 96, color: isDark ? Colors.white70 : Colors.blue.shade800),
                    const SizedBox(height: 12),
                    Text(
                      StringLookup.t(loc, 'brand'),
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
                      ),
                      textInputAction: TextInputAction.next,
                      autocorrect: false,
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
                    TextButton(
                      onPressed: () => context.goNamed('home'),
                      child: const Text('Home (scan hub)'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _langLabel(AppLocale l) {
    return switch (l) {
      AppLocale.uz => StringLookup.t(l, 'langUz'),
      AppLocale.ru => StringLookup.t(l, 'langRu'),
      AppLocale.en => StringLookup.t(l, 'langEn'),
    };
  }

  Widget _langTile(AppLocale code, AppLocale current) {
    return ListTile(
      title: Text(_langLabel(code)),
      trailing: current == code ? const Icon(Icons.check, color: Colors.blue) : null,
      onTap: () {
        ref.read(appLocaleProvider.notifier).setLocale(code);
        setState(() => _dropdownOpen = false);
      },
    );
  }
}
