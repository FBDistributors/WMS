import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import '../../../core/errors/api_error_localization.dart';
import '../../../core/theme/app_colors.dart';
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
import '../../../shared/layout/sheet_bottom_inset.dart';
import '../../../shared/widgets/scan_action_button.dart';
import '../../product_boxes/data/box_location_models.dart';
import '../../product_boxes/data/product_box_models.dart';
import '../../product_boxes/data/product_box_repository.dart';
import '../../product_boxes/presentation/register_product_box_sheet.dart';
import '../../product_boxes/product_box_providers.dart';

/// Inventarizatsiya: dona qoldiqni quti shtrix-kodi bilan joylash (tasdiqlash bilan).
class InventoryPackBoxPanel extends ConsumerStatefulWidget {
  const InventoryPackBoxPanel({
    super.key,
    required this.productId,
    required this.productName,
    required this.locationId,
    required this.lotId,
    this.locationCode,
    this.expiryDate,
    this.onPlaced,
  });

  final String productId;
  final String productName;
  final String locationId;
  final String lotId;
  final String? locationCode;
  final String? expiryDate;
  final void Function(BoxLocationBreakdown breakdown)? onPlaced;

  @override
  ConsumerState<InventoryPackBoxPanel> createState() => _InventoryPackBoxPanelState();
}

class _InventoryPackBoxPanelState extends ConsumerState<InventoryPackBoxPanel> {
  final TextEditingController _boxBarcode = TextEditingController();
  final TextEditingController _boxCount = TextEditingController(text: '1');
  String? _resolvedBarcode;
  int? _unitsPerBox;
  BoxLocationBreakdown? _breakdown;
  bool _loadingBreakdown = true;
  bool _placing = false;
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
          _breakdownError = localizeApiErrorMessage(ref.read(appLocaleProvider), e);
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

  Future<void> _openRegisterSheet(String barcode) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) {
        return Padding(
          padding: EdgeInsets.only(bottom: sheetBottomPadding(context)),
          child: RegisterProductBoxSheet(
            productId: widget.productId,
            productName: widget.productName,
            initialBarcode: barcode,
            onSaved: (int units) {
              if (!mounted) {
                return;
              }
              setState(() {
                _unitsPerBox = units;
                _resolvedBarcode = barcode.trim();
                _boxBarcode.text = barcode.trim();
              });
              showAppSnackBar(
                context,
                SnackBar(content: Text(StringLookup.t(loc, 'inventoryBoxSaved'))),
              );
            },
          ),
        );
      },
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
      await _openRegisterSheet(barcode);
    } on Exception catch (e) {
      showAppLocalizedError(context, loc, e);
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
            onPressed: _placing ? null : () => unawaited(_confirmBarcodeManual()),
            constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
            padding: EdgeInsets.zero,
            splashRadius: 20,
            icon: Icon(Icons.check, color: context.colors.accentFg),
          ),
        buildInputClearButton(
          visible: true,
          onPressed: () {
            if (_placing) {
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

  Future<void> _place() async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final String barcode = (_resolvedBarcode ?? _boxBarcode.text).trim();
    final int boxCount = int.tryParse(_boxCount.text.trim()) ?? 0;
    final int? upb = _unitsPerBox;

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

    final int needed = upb * boxCount;
    final int loose = _breakdown?.looseUnits ?? 0;
    if (loose < needed) {
      showAppSnackBar(
        context,
        SnackBar(
          content: Text(
            StringLookup.tParams(
              loc,
              'inventoryInsufficientLoose',
              <String, String>{
                'needed': '$needed',
                'available': '$loose',
              },
            ),
          ),
        ),
      );
      return;
    }

    setState(() => _placing = true);
    try {
      final BoxLocationBreakdown result =
          await ref.read(boxLocationRepositoryProvider).placeBox(
                boxBarcode: barcode,
                locationId: widget.locationId,
                lotId: widget.lotId,
                boxCount: boxCount,
              );
      if (!mounted) {
        return;
      }
      setState(() {
        _breakdown = result;
        _boxBarcode.clear();
        _resolvedBarcode = null;
        _unitsPerBox = null;
        _boxCount.text = '1';
      });
      showAppTopSuccess(context, StringLookup.t(loc, 'inventoryPackPlaced'));
      widget.onPlaced?.call(result);
    } on Exception catch (e) {
      if (mounted) {
        showAppLocalizedError(context, loc, e);
      }
    } finally {
      if (mounted) {
        setState(() => _placing = false);
      }
    }
  }

  Widget _valueRow(String label, String value, {bool emphasize = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: RichText(
        text: TextSpan(
          style: TextStyle(fontSize: 14, color: context.colors.textMain),
          children: <InlineSpan>[
            TextSpan(text: '$label: ', style: const TextStyle(fontWeight: FontWeight.w600)),
            TextSpan(
              text: value,
              style: TextStyle(
                fontWeight: emphasize ? FontWeight.w700 : FontWeight.w500,
                color: emphasize ? context.colors.accentFg : context.colors.textMain,
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
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: context.colors.link,
            ),
          ),
        ],
        if (widget.expiryDate != null && widget.expiryDate!.trim().isNotEmpty) ...<Widget>[
          const SizedBox(height: 4),
          Text(
            formatExpiryMonthYear(widget.expiryDate),
            style: TextStyle(fontSize: 13, color: context.colors.textSecondary),
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
              color: context.colors.textSecondary,
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
                enabled: !_placing,
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
              onPressed: _placing ? null : () => unawaited(_scanBox()),
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
              color: upb != null ? null : context.colors.textFaded,
            ),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _boxCount,
          enabled: !_placing,
          keyboardType: kStockQtyKeyboardType,
          inputFormatters: kStockQtyInputFormatters,
          decoration: InputDecoration(
            labelText: StringLookup.t(loc, 'inventoryBoxCount'),
            border: const OutlineInputBorder(),
            suffixIcon: buildInputClearButton(
              visible: _boxCount.text.trim().isNotEmpty && _boxCount.text.trim() != '1',
              onPressed: () {
                if (_placing) {
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
          onPressed: _placing || (b != null && b.looseUnits < 1) ? null : () => unawaited(_place()),
          child: _placing
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : Text(StringLookup.t(loc, 'inventoryPackPlace')),
        ),
      ],
    );
  }
}
