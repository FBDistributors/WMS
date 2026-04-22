import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/router/scanner_args.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../customer_returns/customer_returns_providers.dart';
import '../../inventory/presentation/inventory_barcode_resolve_extra.dart';
import '../../picking/domain/profile_type_param.dart';
import '../../picking/picking_providers.dart';
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
    ref.read(pendingPickTaskScanProvider.notifier).state = PickTaskScanFromScanner(
      taskId: a.taskId!,
      barcode: barcode,
      lineId: a.lineId,
      profileQuery: profileToQuery(p),
    );
    router.pop();
  }

  void _routeToConsolidated(GoRouter router, ScannerArgs a, String barcode) {
    final PickerProfileParam p = _profile(a);
    ref.read(pendingConsolidatedScanProvider.notifier).state = ConsolidatedScanFromScanner(
      profileQuery: profileToQuery(p),
      barcode: barcode,
      selectedProductKey: (a.selectedProductKey != null && a.selectedProductKey!.isNotEmpty)
          ? a.selectedProductKey
          : null,
    );
    router.pop();
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

    if (a != null &&
        a.returnToCustomerReturnProductVerify &&
        (a.customerReturnId ?? '').trim().isNotEmpty &&
        (a.lineId ?? '').trim().isNotEmpty &&
        (a.expectedProductId ?? '').trim().isNotEmpty) {
      final AppLocale locProduct = ref.read(appLocaleProvider);
      if (mounted) {
        setState(() => _lookupInProgress = true);
      }
      try {
        final ScannerResolveOut out =
            await ref.read(scannerRepositoryProvider).resolveBarcode(value);
        if (!mounted) {
          return;
        }
        if (out.type == ScannerResolveType.product &&
            out.productId != null &&
            out.productId!.trim().isNotEmpty &&
            out.productId!.trim().toLowerCase() == a.expectedProductId!.trim().toLowerCase()) {
          ref.read(pendingCustomerReturnProductVerifyProvider.notifier).state =
              CustomerReturnProductVerifyFromScanner(
            returnId: a.customerReturnId!.trim(),
            lineId: a.lineId!.trim(),
          );
          router.pop();
        } else if (out.type == ScannerResolveType.location) {
          _showError(StringLookup.t(locProduct, 'returnsExpectProductNotLocation'));
          _resumeScan();
        } else if (out.type == ScannerResolveType.product) {
          _showError(StringLookup.t(locProduct, 'returnsProductMismatch'));
          _resumeScan();
        } else {
          _showError(
            out.message ??
                StringLookup.t(locProduct, 'returnsProductMismatch'),
          );
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

    if (a != null &&
        a.returnToCustomerReturnLocation &&
        (a.customerReturnId ?? '').trim().isNotEmpty &&
        (a.lineId ?? '').trim().isNotEmpty) {
      final AppLocale locResolve = ref.read(appLocaleProvider);
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
            out.locationId!.trim().isNotEmpty) {
          final String label = (out.displayLabel != null && out.displayLabel!.trim().isNotEmpty)
              ? out.displayLabel!.trim()
              : (out.locationCode ?? value);
          ref.read(pendingCustomerReturnLocationScanProvider.notifier).state =
              CustomerReturnLocationScanFromScanner(
            returnId: a.customerReturnId!.trim(),
            lineId: a.lineId!.trim(),
            locationId: out.locationId!.trim(),
            displayLabel: label,
          );
          router.pop();
        } else if (out.type == ScannerResolveType.product) {
          _showError(StringLookup.t(locResolve, 'returnsLocationScanExpectLocation'));
          _resumeScan();
        } else {
          _showError(
            out.message ??
                StringLookup.t(locResolve, 'returnsLocationScanUnknown'),
          );
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
    final bool popChainToKirim =
        a != null && (a.returnToKirimForm || a.returnToReturns);
    // To‘liq path: `/scanner` dan `pushNamed('inventoryBarcodeResolve')` nested marshrutda
    // ba’zi stacklarda ishonchsiz — `/inventory/resolve-barcode` aniq ishlaydi.
    final Object? resolveResult = await context.push<Object?>(
      '/inventory/resolve-barcode',
      extra: InventoryBarcodeResolveExtra(barcode: value, args: a),
    );
    if (!mounted) {
      return;
    }
    if (popChainToKirim && resolveResult is String && resolveResult.isNotEmpty) {
      context.pop<String>(resolveResult);
      return;
    }
    if (a != null && a.returnToInventoryDetail) {
      final String loc = GoRouterState.of(context).matchedLocation;
      if (loc == '/scanner' && context.canPop()) {
        context.pop();
        return;
      }
    }
    _resumeScan();
  }

  void _resumeScan() {
    if (mounted) {
      setState(() => _scanEnabled = true);
    }
  }

  void _showError(String msg) {
    HapticFeedback.heavyImpact();
    showAppSnackBar(context, SnackBar(content: Text(msg)));
    _resetScanGuards();
  }

  void _handleBack() {
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
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (bool didPop, Object? result) {
        if (didPop) {
          return;
        }
        _handleBack();
      },
      child: Scaffold(
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
      ),
    );
  }
}
