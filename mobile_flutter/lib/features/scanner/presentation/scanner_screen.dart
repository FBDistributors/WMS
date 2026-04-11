import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/router/scanner_args.dart';
import '../../../l10n/string_lookup.dart';
import '../../inventory/presentation/inventory_barcode_resolve_extra.dart';
import '../../picking/domain/profile_type_param.dart';
import '../data/scanner_repository.dart';
import '../scan_beep.dart';
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
  /// Faqat `resolveBarcode` (palet / kirim lokatsiyasi) uchun pastki banner.
  bool _lookupInProgress = false;
  bool _scanEnabled = true;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  PickerProfileParam _profile(ScannerArgs? a) {
    return a?.profileType ?? PickerProfileParam.picker;
  }

  void _resetScanGuards() {
    _lastRaw = null;
    _lastAt = 0;
  }

  void _routeToPick(GoRouter router, ScannerArgs a, String barcode) {
    final PickerProfileParam p = _profile(a);
    final Map<String, String> q = <String, String>{
      'profile': profileToQuery(p),
      'scannedBarcode': barcode,
      if (a.lineId != null) 'lineId': a.lineId!,
    };
    router.go(
      Uri(
        path: '/pick-task/${Uri.encodeComponent(a.taskId!)}',
        queryParameters: q,
      ).toString(),
    );
  }

  void _routeToConsolidated(GoRouter router, ScannerArgs a, String barcode) {
    final PickerProfileParam p = _profile(a);
    final Map<String, String> q = <String, String>{
      'profile': profileToQuery(p),
      'openConsolidated': '1',
      'scannedBarcode': barcode,
      if (a.selectedProductKey != null) 'selectedProductKey': a.selectedProductKey!,
    };
    router.go(Uri(path: '/pick-tasks', queryParameters: q).toString());
  }

  Future<bool> _dispatchRouteOnlyIfPossible(
    GoRouter router,
    String barcode,
    ScannerArgs? a,
  ) async {
    if (a == null) {
      return false;
    }
    if (a.returnToPick && a.taskId != null && a.taskId!.isNotEmpty) {
      _routeToPick(router, a, barcode);
      return true;
    }
    if (a.returnToConsolidated) {
      _routeToConsolidated(router, a, barcode);
      return true;
    }
    return false;
  }

  Future<void> _onBarcode(String raw) async {
    final String value = raw.trim();
    if (value.isEmpty || !_scanEnabled) {
      return;
    }
    final int now = DateTime.now().millisecondsSinceEpoch;
    if (value == _lastRaw && now - _lastAt < _kDebounceMs) {
      return;
    }
    _lastRaw = value;
    _lastAt = now;
    unawaited(ScanBeep.play());

    final ScannerArgs? a = widget.args;
    final GoRouter router = GoRouter.of(context);

    if (mounted) {
      setState(() => _scanEnabled = false);
    }

    if (await _dispatchRouteOnlyIfPossible(router, value, a)) {
      return;
    }

    if (a != null && a.returnToMovementPallet) {
      if (mounted) {
        setState(() => _lookupInProgress = true);
      }
      try {
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
      } on Exception catch (e) {
        if (mounted) {
          _showError('$e');
          _resumeScan();
        }
      } finally {
        if (mounted) {
          setState(() => _lookupInProgress = false);
        }
      }
      return;
    }

    if (a != null && a.returnToKirimLocation && a.flow == 'new') {
      if (mounted) {
        setState(() => _lookupInProgress = true);
      }
      try {
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
      } on Exception catch (e) {
        if (mounted) {
          _showError('$e');
          _resumeScan();
        }
      } finally {
        if (mounted) {
          setState(() => _lookupInProgress = false);
        }
      }
      return;
    }

    if (!mounted) {
      return;
    }
    router.goNamed(
      'inventoryBarcodeResolve',
      extra: InventoryBarcodeResolveExtra(barcode: value, args: a),
    );
  }

  void _resumeScan() {
    if (mounted) {
      setState(() => _scanEnabled = true);
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    _resetScanGuards();
  }

  void _handleBack() {
    final ScannerArgs? a = widget.args;
    if (a != null && (a.returnToMovement || a.returnToMovementPallet)) {
      context.goNamed('movement');
      return;
    }
    if (a != null && a.returnToKirimLocation && a.flow == 'new') {
      context.goNamed(
        'kirimForm',
        queryParameters: <String, String>{
          'flow': 'new',
          'newMode': 'byLocation',
          'warehouse': a.warehouse ?? 'main',
        },
      );
      return;
    }
    if (a != null && a.returnToKirimForm) {
      context.goNamed(
        'kirimForm',
        queryParameters: <String, String>{
          'flow': a.flow ?? 'return',
          if (a.newMode != null) 'newMode': a.newMode!,
          if (a.warehouse != null) 'warehouse': a.warehouse!,
          if (a.inventoryStep != null) 'inventoryStep': '${a.inventoryStep}',
          if (a.inventoryLocationId != null) 'inventoryLocationId': a.inventoryLocationId!,
          if (a.inventoryLocationCode != null) 'inventoryLocationCode': a.inventoryLocationCode!,
          if (a.receivingLocationId != null) 'receivingLocationId': a.receivingLocationId!,
          if (a.receivingLocationCode != null) 'receivingLocationCode': a.receivingLocationCode!,
        },
      );
      return;
    }
    if (a != null && a.returnToReturns) {
      context.goNamed(
        'kirimForm',
        queryParameters: const <String, String>{'flow': 'return'},
      );
      return;
    }
    if (a != null && a.returnToInventoryDetail) {
      context.goNamed('inventory');
      return;
    }
    if (context.canPop()) {
      context.pop();
    } else {
      context.goNamed('pickerHome');
    }
  }

  void _onDetect(BarcodeCapture cap) {
    if (!_scanEnabled) {
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
    final AppLocale loc = ref.watch(appLocaleProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Scanner'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: _handleBack,
        ),
      ),
      body: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
          ),
          if (_lookupInProgress)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: SafeArea(
                top: false,
                child: Material(
                  color: const Color(0xE6000000),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    child: Row(
                      children: <Widget>[
                        const SizedBox(
                          width: 26,
                          height: 26,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Text(
                            StringLookup.t(loc, 'loading'),
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 15,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
