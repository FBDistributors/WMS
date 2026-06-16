import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/router/scanner_args.dart';
import '../../../l10n/string_lookup.dart';
import '../../inventory/data/models/picker_inventory_models.dart';
import '../../movements/data/movements_repository.dart';
import '../../movements/movements_providers.dart';
import '../../product_boxes/data/box_location_models.dart';
import '../../product_boxes/data/product_box_models.dart';
import '../../product_boxes/data/product_box_repository.dart';
import '../../product_boxes/product_box_providers.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../../shared/input/input_clear_button.dart';
import '../../../shared/input/stock_quantity_input.dart';
import '../../../shared/widgets/scan_action_button.dart';
import 'inventory_box_save.dart';

/// Inventarizatsiya: quti skan, hajm, quti soni, qutisiz dona — bitta Saqlash.
class InventorySimpleBoxPanel extends ConsumerStatefulWidget {
  const InventorySimpleBoxPanel({
    super.key,
    required this.productId,
    required this.locationId,
    required this.lotId,
    this.initialBoxCount,
    this.initialLooseQty,
    this.looseAdjustLots,
    this.onSaved,
  });

  final String productId;
  final String locationId;
  final String lotId;
  final int? initialBoxCount;
  final int? initialLooseQty;
  final List<PickerProductLocation>? looseAdjustLots;
  final void Function(BoxLocationBreakdown breakdown)? onSaved;

  @override
  ConsumerState<InventorySimpleBoxPanel> createState() =>
      _InventorySimpleBoxPanelState();
}

class _InventorySimpleBoxPanelState extends ConsumerState<InventorySimpleBoxPanel> {
  final TextEditingController _boxBarcode = TextEditingController();
  final TextEditingController _boxCount = TextEditingController();
  final TextEditingController _looseQty = TextEditingController();
  String? _resolvedBarcode;
  int? _unitsPerBox;
  BoxLocationBreakdown? _breakdown;
  bool _loadingBreakdown = true;
  bool _saving = false;
  String? _breakdownError;
  bool _fieldsInitialized = false;

  @override
  void initState() {
    super.initState();
    unawaited(_loadBreakdown());
  }

  @override
  void dispose() {
    _boxBarcode.dispose();
    _boxCount.dispose();
    _looseQty.dispose();
    super.dispose();
  }

  void _applyDefaultsFromBreakdown(BoxLocationBreakdown b) {
    if (_fieldsInitialized) {
      return;
    }
    _fieldsInitialized = true;
    final int loose = widget.initialLooseQty ?? b.looseUnits;
    final int boxes = widget.initialBoxCount ?? b.boxCount;
    _boxCount.text = '$boxes';
    _looseQty.text = '$loose';
  }

  Future<void> _loadBreakdown() async {
    setState(() {
      _loadingBreakdown = true;
      _breakdownError = null;
    });
    try {
      final BoxLocationBreakdown b =
          await ref.read(boxLocationRepositoryProvider).getBreakdown(
                productId: widget.productId,
                lotId: widget.lotId,
                locationId: widget.locationId,
              );
      if (!mounted) {
        return;
      }
      setState(() {
        _breakdown = b;
        _loadingBreakdown = false;
      });
      _applyDefaultsFromBreakdown(b);
      if (mounted) {
        setState(() {});
      }
    } on Exception catch (e) {
      if (mounted) {
        setState(() {
          _breakdownError = '$e';
          _loadingBreakdown = false;
        });
      }
    }
  }

  Future<String?> _scanRawBarcode() {
    return context.pushNamed<String>(
      'scanner',
      extra: const ScannerArgs(returnRawBarcode: true),
    );
  }

