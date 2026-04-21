import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../l10n/string_lookup.dart';
import '../customer_returns_providers.dart';
import '../data/customer_returns_models.dart';

class CustomerReturnsQueueScreen extends ConsumerWidget {
  const CustomerReturnsQueueScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final AsyncValue<CustomerReturnListResponse> async =
        ref.watch(customerReturnsQueueProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(StringLookup.t(loc, 'kirimReturnsQueueCard')),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: async.when(
        data: (CustomerReturnListResponse r) {
          if (r.items.isEmpty) {
            return Center(child: Text(StringLookup.t(loc, 'returnsQueueEmpty')));
          }
          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(customerReturnsQueueProvider);
            },
            child: ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: r.items.length,
              itemBuilder: (BuildContext context, int i) {
                final CustomerReturn c = r.items[i];
                final String? custLabel = (c.customerName != null && c.customerName!.trim().isNotEmpty)
                    ? c.customerName!.trim()
                    : (c.customerId != null && c.customerId!.trim().isNotEmpty ? c.customerId!.trim() : null);
                final String summary = StringLookup.tParams(loc, 'returnsLinesSummary', <String, String>{
                  'status': c.status,
                  'count': '${c.lines.length}',
                });
                return Card(
                  child: ListTile(
                    title: Text(c.docNo),
                    subtitle: Text(custLabel != null ? '$custLabel · $summary' : summary),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.pushNamed(
                      'customerReturnDetail',
                      pathParameters: <String, String>{'returnId': c.id},
                    ),
                  ),
                );
              },
            ),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (Object e, _) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Text('$e'),
              FilledButton(
                onPressed: () => ref.invalidate(customerReturnsQueueProvider),
                child: Text(StringLookup.t(loc, 'retry')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
