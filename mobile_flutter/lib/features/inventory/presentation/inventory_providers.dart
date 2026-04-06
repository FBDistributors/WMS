import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/app_dio.dart';
import '../data/inventory_repository.dart';
import '../data/models/picker_inventory_models.dart';
import 'inventory_list_controller.dart';

export 'inventory_filter_providers.dart';

final inventoryRepositoryProvider = Provider<InventoryRepository>((Ref ref) {
  return InventoryRepository(ref.watch(appDioProvider));
});

final pickerLocationsProvider =
    FutureProvider<List<PickerLocationOption>>((Ref ref) async {
  final InventoryRepository repo = ref.watch(inventoryRepositoryProvider);
  try {
    return await repo.listPickerLocations();
  } catch (_) {
    return const <PickerLocationOption>[];
  }
});

final inventoryListControllerProvider =
    StateNotifierProvider<InventoryListController, InventoryViewState>(
  (Ref ref) {
    return InventoryListController(
      ref.watch(inventoryRepositoryProvider),
      ref,
    );
  },
);

typedef InventoryDetailPair = ({
  PickerProductDetailResponse main,
  PickerProductDetailResponse showroom,
});

final inventoryProductDetailProvider = FutureProvider.autoDispose
    .family<InventoryDetailPair, String>((Ref ref, String productId) async {
  final InventoryRepository repo = ref.watch(inventoryRepositoryProvider);
  final PickerProductDetailResponse main =
      await repo.getPickerProductDetail(productId, warehouse: 'main');
  final PickerProductDetailResponse showroom =
      await repo.getPickerProductDetail(productId, warehouse: 'showroom');
  return (main: main, showroom: showroom);
});
