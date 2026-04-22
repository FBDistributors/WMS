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
  // returnToKirimForm / returnToReturns: [InventoryBarcodeResolveScreen] pops productId
  // so KirimForm state is preserved (avoid router.goNamed stack reset).
  if (a.returnToKirimForm || a.returnToReturns) {
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
  if (a.returnToInventoryDetail) {
    goInventoryDetailFromBarcode(router, product.productId);
    return;
  }
  goInventoryDetailFromBarcode(router, product.productId);
}
