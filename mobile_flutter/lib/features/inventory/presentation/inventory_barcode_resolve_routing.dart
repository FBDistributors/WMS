import 'package:go_router/go_router.dart';

import '../../../core/router/scanner_args.dart';
import '../data/models/picker_inventory_models.dart';

void goInventoryDetailFromBarcode(
  GoRouter router,
  String productId, {
  String? scannedBoxBarcode,
  int? unitsPerBox,
}) {
  final Map<String, String> query = <String, String>{};
  if (scannedBoxBarcode != null && scannedBoxBarcode.trim().isNotEmpty) {
    query['scannedBoxBarcode'] = scannedBoxBarcode.trim();
  }
  if (unitsPerBox != null && unitsPerBox > 0) {
    query['unitsPerBox'] = '$unitsPerBox';
  }
  router.go(
    Uri(
      path: '/inventory/detail/${Uri.encodeComponent(productId)}',
      queryParameters: query.isEmpty ? null : query,
    ).toString(),
  );
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
  final String? boxBarcode =
      product.scanKind == 'box' ? (product.boxBarcode ?? product.scannedBarcode) : null;
  final int? unitsPerBox = product.scanKind == 'box' ? product.unitsPerBox : null;
  if (a.returnToInventoryDetail) {
    goInventoryDetailFromBarcode(
      router,
      product.productId,
      scannedBoxBarcode: boxBarcode,
      unitsPerBox: unitsPerBox,
    );
    return;
  }
  goInventoryDetailFromBarcode(
    router,
    product.productId,
    scannedBoxBarcode: boxBarcode,
    unitsPerBox: unitsPerBox,
  );
}