  Future<void> _resolveBarcode(String raw) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final String barcode = raw.trim();
    if (barcode.isEmpty) {
      return;
    }
    try {
      final ProductBoxResolve resolved =
          await ref.read(productBoxRepositoryProvider).resolveByBarcode(barcode);
      if (resolved.productId != widget.productId) {
        if (mounted) {
          showAppSnackBar(
            context,
            SnackBar(content: Text(StringLookup.t(loc, 'inventoryBoxProductMismatch'))),
          );
        }
        return;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _resolvedBarcode = barcode;
        _unitsPerBox = resolved.unitsPerBox;
        _boxBarcode.text = barcode;
      });
      final BoxLocationBreakdown? b = _breakdown;
      if (b != null) {
        final int sealed = sealedBoxCountForBarcode(b, barcode);
        _boxCount.text = '$sealed';
        if (mounted) {
          setState(() {});
        }
      }
    } on ProductBoxNotFoundException {
      if (mounted) {
        showAppSnackBar(
          context,
          SnackBar(content: Text(StringLookup.t(loc, 'inventoryBoxNotFound'))),
        );
      }
    } on Exception catch (e) {
      if (mounted) {
        showAppSnackBar(context, SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _confirmBarcodeManual() async {
    await _resolveBarcode(_boxBarcode.text);
  }

  Future<void> _scanBox() async {
    final String? code = await _scanRawBarcode();
    if (!mounted || code == null || code.trim().isEmpty) {
      return;
    }
    await _resolveBarcode(code.trim());
  }

  Widget? _barcodeSuffix(AppLocale loc) {
    final String text = _boxBarcode.text.trim();
    if (text.isEmpty) {
      return null;
    }
    final bool needsConfirm = text != _resolvedBarcode;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        if (needsConfirm)
          IconButton(
            tooltip: StringLookup.t(loc, 'kirimNewBoxBarcodeConfirm'),
            onPressed: _saving ? null : () => unawaited(_confirmBarcodeManual()),
            constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
            padding: EdgeInsets.zero,
            splashRadius: 20,
            icon: const Icon(Icons.check, color: Color(0xFF1A237E)),
          ),
        buildInputClearButton(
          visible: true,
          onPressed: () {
            if (_saving) {
              return;
            }
            setState(() {
              _boxBarcode.clear();
              _resolvedBarcode = null;
              _unitsPerBox = null;
            });
          },
        )!,
      ],
    );
  }

  Future<void> _save() async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final BoxLocationBreakdown? b = _breakdown;
    if (b == null) {
      return;
    }

    final String barcode = (_resolvedBarcode ?? _boxBarcode.text).trim();
    final int targetBoxCount = int.tryParse(_boxCount.text.trim()) ?? 0;
    final int targetLooseQty = int.tryParse(_looseQty.text.trim()) ?? 0;
    final int? upb = _unitsPerBox;

    if (targetBoxCount < 0 || targetLooseQty < 0) {
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'kirimNewReceiveFillAll'))),
      );
      return;
    }

    if (!inventoryBoxSaveHasChanges(
      breakdown: b,
      boxBarcode: barcode.isEmpty ? null : barcode,
      targetBoxCount: targetBoxCount,
      targetLooseQty: targetLooseQty,
      looseAdjustLots: widget.looseAdjustLots,
    )) {
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'inventoryNoChanges'))),
      );
      return;
    }

    final int currentBoxes = currentBoxCountTarget(b, barcode);
    final int boxDelta = targetBoxCount - currentBoxes;
    if (boxDelta != 0) {
      if (barcode.isEmpty || _resolvedBarcode == null) {
        showAppSnackBar(
          context,
          SnackBar(content: Text(StringLookup.t(loc, 'kirimNewReceiveFillAll'))),
        );
        return;
      }
      if (upb == null || upb < 1) {
        await _resolveBarcode(barcode);
        if (_unitsPerBox == null) {
          return;
        }
      }
    }

    setState(() => _saving = true);
    try {
      final boxRepo = ref.read(boxLocationRepositoryProvider);
      final MovementsRepository movements = ref.read(movementsRepositoryProvider);
      final BoxLocationBreakdown result = await applyInventoryBoxSave(
        boxBarcode: barcode.isEmpty ? null : barcode,
        unitsPerBox: _unitsPerBox,
        targetBoxCount: targetBoxCount,
        targetLooseQty: targetLooseQty,
        productId: widget.productId,
        locationId: widget.locationId,
        lotId: widget.lotId,
        looseAdjustLots: widget.looseAdjustLots,
        getBreakdown: () => boxRepo.getBreakdown(
          productId: widget.productId,
          lotId: widget.lotId,
          locationId: widget.locationId,
        ),
        placeBox: ({required String boxBarcode, required int boxCount}) =>
            boxRepo.placeBox(
              boxBarcode: boxBarcode,
              locationId: widget.locationId,
              lotId: widget.lotId,
              boxCount: boxCount,
            ),
        removeBox: ({required String boxBarcode}) => boxRepo.removeBox(
          boxBarcode: boxBarcode,
          locationId: widget.locationId,
          lotId: widget.lotId,
        ),
        createMovement: ({
          required String productId,
          required String lotId,
          required String locationId,
          required double qtyChange,
          required String reasonCode,
        }) =>
            movements.createStockMovement(
              productId: productId,
              lotId: lotId,
              locationId: locationId,
              qtyChange: qtyChange,
              reasonCode: reasonCode,
            ),
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _breakdown = result;
        _fieldsInitialized = false;
        _boxBarcode.clear();
        _resolvedBarcode = null;
        _unitsPerBox = null;
      });
      _applyDefaultsFromBreakdown(result);
      showAppTopSuccess(context, StringLookup.t(loc, 'inventorySimpleSaved'));
      widget.onSaved?.call(result);
    } on InventoryBoxSavePartialFailure catch (e) {
      await _loadBreakdown();
      if (mounted) {
        showAppSnackBar(context, SnackBar(content: Text('${e.cause}')));
      }
    } on StockMovementForbiddenException {
      if (mounted) {
        showAppSnackBar(
          context,
          SnackBar(content: Text(StringLookup.t(loc, 'inventoryPermissionDenied'))),
        );
      }
    } on Exception catch (e) {
      final String msg = '$e';
      if (msg.contains('insufficient_loose')) {
        final List<String> parts = msg.split(':');
        if (mounted) {
          showAppSnackBar(
            context,
            SnackBar(
              content: Text(
                StringLookup.tParams(
                  loc,
                  'inventoryInsufficientLoose',
                  <String, String>{
                    'needed': parts.length > 1 ? parts[1] : '?',
                    'available': parts.length > 2 ? parts[2] : '?',
                  },
                ),
              ),
            ),
          );
        }
      } else if (mounted) {
        showAppSnackBar(context, SnackBar(content: Text(msg)));
      }
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final int? upb = _unitsPerBox;

    if (_loadingBreakdown) {
      return const LinearProgressIndicator();
    }
    if (_breakdownError != null) {
      return Text(_breakdownError!, style: const TextStyle(color: Colors.red));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: TextField(
                controller: _boxBarcode,
                enabled: !_saving,
                textInputAction: TextInputAction.done,
                decoration: InputDecoration(
                  labelText: StringLookup.t(loc, 'inventoryBoxBarcode'),
                  border: const OutlineInputBorder(),
                  hintText: StringLookup.t(loc, 'kirimNewBoxBarcodeHint'),
                  suffixIcon: _barcodeSuffix(loc),
                ),
                onChanged: (_) => setState(() {}),
                onSubmitted: (_) => unawaited(_confirmBarcodeManual()),
              ),
            ),
            const SizedBox(width: 8),
            ScanActionButton(
              compact: true,
              label: StringLookup.t(loc, 'inventoryScanBox'),
              onPressed: _saving ? null : () => unawaited(_scanBox()),
            ),
          ],
        ),
        const SizedBox(height: 12),
        InputDecorator(
          decoration: InputDecoration(
            labelText: StringLookup.t(loc, 'inventoryBoxUnitsPerBox'),
            border: const OutlineInputBorder(),
          ),
          child: Text(
            upb?.toString() ?? '—',
            style: TextStyle(
              fontSize: 16,
              color: upb != null ? null : Colors.grey.shade600,
            ),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _boxCount,
          enabled: !_saving,
          keyboardType: kStockQtyKeyboardType,
          inputFormatters: kStockQtyInputFormatters,
          decoration: InputDecoration(
            labelText: StringLookup.t(loc, 'inventoryBoxCount'),
            border: const OutlineInputBorder(),
            suffixIcon: buildInputClearButton(
              visible: _boxCount.text.trim().isNotEmpty && _boxCount.text.trim() != '0',
              onPressed: () {
                if (_saving) {
                  return;
                }
                setState(() => _boxCount.text = '0');
              },
            ),
          ),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _looseQty,
          enabled: !_saving,
          keyboardType: kStockQtyKeyboardType,
          inputFormatters: kStockQtyInputFormatters,
          decoration: InputDecoration(
            labelText: StringLookup.t(loc, 'inventoryLooseQtyTarget'),
            border: const OutlineInputBorder(),
            suffixIcon: buildInputClearButton(
              visible: _looseQty.text.trim().isNotEmpty,
              onPressed: () {
                if (_saving) {
                  return;
                }
                setState(() => _looseQty.clear());
              },
            ),
          ),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _saving ? null : () => unawaited(_save()),
          child: _saving
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : Text(StringLookup.t(loc, 'inventorySimpleSave')),
        ),
      ],
    );
  }
}
