import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'inventory_providers.dart';

final inventoryQueryProvider = StateProvider<String>((Ref ref) => '');

final inventoryLocationIdProvider = StateProvider<String>((Ref ref) => '');

/// Selected brand name filter ('' = all brands).
final inventoryBrandProvider = StateProvider<String>((Ref ref) => '');

/// Selected warehouse filter ('' = all, 'main', 'showroom').
final inventoryWarehouseProvider = StateProvider<String>((Ref ref) => '');

/// True when any non-search filter (location / brand / warehouse) is active.
final inventoryHasActiveFilterProvider = Provider<bool>((Ref ref) {
  return ref.watch(inventoryLocationIdProvider).isNotEmpty ||
      ref.watch(inventoryBrandProvider).isNotEmpty ||
      ref.watch(inventoryWarehouseProvider).isNotEmpty;
});

/// Distinct brand names for the filter sheet (picker-accessible endpoint).
final pickerBrandsProvider = FutureProvider<List<String>>((Ref ref) async {
  final repo = ref.watch(inventoryRepositoryProvider);
  try {
    return await repo.listPickerBrands();
  } catch (_) {
    return const <String>[];
  }
});
