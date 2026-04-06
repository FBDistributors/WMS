import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/picking/data/picking_models.dart';
import '../../features/picking/picking_providers.dart';

/// RN `ConsolidatedPickContent` — yig‘ma terish ro‘yxati (faqat o‘qish).
class ConsolidatedPickContent extends ConsumerWidget {
  const ConsolidatedPickContent({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<ConsolidatedViewResponse> view = ref.watch(consolidatedViewProvider);
    return view.when(
      data: (ConsolidatedViewResponse v) {
        if (v.products.isEmpty) {
          return const Center(child: Text('Hozircha qatorlar yo‘q'));
        }
        return ListView.builder(
          itemCount: v.products.length,
          itemBuilder: (BuildContext context, int i) {
            final ConsolidatedProduct p = v.products[i];
            return ListTile(
              title: Text(p.productName),
              subtitle: Text(
                '${p.totalPicked} / ${p.totalRequired} · ${p.barcode ?? p.sku ?? ''}',
              ),
            );
          },
        );
      },
      loading: () => const Center(child: Padding(
            padding: EdgeInsets.all(24),
            child: CircularProgressIndicator(),
          )),
      error: (Object e, _) => Text('$e'),
    );
  }
}
