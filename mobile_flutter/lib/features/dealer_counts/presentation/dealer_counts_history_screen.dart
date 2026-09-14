import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/errors/api_error_localization.dart';
import '../../../l10n/string_lookup.dart';
import '../../customer_returns/data/customer_return_display_datetime.dart';
import '../../picking/data/picking_models.dart' show formatPickQty;
import '../data/dealer_counts_models.dart';
import '../dealer_counts_providers.dart';

/// "Sanaldi: 5/3808 · Jami dona: 5" — haqiqatan sanalgan qatorlar; "0 deb hisobla"
/// bilan to'ldirilganlar sanalgan hisoblanmaydi.
String dealerCountSummary(AppLocale loc, DealerCount c) =>
    '${StringLookup.tParams(loc, 'dealerCountCounted', <String, String>{'done': '${c.countedLines}', 'total': '${c.sheetLines}'})} · '
    '${StringLookup.t(loc, 'dealerCountTotalUnits')}: ${formatPickQty(c.totalUnits)}';

/// Tarix: men sanab yuborgan diller sanovlari.
class DealerCountsHistoryScreen extends ConsumerWidget {
  const DealerCountsHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final AsyncValue<List<DealerCount>> sent = ref.watch(myDealerCountsProvider);
    final ColorScheme cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(StringLookup.t(loc, 'dealerCountsHistory')),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop()),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(myDealerCountsProvider),
        child: sent.when(
          data: (List<DealerCount> list) => ListView(
            padding: const EdgeInsets.all(12),
            children: list.isEmpty
                ? <Widget>[
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(StringLookup.t(loc, 'dealerCountsEmpty'), style: TextStyle(color: cs.onSurfaceVariant)),
                    ),
                  ]
                : list
                    .map(
                      (DealerCount c) => Card(
                        child: ListTile(
                          leading: const Icon(Icons.check_circle_outline, color: Colors.green),
                          title: Text(c.dealerName ?? c.dealerOrgId),
                          subtitle: Text(
                            '${formatCustomerReturnApiDateTime(c.submittedAt ?? c.startedAt)}\n${dealerCountSummary(loc, c)}',
                          ),
                          isThreeLine: true,
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => context.pushNamed(
                            'dealerCountView',
                            pathParameters: <String, String>{'countId': c.id},
                          ),
                        ),
                      ),
                    )
                    .toList(growable: false),
          ),
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (Object e, _) => ListView(
            padding: const EdgeInsets.all(24),
            children: <Widget>[Text(localizeApiErrorMessage(loc, e), textAlign: TextAlign.center)],
          ),
        ),
      ),
    );
  }
}
