import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/app_state/theme_controller.dart';
import '../../../l10n/string_lookup.dart';
import '../../feedback/presentation/app_feedback_sheet.dart';
import '../../auth/data/auth_models.dart';
import '../../auth/presentation/auth_providers.dart';

class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final ThemeMode tm = ref.watch(appThemeModeProvider);
    final AsyncValue<AuthSession> auth = ref.watch(authControllerProvider);
    final MeResponse? me = auth.maybeWhen(
      data: (AuthSession s) => s.me,
      orElse: () => null,
    );

    return Scaffold(
      appBar: AppBar(title: Text(StringLookup.t(loc, 'account'))),
      body: ListView(
        children: <Widget>[
          if (me != null)
            ListTile(
              leading: const Icon(Icons.person_outline),
              title: Text(me.username),
              subtitle: Text(me.fullName ?? ''),
            ),
          ListTile(
            leading: const Icon(Icons.language_rounded),
            title: Text(StringLookup.t(loc, 'language')),
            subtitle: Text(_langLabel(loc)),
            onTap: () => _pickLang(context, ref),
          ),
          ListTile(
            leading: const Icon(Icons.lock_outline),
            title: Text(StringLookup.t(loc, 'changePassword')),
            onTap: () => context.pushNamed('changePassword'),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.dark_mode_outlined),
            title: Text(StringLookup.t(loc, 'theme_label')),
            subtitle: Text(tm == ThemeMode.dark ? StringLookup.t(loc, 'theme_dark') : StringLookup.t(loc, 'theme_light')),
            value: tm == ThemeMode.dark,
            onChanged: (bool v) {
              ref.read(appThemeModeProvider.notifier).setThemeMode(v ? ThemeMode.dark : ThemeMode.light);
            },
          ),
          ListTile(
            leading: const Icon(Icons.notifications_none_rounded),
            title: Text(StringLookup.t(loc, 'notifications')),
            onTap: () => context.pushNamed('notifications'),
          ),
          ListTile(
            leading: const Icon(Icons.star_outline_rounded),
            title: Text(StringLookup.t(loc, 'appFeedbackMenu')),
            onTap: () {
              showAppFeedbackSheet(
                context: context,
                module: 'general',
                forceShow: true,
              );
            },
          ),
          ListTile(
            leading: const Icon(Icons.logout_rounded),
            title: Text(StringLookup.t(loc, 'logout')),
            onTap: () async {
              final bool? confirm = await showDialog<bool>(
                context: context,
                builder: (BuildContext ctx) => AlertDialog(
                  title: Text(StringLookup.t(loc, 'logoutConfirmTitle')),
                  content: Text(StringLookup.t(loc, 'logoutConfirmMessage')),
                  actions: <Widget>[
                    TextButton(
                      onPressed: () => Navigator.of(ctx).pop(false),
                      child: Text(StringLookup.t(loc, 'logoutConfirmNo')),
                    ),
                    FilledButton(
                      onPressed: () => Navigator.of(ctx).pop(true),
                      child: Text(StringLookup.t(loc, 'logoutConfirmYes')),
                    ),
                  ],
                ),
              );
              if (confirm != true || !context.mounted) {
                return;
              }
              await ref.read(authControllerProvider.notifier).logout();
              if (context.mounted) {
                context.goNamed('login');
              }
            },
          ),
        ],
      ),
    );
  }

  String _langLabel(AppLocale l) => switch (l) {
        AppLocale.uz => StringLookup.t(l, 'langUz'),
        AppLocale.ru => StringLookup.t(l, 'langRu'),
        AppLocale.en => StringLookup.t(l, 'langEn'),
      };

  Future<void> _pickLang(BuildContext context, WidgetRef ref) async {
    final AppLocale? picked = await showDialog<AppLocale>(
      context: context,
      builder: (BuildContext ctx) => SimpleDialog(
        children: <Widget>[
          SimpleDialogOption(
            onPressed: () => Navigator.pop(ctx, AppLocale.uz),
            child: const Text('O‘zbek'),
          ),
          SimpleDialogOption(
            onPressed: () => Navigator.pop(ctx, AppLocale.ru),
            child: const Text('Русский'),
          ),
          SimpleDialogOption(
            onPressed: () => Navigator.pop(ctx, AppLocale.en),
            child: const Text('English'),
          ),
        ],
      ),
    );
    if (picked != null) {
      await ref.read(appLocaleProvider.notifier).setLocale(picked);
    }
  }
}
