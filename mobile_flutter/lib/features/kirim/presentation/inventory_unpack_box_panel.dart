import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/formatting/expiry_display_format.dart';
import '../../../core/router/scanner_args.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../../shared/input/input_clear_button.dart';
import '../../../shared/input/stock_quantity_input.dart';
import '../../../shared/widgets/scan_action_button.dart';
import '../../product_boxes/data/box_location_models.dart';
import '../../product_boxes/data/product_box_models.dart';
import '../../product_boxes/data/product_box_repository.dart';
import '../../product_boxes/product_box_providers.dart';

int _sealedCountForBarcode(BoxLocationBreakdown breakdown, String barcode) {
  final String normalized = barcode.trim();
  if (normalized.isEmpty) {
    return 0;
  }
  return breakdown.sealedBoxes
      .where((SealedBoxInfo s) => s.boxBarcode.trim() == normalized)
      .length;
}

/// Inventarizatsiya: sealed qutini qutisiz qoldiqka chiqarish.
class InventoryUnpackBoxPanel extends ConsumerStatefulWidget {
  const InventoryUnpackBoxPanel({
    super.key,
    required this.productId,
    required this.productName,
    required this.locationId,
    required this.lotId,
    this.locationCode,
    this.expiryDate,
    this.onRemoved,
  });

  final String productId;
  final String productName;
  final String locationId;
  final String lotId;
  final String? locationCode;
  final String? expiryDate;
  final void Function(BoxLocationBreakdown breakdown)? onRemoved;

  @override
  ConsumerState<InventoryUnpackBoxPanel> createState() =>
      _InventoryUnpackBoxPanelState();
}

class _InventoryUnpackBoxPanelState extends ConsumerState<InventoryUnpackBoxPanel> {
  final TextEditingController _boxBarcode = TextEditingController();
  final TextEditingController _boxCount = TextEditingController(text: '1');
  String? _resolvedBarcode;
  int? _unitsPerBox;
  BoxLocationBreakdown? _breakdown;
  bool _loadingBreakdown = true;
  bool _removing = false;
  String? _breakdownError;

  @override
  void initState() {
    super.initState();
    unawaited(_loadBreakdown());
  }

