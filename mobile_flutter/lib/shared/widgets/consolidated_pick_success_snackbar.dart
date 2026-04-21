import 'package:flutter/material.dart';

import '../../core/app_state/app_locale.dart';
import '../../l10n/string_lookup.dart';
import '../feedback/app_top_snackbar.dart';

void showConsolidatedPickSuccessSnackBar(BuildContext context, AppLocale loc) {
  final Color iconColor = Colors.green.shade700;
  showAppSnackBar(
    context,
    SnackBar(
      duration: const Duration(seconds: 4),
      content: Row(
        children: <Widget>[
          Icon(Icons.check_circle_rounded, color: iconColor, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: Text(StringLookup.t(loc, 'consolidatedPickSuccess')),
          ),
        ],
      ),
    ),
  );
}
