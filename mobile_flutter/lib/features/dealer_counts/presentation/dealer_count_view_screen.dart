import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/errors/api_error_localization.dart';
import '../../../core/formatting/expiry_display_format.dart';
import '../../../l10n/string_lookup.dart';
import '../../customer_returns/data/customer_return_display_datetime.dart';
import '../../picking/data/picking_models.dart' show formatPickQty;
import '../data/dealer_counts_models.dart';
import '../dealer_counts_providers.dart';
import 'dealer_counts_history_screen.dart' show dealerCountSummary;

/// Serverga yuborilgan sanov — faqat o'qish.
class DealerCountViewScreen extends ConsumerWidget {
  const DealerCountViewScreen({super.key, required this.countId});

  final String countId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final AsyncValue<DealerCount> async = ref.watch(dealerCountDetailProvider(countId));
    final ColorScheme cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(async.valueOrNull?.dealerName ?? StringLookup.t(loc, 'dealerCountsTitle')),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop()),
      ),
      body: async.when(
        data: (DealerCount c) => ListView(
          padding: const EdgeInsets.all(12),
          children: <Widget>[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  // Ro'yxatni web'da biri yaratadi, telefonda boshqasi sanaydi.
                  '${StringLookup.t(loc, 'dealerCountBy')}: ${c.assignedToName ?? c.countedByName ?? '—'}\n'
                  '${StringLookup.t(loc, 'dealerCountStartedAt')}: ${formatCustomerReturnApiDateTime(c.startedAt)}\n'
                  '${StringLookup.t(loc, 'dealerCountsSent')}: ${c.submittedAt != null ? formatCustomerReturnApiDateTime(c.submittedAt!) : '—'}\n'
                  '${dealerCountSummary(loc, c)}'
                  '${c.note != null && c.note!.trim().isNotEmpty ? '\n${c.note}' : ''}',
                  style: TextStyle(color: cs.onSurfaceVariant),
                ),
              ),
            ),
            ...c.lines.map(
              (DealerCountLine l) => Card(
                child: ListTile(
                  dense: true,
                  leading: l.productId == null
                      ? const Icon(Icons.help_outline, color: Colors.orange)
                      : Icon(Icons.inventory_2_outlined, color: cs.primary),
                  title: Text(l.productName ?? StringLookup.t(loc, 'dealerCountUnknownBarcode')),
                  subtitle: Text(
                    '${l.sku ?? l.scannedBarcode}'
                    '${l.expiryDate != null ? ' · ${formatExpiryMonthYear(l.expiryDate)}' : ''}',
                    style: const TextStyle(fontFamily: 'monospace'),
                  ),
                  trailing: Text(
                    l.qty == null ? '—' : formatPickQty(l.qty!),
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                  ),
                ),
              ),
            ),
          ],
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (Object e, _) => Center(
          child: Padding(padding: const EdgeInsets.all(16), child: Text(localizeApiErrorMessage(loc, e))),
        ),
      ),
    );
  }
}