  @override
  void dispose() {
    _boxBarcode.dispose();
    _boxCount.dispose();
    super.dispose();
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
      if (mounted) {
        setState(() {
          _breakdown = b;
          _loadingBreakdown = false;
        });
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
        showAppSnackBar(
          context,
          SnackBar(content: Text(StringLookup.t(loc, 'inventoryBoxProductMismatch'))),
        );
        return;
      }
      setState(() {
        _resolvedBarcode = barcode;
        _unitsPerBox = resolved.unitsPerBox;
        _boxBarcode.text = barcode;
      });
    } on ProductBoxNotFoundException {
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'inventoryBoxNotFound'))),
      );
    } on Exception catch (e) {
      showAppSnackBar(context, SnackBar(content: Text('$e')));
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
            onPressed: _removing ? null : () => unawaited(_confirmBarcodeManual()),
            constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
            padding: EdgeInsets.zero,
            splashRadius: 20,
            icon: const Icon(Icons.check, color: Color(0xFF1A237E)),
          ),
        buildInputClearButton(
          visible: true,
          onPressed: () {
            if (_removing) {
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

  Future<void> _remove() async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final String barcode = (_resolvedBarcode ?? _boxBarcode.text).trim();
    final int boxCount = int.tryParse(_boxCount.text.trim()) ?? 0;
    final int? upb = _unitsPerBox;
    final BoxLocationBreakdown? b = _breakdown;

    if (barcode.isEmpty || upb == null || upb < 1 || boxCount < 1) {
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'kirimNewReceiveFillAll'))),
      );
      return;
    }
    if (_resolvedBarcode == null || _resolvedBarcode != barcode) {
      await _resolveBarcode(barcode);
      if (_resolvedBarcode == null) {
        return;
      }
    }
    if (b == null) {
      return;
    }

    final int available = _sealedCountForBarcode(b, barcode);
    if (available < boxCount) {
      showAppSnackBar(
        context,
        SnackBar(
          content: Text(
            StringLookup.tParams(
              loc,
              'inventoryInsufficientSealed',
              <String, String>{
                'needed': '$boxCount',
                'available': '$available',
              },
            ),
          ),
        ),
      );
      return;
    }

    setState(() => _removing = true);
    BoxLocationBreakdown? result;
    int removed = 0;
    try {
      final boxLocationRepo = ref.read(boxLocationRepositoryProvider);
      for (int i = 0; i < boxCount; i++) {
        result = await boxLocationRepo.removeBox(
          boxBarcode: barcode,
          locationId: widget.locationId,
          lotId: widget.lotId,
        );
        removed++;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        if (result != null) {
          _breakdown = result;
        }
        _boxBarcode.clear();
        _resolvedBarcode = null;
        _unitsPerBox = null;
        _boxCount.text = '1';
      });
      showAppTopSuccess(context, StringLookup.t(loc, 'inventoryUnpackRemoved'));
      if (result != null) {
        widget.onRemoved?.call(result);
      }
    } on Exception catch (e) {
      if (mounted) {
        if (removed > 0) {
          await _loadBreakdown();
          showAppSnackBar(
            context,
            SnackBar(
              content: Text(
                StringLookup.tParams(
                  loc,
                  'inventoryUnpackPartial',
                  <String, String>{
                    'removed': '$removed',
                    'total': '$boxCount',
                  },
                ),
              ),
            ),
          );
          if (result != null) {
            widget.onRemoved?.call(result);
          }
        } else {
          showAppSnackBar(context, SnackBar(content: Text('$e')));
        }
      }
    } finally {
      if (mounted) {
        setState(() => _removing = false);
      }
    }
  }

  Widget _valueRow(String label, String value, {bool emphasize = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: RichText(
        text: TextSpan(
          style: TextStyle(fontSize: 14, color: Colors.grey.shade800),
          children: <InlineSpan>[
            TextSpan(text: '$label: ', style: const TextStyle(fontWeight: FontWeight.w600)),
            TextSpan(
              text: value,
              style: TextStyle(
                fontWeight: emphasize ? FontWeight.w700 : FontWeight.w500,
                color: emphasize ? const Color(0xFF1A237E) : Colors.grey.shade900,
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final int boxCount = int.tryParse(_boxCount.text.trim()) ?? 0;
    final int? upb = _unitsPerBox;
    final int? totalUnits = upb != null && boxCount > 0 ? upb * boxCount : null;
    final BoxLocationBreakdown? b = _breakdown;
    final String resolved = (_resolvedBarcode ?? _boxBarcode.text).trim();
    final int sealedForBarcode =
        b != null && resolved.isNotEmpty ? _sealedCountForBarcode(b, resolved) : 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          widget.productName,
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
        ),
        if (widget.locationCode != null && widget.locationCode!.trim().isNotEmpty) ...<Widget>[
          const SizedBox(height: 4),
          Text(
            widget.locationCode!,
            style: const TextStyle(
              fontWeight: FontWeight.w600,
              color: Color(0xFF1565C0),
            ),
          ),
        ],
        if (widget.expiryDate != null && widget.expiryDate!.trim().isNotEmpty) ...<Widget>[
          const SizedBox(height: 4),
          Text(
            formatExpiryMonthYear(widget.expiryDate),
            style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
          ),
        ],
        const SizedBox(height: 12),
        if (_loadingBreakdown)
          const LinearProgressIndicator()
        else if (_breakdownError != null)
          Text(_breakdownError!, style: const TextStyle(color: Colors.red))
        else if (b != null) ...<Widget>[
          Text(
            StringLookup.t(loc, 'inventoryLocationStockComputed'),
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: Colors.grey.shade700,
            ),
          ),
          const SizedBox(height: 4),
          _valueRow(StringLookup.t(loc, 'inventoryLocationFullBoxes'), '${b.boxCount}'),
          _valueRow(StringLookup.t(loc, 'inventoryUnitsInBoxes'), '${b.unitsInBoxes}'),
          if (b.looseUnits > 0)
            _valueRow(StringLookup.t(loc, 'inventoryLooseStock'), '${b.looseUnits}'),
          _valueRow(
            StringLookup.t(loc, 'inventoryLocationTotalUnits'),
            '${b.totalUnits}',
            emphasize: true,
          ),
        ],
        const SizedBox(height: 16),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: TextField(
                controller: _boxBarcode,
                enabled: !_removing,
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
              onPressed: _removing ? null : () => unawaited(_scanBox()),
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
          enabled: !_removing,
          keyboardType: kStockQtyKeyboardType,
          inputFormatters: kStockQtyInputFormatters,
          decoration: InputDecoration(
            labelText: StringLookup.t(loc, 'inventoryBoxCount'),
            border: const OutlineInputBorder(),
            suffixIcon: buildInputClearButton(
              visible: _boxCount.text.trim().isNotEmpty && _boxCount.text.trim() != '1',
              onPressed: () {
                if (_removing) {
                  return;
                }
                setState(() => _boxCount.text = '1');
              },
            ),
          ),
          onChanged: (_) => setState(() {}),
        ),
        if (totalUnits != null) ...<Widget>[
          const SizedBox(height: 8),
          Text(
            StringLookup.tParams(
              loc,
              'kirimNewTotalUnits',
              <String, String>{'total': '$totalUnits'},
            ),
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        ],
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _removing || (b != null && b.boxCount < 1)
              ? null
              : () => unawaited(_remove()),
          child: _removing
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : Text(StringLookup.t(loc, 'inventoryUnpackRemove')),
        ),
        if (resolved.isNotEmpty && sealedForBarcode > 0) ...<Widget>[
          const SizedBox(height: 8),
          Text(
            StringLookup.tParams(
              loc,
              'inventorySealedAvailableForBarcode',
              <String, String>{'count': '$sealedForBarcode'},
            ),
            style: TextStyle(fontSize: 12, color: Colors.grey.shade700),
          ),
        ],
      ],
    );
  }
}
