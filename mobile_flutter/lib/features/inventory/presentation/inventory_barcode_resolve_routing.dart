import 'package:go_router/go_router.dart';

import '../../../core/router/scanner_args.dart';
import '../data/models/picker_inventory_models.dart';

void goInventoryDetailFromBarcode(GoRouter router, String productId) {
  router.go('/inventory/detail/${Uri.encodeComponent(productId)}');
}

/// Skaner va [InventoryBarcodeResolveScreen] uchun bir xil marshrutlash.
void routeAfterInventoryBarcodeLookup(
  GoRouter router,
  InventoryByBarcodeResponse product,
  ScannerArgs? a,
) {
  if (a == null) {
    goInventoryDetailFromBarcode(router, product.productId);
    return;
  }
  if (a.returnToPick || a.returnToMovementPallet || a.returnToKirimLocation) {
    return;
  }
  if (a.returnToKirimForm) {
    router.goNamed(
      'kirimForm',
      queryParameters: <String, String>{
        'flow': a.flow ?? 'return',
        if (a.newMode != null) 'newMode': a.newMode!,
        if (a.warehouse != null) 'warehouse': a.warehouse!,
        'scannedProductId': product.productId,
        if (product.barcode != null && product.barcode!.isNotEmpty)
          'scannedBarcode': product.barcode!,
        if (a.inventoryStep != null) 'inventoryStep': '${a.inventoryStep}',
        if (a.inventoryLocationId != null) 'inventoryLocationId': a.inventoryLocationId!,
        if (a.inventoryLocationCode != null) 'inventoryLocationCode': a.inventoryLocationCode!,
        if (a.receivingLocationId != null) 'receivingLocationId': a.receivingLocationId!,
        if (a.receivingLocationCode != null) 'receivingLocationCode': a.receivingLocationCode!,
      },
    );
    return;
  }
  if (a.returnToMovement) {
    router.goNamed(
      'movement',
      queryParameters: <String, String>{
        'scannedProductId': product.productId,
        if (product.barcode != null && product.barcode!.isNotEmpty)
          'scannedBarcode': product.barcode!,
      },
    );
    return;
  }
  if (a.returnToReturns) {
    router.goNamed(
      'kirimForm',
      queryParameters: <String, String>{
        'flow': 'return',
        'scannedProductId': product.productId,
        if (product.barcode != null && product.barcode!.isNotEmpty)
          'scannedBarcode': product.barcode!,
      },
    );
    return;
  }
  goInventoryDetailFromBarcode(router, product.productId);
}
