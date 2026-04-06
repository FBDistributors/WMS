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
            return const Center(child: Text('Navbat bo‘sh'));
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
                return Card(
                  child: ExpansionTile(
                    title: Text(c.docNo),
                    subtitle: Text('${c.status} · ${c.lines.length} qator'),
                    children: <Widget>[
                      Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: <Widget>[
                            ...c.lines.map(
                              (CustomerReturnLine l) => ListTile(
                                dense: true,
                                title: Text(l.productName),
                                subtitle: Text('${l.locationCode} · ${l.qty}'),
                              ),
                            ),
                            FilledButton(
                              onPressed: () async {
                                try {
                                  await ref
                                      .read(customerReturnsRepositoryProvider)
                                      .completeCustomerReturn(c.id);
                                  if (context.mounted) {
                                    ref.invalidate(customerReturnsQueueProvider);
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(content: Text('Yakunlandi')),
                                    );
                                  }
                                } on Exception catch (e) {
                                  if (context.mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(content: Text('$e')),
                                    );
                                  }
                                }
                              },
                              child: const Text('Yakunlash (yig‘uvchi)'),
                            ),
                          ],
                        ),
                      ),
                    ],
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
                child: const Text('Qayta'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
