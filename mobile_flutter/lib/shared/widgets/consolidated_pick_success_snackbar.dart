import 'package:flutter/material.dart';

import '../../core/app_state/app_locale.dart';
import '../../l10n/string_lookup.dart';
import '../feedback/app_top_snackbar.dart';

void showConsolidatedPickSuccessSnackBar(BuildContext context, AppLocale loc) {
  showAppTopSuccess(
    context,
    StringLookup.t(loc, 'consolidatedPickSuccess'),
    duration: const Duration(seconds: 4),
  );
}
