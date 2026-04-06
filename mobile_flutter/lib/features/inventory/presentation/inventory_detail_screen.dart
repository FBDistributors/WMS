import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/models/picker_inventory_models.dart';
import 'inventory_locale.dart';
import 'inventory_providers.dart';

/// RN `InventoryDetailScreen` — asosiy + showroom omborlari.
class InventoryDetailScreen extends ConsumerWidget {
  const InventoryDetailScreen({super.key, required this.productId});

  final String productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final InventoryLocale loc = ref.watch(inventoryLocaleProvider);
    final AsyncValue<InventoryDetailPair> data =
        ref.watch(inventoryProductDetailProvider(productId));
    final bool isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : const Color(0xFFF5F5F5),
      appBar: AppBar(
        title: Text(InventoryStrings.invTitle(loc)),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: data.when(
        data: (InventoryDetailPair pair) {
          final PickerProductDetailResponse main = pair.main;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: <Widget>[
              Text(
                main.name,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: isDark ? Colors.white : Colors.black87,
                    ),
              ),
              if (main.mainBarcode != null && main.mainBarcode!.isNotEmpty)
                Text(main.mainBarcode!, style: TextStyle(color: isDark ? Colors.white70 : Colors.black54)),
              Text(
                main.code,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: isDark ? const Color(0xFF93C5FD) : const Color(0xFF1A237E),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                '${InventoryStrings.invTitle(loc)} — asosiy',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: isDark ? Colors.white70 : Colors.black54,
                ),
              ),
              ...inventoryLocTiles(main.locations, loc, isDark),
              const SizedBox(height: 16),
              Text(
                'Showroom',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: isDark ? Colors.white70 : Colors.black54,
                ),
              ),
              ...inventoryLocTiles(pair.showroom.locations, loc, isDark),
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => Center(child: Text(InventoryStrings.invLoadError(loc))),
      ),
    );
  }
}

List<Widget> inventoryLocTiles(
  List<PickerProductLocation> locations,
  InventoryLocale loc,
  bool isDark,
) {
  if (locations.isEmpty) {
    return <Widget>[
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(InventoryStrings.invNoResults(loc)),
      ),
    ];
  }
  return locations.map((PickerProductLocation l) {
    return Card(
      color: isDark ? const Color(0xFF1E293B) : Colors.white,
      child: ListTile(
        title: Text(l.locationCode, style: TextStyle(color: isDark ? Colors.white : Colors.black87)),
        subtitle: Text(
          l.expiryDate ?? '—',
          style: TextStyle(color: isDark ? Colors.white54 : Colors.black45),
        ),
        trailing: Text(
          '${InventoryStrings.invQoldiq(loc)}: ${l.availableQty.round()}',
          style: TextStyle(color: isDark ? Colors.white70 : Colors.black87),
        ),
      ),
    );
  }).toList();
}
