import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/storage/shared_preferences_provider.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../../shared/layout/sheet_bottom_inset.dart';
import '../../auth/data/auth_models.dart';
import '../../auth/presentation/auth_providers.dart';
import '../data/app_feedback_prompt_storage.dart';
import '../data/feedback_repository.dart';
import '../feedback_providers.dart';

enum AppFeedbackDismissAction { submitted, later, never, cancelled }

class AppFeedbackSheet extends ConsumerStatefulWidget {
  const AppFeedbackSheet({
    super.key,
    required this.module,
    this.contextRef,
  });

  final String module;
  final String? contextRef;

  @override
  ConsumerState<AppFeedbackSheet> createState() => _AppFeedbackSheetState();
}

class _AppFeedbackSheetState extends ConsumerState<AppFeedbackSheet> {
  int _rating = 0;
  final TextEditingController _comment = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  String _resolveRole(MeResponse? me) {
    final String role = (me?.role ?? 'picker').trim().toLowerCase();
    if (role == 'inventory_controller') {
      return 'controller';
    }
    return role;
  }

  Future<void> _submit() async {
    if (_rating < 1) {
      return;
    }
    setState(() => _busy = true);
    final AppLocale loc = ref.read(appLocaleProvider);
    try {
      final MeResponse? me = ref.read(authControllerProvider).maybeWhen(
            data: (AuthSession s) => s.me,
            orElse: () => null,
          );
      await ref.read(feedbackRepositoryProvider).submitFeedback(
            FeedbackSubmitPayload(
              rating: _rating,
              role: _resolveRole(me),
              module: widget.module,
              comment: _comment.text.trim(),
              contextRef: widget.contextRef,
              appVersion: kAppFeedbackVersion,
              platform: detectFeedbackPlatform(),
            ),
          );
      await AppFeedbackPromptStorage.recordSubmitted(ref.read(sharedPreferencesProvider));
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(AppFeedbackDismissAction.submitted);
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'appFeedbackThanks'))),
      );
    } on FeedbackRateLimitException {
      await AppFeedbackPromptStorage.recordSubmitted(ref.read(sharedPreferencesProvider));
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(AppFeedbackDismissAction.cancelled);
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'appFeedbackOncePerDay'))),
      );
    } on Exception catch (e) {
      if (mounted) {
        showAppLocalizedError(context, loc, e);
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _dismiss(AppFeedbackDismissAction action) async {
    final prefs = ref.read(sharedPreferencesProvider);
    if (action == AppFeedbackDismissAction.later) {
      await AppFeedbackPromptStorage.recordLater(prefs);
    } else if (action == AppFeedbackDismissAction.never) {
      await AppFeedbackPromptStorage.recordNever(prefs);
    }
    if (mounted) {
      Navigator.of(context).pop(action);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final ColorScheme cs = Theme.of(context).colorScheme;

    return Padding(
      padding: EdgeInsets.only(bottom: sheetBottomPadding(context)),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Text(
                    StringLookup.t(loc, 'appFeedbackTitle'),
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close_rounded),
                  onPressed: _busy ? null : () => _dismiss(AppFeedbackDismissAction.cancelled),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              StringLookup.t(loc, 'appFeedbackTrust'),
              style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant, height: 1.35),
            ),
            const SizedBox(height: 16),
            Text(
              StringLookup.t(loc, 'appFeedbackStarsLabel'),
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List<Widget>.generate(5, (int i) {
                final int star = i + 1;
                final bool filled = star <= _rating;
                return IconButton(
                  tooltip: '$star',
                  onPressed: _busy ? null : () => setState(() => _rating = star),
                  icon: Icon(
                    filled ? Icons.star_rounded : Icons.star_outline_rounded,
                    color: filled ? Colors.amber.shade700 : cs.outline,
                    size: 36,
                  ),
                );
              }),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _comment,
              maxLength: 500,
              maxLines: 3,
              enabled: !_busy,
              decoration: InputDecoration(
                labelText: StringLookup.t(loc, 'appFeedbackCommentHint'),
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _busy || _rating < 1 ? null : _submit,
              child: Text(StringLookup.t(loc, 'appFeedbackSubmit')),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: _busy ? null : () => _dismiss(AppFeedbackDismissAction.later),
              child: Text(StringLookup.t(loc, 'appFeedbackLater')),
            ),
            TextButton(
              onPressed: _busy ? null : () => _dismiss(AppFeedbackDismissAction.never),
              child: Text(StringLookup.t(loc, 'appFeedbackNever')),
            ),
          ],
        ),
      ),
    );
  }
}

Future<AppFeedbackDismissAction?> showAppFeedbackSheet({
  required BuildContext context,
  required WidgetRef ref,
  required String module,
  String? contextRef,
}) async {
  final prefs = ref.read(sharedPreferencesProvider);
  final AppLocale loc = ref.read(appLocaleProvider);
  if (AppFeedbackPromptStorage.wasSubmittedToday(prefs, DateTime.now())) {
    showAppSnackBar(
      context,
      SnackBar(content: Text(StringLookup.t(loc, 'appFeedbackOncePerDay'))),
    );
    return null;
  }
  return showModalBottomSheet<AppFeedbackDismissAction>(
    context: context,
    isScrollControlled: true,
    builder: (BuildContext ctx) => AppFeedbackSheet(
      module: module,
      contextRef: contextRef,
    ),
  );
}

Future<void> maybeShowAutomaticAppFeedback({
  required BuildContext context,
  required WidgetRef ref,
  required String module,
  String? contextRef,
}) async {
  final prefs = ref.read(sharedPreferencesProvider);
  final DateTime now = DateTime.now();
  if (AppFeedbackPromptStorage.wasSubmittedToday(prefs, now)) {
    return;
  }
  if (!AppFeedbackPromptStorage.shouldShowAutomaticPrompt(prefs, now)) {
    return;
  }
  await showAppFeedbackSheet(
    context: context,
    ref: ref,
    module: module,
    contextRef: contextRef,
  );
}
