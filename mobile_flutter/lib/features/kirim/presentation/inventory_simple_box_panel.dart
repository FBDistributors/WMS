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
  final TextEditingController _unitsPerBoxInput = TextEditingController();
  final TextEditingController _boxCount = TextEditingController();
  final TextEditingController _looseQty = TextEditingController();
  String? _resolvedBarcode;
  String? _resolvedBoxId;
  int? _unitsPerBox;
  bool _pendingBoxRegistration = false;
  bool _boxPrefilledFromBreakdown = false;
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
    _unitsPerBoxInput.dispose();
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
      _prefillBoxFromBreakdown(b);
      if (mounted) {
        setState(() {});
      }
    } on Exception catch (e) {
      if (!mounted) {
        return;
      }
      final String msg = '$e';
      if (isBreakdownInconsistentMessage(msg)) {
        final int loose = widget.initialLooseQty ?? 0;
        final int total = loose > 0 ? loose : (widget.initialBoxCount ?? 0);
        final BoxLocationBreakdown fallback = BoxLocationBreakdown(
          productId: widget.productId,
          lotId: widget.lotId,
          locationId: widget.locationId,
          boxCount: 0,
          unitsInBoxes: 0,
          looseUnits: loose,
          totalUnits: total,
          dataInconsistent: true,
        );
        setState(() {
          _breakdown = fallback;
          _loadingBreakdown = false;
          _breakdownError = null;
        });
        _applyDefaultsFromBreakdown(fallback);
        if (mounted) {
          setState(() {});
        }
        return;
      }
      setState(() {
        _breakdownError = msg;
        _loadingBreakdown = false;
      });
    }
  }

  Future<String?> _scanRawBarcode() {
    return context.pushNamed<String>(
      'scanner',
      extra: const ScannerArgs(returnRawBarcode: true),
    );
  }

  void _prefillBoxFromBreakdown(BoxLocationBreakdown b) {
    if (_boxPrefilledFromBreakdown || _resolvedBarcode != null) {
      return;
    }
    if (b.sealedBoxes.isEmpty) {
      return;
    }
    final SealedBoxInfo first = b.sealedBoxes.first;
    final String code = first.boxBarcode.trim();
    if (code.isEmpty) {
      return;
    }
    _boxPrefilledFromBreakdown = true;
    _boxBarcode.text = code;
    _resolvedBarcode = code;
    _resolvedBoxId = first.productBoxId;
    _unitsPerBox = first.unitsPerBox;
    _unitsPerBoxInput.text = '${first.unitsPerBox}';
    _boxCount.text = '${sealedBoxCountForBarcode(b, code)}';
  }

  int? _unitsPerBoxForReplace() {
    final int? fromField = int.tryParse(_unitsPerBoxInput.text.trim());
    if (fromField != null && fromField >= 1) {
      return fromField;
    }
    return _unitsPerBox;
  }

  String _boxReplaceErrorMessage(AppLocale loc, String msg) {
    if (msg.contains('already exists') || msg.contains('409')) {
      return StringLookup.t(loc, 'inventoryBoxBarcodeTaken');
    }
    return StringLookup.t(loc, 'inventoryBoxReplaceFailed');
  }

  void _applyResolvedBox(ProductBoxResolve resolved, String barcode, BoxLocationBreakdown? b) {
    _resolvedBarcode = barcode;
    _resolvedBoxId = resolved.boxId;
    _unitsPerBox = resolved.unitsPerBox;
    _pendingBoxRegistration = false;
    _unitsPerBoxInput.text = '${resolved.unitsPerBox}';
    _boxBarcode.text = barcode;
    if (b != null) {
      _boxCount.text = '${sealedBoxCountForBarcode(b, barcode)}';
    }
  }

  Future<bool> _tryReplaceBarcode(String newBarcode) async {
    final String? oldBoxId = _resolvedBoxId;
    final String? oldBarcode = _resolvedBarcode;
    if (oldBoxId == null || oldBarcode == null) {
      return false;
    }
    if (newBarcode == oldBarcode.trim()) {
      return false;
    }
    final AppLocale loc = ref.read(appLocaleProvider);
    final int? units = _unitsPerBoxForReplace();
    if (units == null || units < 1) {
      if (mounted) {
        showAppSnackBar(
          context,
          SnackBar(content: Text(StringLookup.t(loc, 'kirimNewReceiveFillAll'))),
        );
      }
      return true;
    }
    try {
      final ProductBoxResolve replaced =
          await ref.read(productBoxRepositoryProvider).replaceBarcode(
                ProductBoxReplaceBarcode(
                  oldBoxId: oldBoxId,
                  newBarcode: newBarcode,
                  productId: widget.productId,
                  unitsPerBox: units,
                ),
              );
      if (!mounted) {
        return true;
      }
      setState(() {
        _applyResolvedBox(replaced, newBarcode, _breakdown);
      });
      showAppTopSuccess(context, StringLookup.t(loc, 'inventoryBoxBarcodeReplaced'));
      await _loadBreakdown();
      return true;
    } on Exception catch (e) {
      if (mounted) {
        showAppSnackBar(
          context,
          SnackBar(content: Text(_boxReplaceErrorMessage(loc, '$e'))),
        );
      }
      return true;
    }
  }

  Future<void> _resolveBarcode(String raw) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final String barcode = raw.trim();
    if (barcode.isEmpty) {
      return;
    }
    if (await _tryReplaceBarcode(barcode)) {
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
        _applyResolvedBox(resolved, barcode, _breakdown);
      });
      if (mounted) {
        setState(() {});
      }
    } on ProductBoxNotFoundException {
      if (!mounted) {
        return;
      }
      setState(() {
        _boxBarcode.text = barcode;
        _resolvedBarcode = null;
        _resolvedBoxId = null;
        _unitsPerBox = null;
        _pendingBoxRegistration = true;
        _unitsPerBoxInput.clear();
      });
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
              _resolvedBoxId = null;
              _unitsPerBox = null;
              _pendingBoxRegistration = false;
              _unitsPerBoxInput.clear();
            });
          },
        )!,
      ],
    );
  }

  Future<bool> _ensureBoxRegistered(String barcode) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final String code = barcode.trim();
    if (code.isEmpty) {
      return false;
    }
    if (_resolvedBarcode == code && _unitsPerBox != null && _unitsPerBox! >= 1) {
      return true;
    }
    if (_resolvedBoxId != null &&
        _resolvedBarcode != null &&
        _resolvedBarcode!.trim() != code) {
      final bool handled = await _tryReplaceBarcode(code);
      if (handled) {
        return _resolvedBarcode == code && _unitsPerBox != null && _unitsPerBox! >= 1;
      }
    }
    final int units = int.tryParse(_unitsPerBoxInput.text.trim()) ?? 0;
    if (units < 1) {
      if (mounted) {
        showAppSnackBar(
          context,
          SnackBar(content: Text(StringLookup.t(loc, 'kirimNewReceiveFillAll'))),
        );
      }
      return false;
    }
    try {
      final ProductBoxResolve created =
          await ref.read(productBoxRepositoryProvider).create(
                ProductBoxCreate(
                  boxBarcode: code,
                  productId: widget.productId,
                  unitsPerBox: units,
                ),
              );
      if (!mounted) {
        return false;
      }
      setState(() {
        _resolvedBarcode = code;
        _resolvedBoxId = created.boxId;
        _unitsPerBox = created.unitsPerBox;
        _pendingBoxRegistration = false;
        _unitsPerBoxInput.text = '${created.unitsPerBox}';
        _boxBarcode.text = code;
      });
      return true;
    } on Exception catch (e) {
      if (mounted) {
        final String msg = '$e';
        final String text = msg.contains('already exists')
            ? StringLookup.t(loc, 'inventoryBoxAlreadyExists')
            : msg;
        showAppSnackBar(context, SnackBar(content: Text(text)));
      }
      return false;
    }
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
      if (barcode.isEmpty) {
        showAppSnackBar(
          context,
          SnackBar(content: Text(StringLookup.t(loc, 'kirimNewReceiveFillAll'))),
        );
        return;
      }
      if (_resolvedBarcode == null || _unitsPerBox == null || _unitsPerBox! < 1) {
        final bool registered = await _ensureBoxRegistered(barcode);
        if (!registered || _unitsPerBox == null) {
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
        _resolvedBoxId = null;
        _unitsPerBox = null;
        _pendingBoxRegistration = false;
        _boxPrefilledFromBreakdown = false;
        _unitsPerBoxInput.clear();
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
      final ({int? needed, int? available})? insufficient =
          parseInsufficientLooseMessage(msg);
      if (insufficient != null) {
        if (mounted) {
          showAppSnackBar(
            context,
            SnackBar(
              content: Text(
                StringLookup.tParams(
                  loc,
                  'inventoryInsufficientLoose',
                  <String, String>{
                    'needed': '${insufficient.needed ?? '?'}',
                    'available': '${insufficient.available ?? '?'}',
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

  Widget _buildUnitsPerBoxField(AppLocale loc) {
    final int? upb = _unitsPerBox;
    final bool editable =
        _pendingBoxRegistration || (upb == null && _boxBarcode.text.trim().isNotEmpty);
    if (editable) {
      return TextField(
        controller: _unitsPerBoxInput,
        enabled: !_saving,
        keyboardType: kStockQtyKeyboardType,
        inputFormatters: kStockQtyInputFormatters,
        decoration: InputDecoration(
          labelText: StringLookup.t(loc, 'inventoryBoxUnitsPerBox'),
          border: const OutlineInputBorder(),
          suffixIcon: buildInputClearButton(
            visible: _unitsPerBoxInput.text.trim().isNotEmpty,
            onPressed: () {
              if (_saving) {
                return;
              }
              setState(() => _unitsPerBoxInput.clear());
            },
          ),
        ),
        onChanged: (_) => setState(() {}),
      );
    }
    return InputDecorator(
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
    );
  }

  Widget? _buildTotalPreview(AppLocale loc) {
    final int boxes = int.tryParse(_boxCount.text.trim()) ?? 0;
    final int loose = int.tryParse(_looseQty.text.trim()) ?? 0;
    final int? upb = _unitsPerBox ?? int.tryParse(_unitsPerBoxInput.text.trim());

    final int? total;
    if (upb != null && upb >= 1) {
      total = boxes * upb + loose;
    } else if (boxes == 0) {
      total = loose;
    } else {
      return null;
    }

    return Text(
      StringLookup.tParams(
        loc,
        'inventoryTargetTotal',
        <String, String>{'total': '$total'},
      ),
      style: const TextStyle(fontWeight: FontWeight.w600),
    );
  }

  Widget _buildInconsistentBanner(AppLocale loc) {
    return MaterialBanner(
      content: Text(StringLookup.t(loc, 'inventoryDataInconsistent')),
      backgroundColor: Colors.amber.shade100,
      actions: const <Widget>[SizedBox.shrink()],
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);

    if (_loadingBreakdown) {
      return const LinearProgressIndicator();
    }
    if (_breakdownError != null) {
      return Text(_breakdownError!, style: const TextStyle(color: Colors.red));
    }
    final BoxLocationBreakdown? breakdown = _breakdown;
    if (breakdown == null) {
      return const SizedBox.shrink();
    }

    final Widget? totalPreview = _buildTotalPreview(loc);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (breakdown.dataInconsistent) _buildInconsistentBanner(loc),
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
        _buildUnitsPerBoxField(loc),
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
        if (totalPreview != null) ...<Widget>[
          const SizedBox(height: 12),
          totalPreview,
        ],
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
