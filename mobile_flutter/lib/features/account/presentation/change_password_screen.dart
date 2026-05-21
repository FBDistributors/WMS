import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../l10n/string_lookup.dart';
import '../../auth/presentation/auth_providers.dart';

class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  ConsumerState<ChangePasswordScreen> createState() =>
      _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final TextEditingController _current = TextEditingController();
  final TextEditingController _new = TextEditingController();
  final TextEditingController _confirm = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _new.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final String current = _current.text;
    final String newPass = _new.text;
    final String confirm = _confirm.text;

    setState(() => _error = null);

    if (current.isEmpty) {
      setState(() => _error = StringLookup.t(loc, 'errorInvalidCurrentPassword'));
      return;
    }
    if (newPass.length < 6) {
      setState(() => _error = StringLookup.t(loc, 'errorPasswordShort'));
      return;
    }
    if (newPass != confirm) {
      setState(() => _error = StringLookup.t(loc, 'errorPasswordMismatch'));
      return;
    }

    setState(() => _submitting = true);
    try {
      await ref.read(authControllerProvider.notifier).changePassword(
            currentPassword: current,
            newPassword: newPass,
          );
      if (!mounted) {
        return;
      }
      _current.clear();
      _new.clear();
      _confirm.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(StringLookup.t(loc, 'passwordUpdated'))),
      );
      Navigator.of(context).pop();
    } on Exception catch (e) {
      if (!mounted) {
        return;
      }
      final String msg = e.toString().replaceFirst('Exception: ', '');
      if (msg.toLowerCase().contains('invalid current password')) {
        setState(
          () => _error = StringLookup.t(loc, 'errorInvalidCurrentPassword'),
        );
      } else {
        setState(() => _error = msg);
      }
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(StringLookup.t(loc, 'changePassword')),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          TextField(
            controller: _current,
            obscureText: true,
            autocorrect: false,
            decoration: InputDecoration(
              labelText: StringLookup.t(loc, 'currentPassword'),
              border: const OutlineInputBorder(),
            ),
            enabled: !_submitting,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _new,
            obscureText: true,
            autocorrect: false,
            decoration: InputDecoration(
              labelText: StringLookup.t(loc, 'newPassword'),
              border: const OutlineInputBorder(),
            ),
            enabled: !_submitting,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _confirm,
            obscureText: true,
            autocorrect: false,
            decoration: InputDecoration(
              labelText: StringLookup.t(loc, 'confirmPassword'),
              border: const OutlineInputBorder(),
            ),
            enabled: !_submitting,
            onSubmitted: (_) => _submit(),
          ),
          if (_error != null) ...<Widget>[
            const SizedBox(height: 12),
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _submitting ? null : _submit,
            child: _submitting
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(StringLookup.t(loc, 'save')),
          ),
        ],
      ),
    );
  }
}
