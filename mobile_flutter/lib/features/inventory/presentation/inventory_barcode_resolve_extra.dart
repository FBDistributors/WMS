import '../../../core/router/scanner_args.dart';

/// `goNamed('inventoryBarcodeResolve', extra: …)` uchun.
class InventoryBarcodeResolveExtra {
  const InventoryBarcodeResolveExtra({
    required this.barcode,
    this.args,
  });

  final String barcode;
  final ScannerArgs? args;
}
