import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../../core/router/scanner_args.dart';
import '../../inventory/data/models/picker_inventory_models.dart';
import '../../inventory/presentation/inventory_providers.dart';
import '../../picking/domain/profile_type_param.dart';
import '../data/scanner_repository.dart';
import '../scanner_providers.dart';

const int _kDebounceMs = 1500;

/// RN `ScannerScreen` — debounce, `/scanner/resolve` va `by-barcode`, returnTo* marshrutlar.
class ScannerScreen extends ConsumerStatefulWidget {
  const ScannerScreen({super.key, this.args});

  final ScannerArgs? args;

  @override
  ConsumerState<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends ConsumerState<ScannerScreen> {
  final MobileScannerController _controller = MobileScannerController();
  String? _lastRaw;
  int _lastAt = 0;
  bool _busy = false;
  bool _scanEnabled = true;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  PickerProfileParam _profile(ScannerArgs? a) {
    return a?.profileType ?? PickerProfileParam.picker;
  }

  Future<void> _onBarcode(String raw) async {
    final String value = raw.trim();
    if (value.isEmpty || _busy || !_scanEnabled) {
      return;
    }
    final int now = DateTime.now().millisecondsSinceEpoch;
    if (value == _lastRaw && now - _lastAt < _kDebounceMs) {
      return;
    }
    _lastRaw = value;
    _lastAt = now;

    final ScannerArgs? a = widget.args;
    final GoRouter router = GoRouter.of(context);

    setState(() {
      _busy = true;
      _scanEnabled = false;
    });

    try {
      if (a != null && a.returnToPick && a.taskId != null && a.taskId!.isNotEmpty) {
        final PickerProfileParam p = _profile(a);
        router.goNamed(
          'pickTaskDetail',
          pathParameters: <String, String>{'taskId': a.taskId!},
          queryParameters: <String, String>{
            'profile': profileToQuery(p),
            'scannedBarcode': value,
            if (a.lineId != null) 'lineId': a.lineId!,
          },
        );
        return;
      }

      if (a != null && a.returnToConsolidated) {
        final PickerProfileParam p = _profile(a);
        router.goNamed(
          'pickTasks',
          queryParameters: <String, String>{
            'profile': profileToQuery(p),
            'openConsolidated': '1',
            'scannedBarcode': value,
            if (a.selectedProductKey != null) 'selectedProductKey': a.selectedProductKey!,
          },
        );
        return;
      }

      if (a != null && a.returnToMovementPallet) {
        final ScannerResolveOut out =
            await ref.read(scannerRepositoryProvider).resolveBarcode(value);
        if (!mounted) {
          return;
        }
        if (out.type == ScannerResolveType.location && out.locationCode != null) {
          router.goNamed(
            'movement',
            queryParameters: <String, String>{'scannedLocationCode': out.locationCode!},
          );
        } else if (out.type == ScannerResolveType.product) {
          _showError('Lokatsiya kutilmoqda (palet), mahsulot emas');
          _resumeScan();
        } else {
          _showError(out.message ?? 'Lokatsiya aniqlanmadi');
          _resumeScan();
        }
        return;
      }

      if (a != null && a.returnToKirimLocation && a.flow == 'new') {
        final ScannerResolveOut out =
            await ref.read(scannerRepositoryProvider).resolveBarcode(value);
        if (!mounted) {
          return;
        }
        if (out.type == ScannerResolveType.location &&
            out.locationId != null &&
            out.locationCode != null) {
          router.goNamed(
            'kirimForm',
            queryParameters: <String, String>{
              'flow': 'new',
              'newMode': 'byLocation',
              'warehouse': a.warehouse ?? 'main',
              'receivingLocationId': out.locationId!,
              'receivingLocationCode': out.locationCode!,
            },
          );
        } else if (out.type == ScannerResolveType.product) {
          _showError('Lokatsiya skanerlang');
          _resumeScan();
        } else {
          _showError(out.message ?? 'Lokatsiya topilmadi');
          _resumeScan();
        }
        return;
      }

      final InventoryByBarcodeResponse product =
          await ref.read(inventoryRepositoryProvider).getInventoryByBarcode(value);
      if (!mounted) {
        return;
      }
      _routeAfterProductLookup(router, product, a);
    } on Exception catch (e) {
      if (mounted) {
        _showError('$e');
        _resumeScan();
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  void _routeAfterProductLookup(
    GoRouter router,
    InventoryByBarcodeResponse product,
    ScannerArgs? a,
  ) {
    if (a == null) {
      router.goNamed(
        'inventoryDetail',
        pathParameters: <String, String>{'productId': product.productId},
      );
      return;
    }
    if (a.returnToPick ||
        a.returnToMovementPallet ||
        a.returnToKirimLocation) {
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
    router.goNamed(
      'inventoryDetail',
      pathParameters: <String, String>{'productId': product.productId},
    );
  }

  void _resumeScan() {
    if (mounted) {
      setState(() => _scanEnabled = true);
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    _lastRaw = null;
    _lastAt = 0;
  }

  void _onDetect(BarcodeCapture cap) {
    if (!_scanEnabled || _busy) {
      return;
    }
    final List<Barcode> list = cap.barcodes;
    if (list.isEmpty) {
      return;
    }
    final String? raw = list.first.rawValue;
    if (raw == null || raw.isEmpty) {
      return;
    }
    unawaited(_onBarcode(raw));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Scanner'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.goNamed('pickerHome');
            }
          },
        ),
      ),
      body: Stack(
        children: <Widget>[
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
          ),
          if (_busy)
            const Positioned.fill(
              child: ColoredBox(
                color: Color(0x66000000),
                child: Center(child: CircularProgressIndicator()),
              ),
            ),
        ],
      ),
    );
  }
}
