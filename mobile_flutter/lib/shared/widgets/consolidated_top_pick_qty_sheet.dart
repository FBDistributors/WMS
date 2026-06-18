import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_state/app_locale.dart';
import '../../features/picking/data/picking_models.dart';
import '../../features/picking/picking_providers.dart';
import '../../features/scanner/scanner_providers.dart';
import '../../l10n/string_lookup.dart';
import '../feedback/app_top_snackbar.dart';
import '../layout/sheet_bottom_inset.dart';
import 'consolidated_pick_success_snackbar.dart';
import 'pick_box_qty_fields.dart';
import 'pick_hybrid_submit.dart';

Future<void> showConsolidatedTopPickQtySheet({
  required BuildContext context,
  required WidgetRef ref,
  required AppLocale loc,
  required ConsolidatedProduct product,
  required String pickBarcode,
  VoidCallback? onSuccess,
}) async {
  final BuildContext host = context;
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (BuildContext sheetContext) => _ConsolidatedTopPickQtySheet(
      host: host,
      ref: ref,
      loc: loc,
      product: product,
      pickBarcode: pickBarcode,
      onSuccess: onSuccess,
    ),
  );
}

class _ConsolidatedTopPickQtySheet extends ConsumerStatefulWidget {
  const _ConsolidatedTopPickQtySheet({
    required this.host,
    required this.ref,
    required this.loc,
    required this.product,
    required this.pickBarcode,
    this.onSuccess,
  });

  final BuildContext host;
  final WidgetRef ref;
  final AppLocale loc;
  final ConsolidatedProduct product;
  final String pickBarcode;
  final VoidCallback? onSuccess;

  @override
  ConsumerState<_ConsolidatedTopPickQtySheet> createState() =>
      _ConsolidatedTopPickQtySheetState();
}

class _ConsolidatedTopPickQtySheetState extends ConsumerState<_ConsolidatedTopPickQtySheet> {
  late final TextEditingController _boxCount;
  late final TextEditingController _looseQty;
  late final TextEditingController _boxBarcode;
  late final TextEditingController _productBarcode;
  int? _unitsPerBox;
  bool _busy = false;

  ({int? looseUnits, int? boxCount}) _locationAltHint() {
    final List<ConsolidatedLineItem> openPickLines = widget.product.lines
        .where((ConsolidatedLineItem l) => l.qtyPicked < l.qtyRequired)
        .toList();
    final String pickLocationCode =
        openPickLines.isNotEmpty ? openPickLines.first.locationCode : '';
    return alternateBoxHintForLocation(
      widget.product.alternateLocations,
      pickLocationCode,
    );
  }

  @override
  void initState() {
    super.initState();
    final double rem = widget.product.totalRequired - widget.product.totalPicked;
    final ({int? looseUnits, int? boxCount}) locationAltHint = _locationAltHint();
    _unitsPerBox = unitsPerBoxFromAlternateLocations(widget.product.alternateLocations);
    _boxCount = TextEditingController();
    _looseQty = TextEditingController();
    _boxBarcode = TextEditingController();
    _productBarcode = TextEditingController();
    applyConsolidatedHybridQtyDefaults(
      boxCount: _boxCount,
      looseQty: _looseQty,
      unitsPerBox: _unitsPerBox,
      maxUnits: rem,
      lines: widget.product.lines,
      suggestedBoxCount: widget.product.suggestedBoxCount,
      suggestedLooseQty: widget.product.suggestedLooseQty,
      stockBoxCount: locationAltHint.boxCount,
      stockLooseUnits: locationAltHint.looseUnits,
    );
    unawaited(_applyInitialScan());
  }

  Future<void> _applyInitialScan() async {
    final String raw = widget.pickBarcode.trim();
    if (raw.isEmpty) {
      return;
    }
    try {
      final double rem = widget.product.totalRequired - widget.product.totalPicked;
      final HybridScanApplyResult scanRes = await applyHybridProductScan(
        scanner: ref.read(scannerRepositoryProvider),
        raw: raw,
        boxCount: _boxCount,
        looseQty: _looseQty,
        boxBarcode: _boxBarcode,
        productBarcode: _productBarcode,
        unitsPerBox: _unitsPerBox,
        maxUnits: rem,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        if (scanRes.unitsPerBox != null) {
          _unitsPerBox = scanRes.unitsPerBox;
        }
      });
      if (mounted) {
        final double rem = widget.product.totalRequired - widget.product.totalPicked;
        final ({int? looseUnits, int? boxCount}) locationAltHint = _locationAltHint();
        applyConsolidatedHybridQtyDefaults(
          boxCount: _boxCount,
          looseQty: _looseQty,
          unitsPerBox: _unitsPerBox,
          maxUnits: rem,
          lines: widget.product.lines,
          suggestedBoxCount: widget.product.suggestedBoxCount,
          suggestedLooseQty: widget.product.suggestedLooseQty,
          stockBoxCount: locationAltHint.boxCount,
          stockLooseUnits: locationAltHint.looseUnits,
        );
      }
    } on Object {
      if (mounted) {
        setState(() => _productBarcode.text = raw);
      }
    }
  }

  @override
  void dispose() {
    _boxCount.dispose();
    _looseQty.dispose();
    _boxBarcode.dispose();
    _productBarcode.dispose();
    super.dispose();
  }

  PickHybridQty _currentHybrid(double rem) => pickHybridQtyFromControllers(
        boxCount: _boxCount,
        looseQty: _looseQty,
        unitsPerBox: _unitsPerBox,
        maxUnits: rem,
      );

  Future<void> _scanBox() async {
    final String? code = await launchHybridRawBarcodeScan(context);
    if (!mounted || code == null) {
      return;
    }
    final double rem = widget.product.totalRequired - widget.product.totalPicked;
    final HybridScanApplyResult result = await applyHybridBoxScan(
      scanner: widget.ref.read(scannerRepositoryProvider),
      raw: code,
      boxCount: _boxCount,
      looseQty: _looseQty,
      boxBarcode: _boxBarcode,
      unitsPerBox: _unitsPerBox,
      maxUnits: rem,
    );
    if (!mounted) {
      return;
    }
    setState(() {
      if (result.unitsPerBox != null) {
        _unitsPerBox = result.unitsPerBox;
      }
    });
  }

  Future<void> _scanProduct() async {
    final String? code = await launchHybridRawBarcodeScan(context);
    if (!mounted || code == null) {
      return;
    }
    final double rem = widget.product.totalRequired - widget.product.totalPicked;
    final HybridScanApplyResult result = await applyHybridProductScan(
      scanner: widget.ref.read(scannerRepositoryProvider),
      raw: code,
      boxCount: _boxCount,
      looseQty: _looseQty,
      boxBarcode: _boxBarcode,
      productBarcode: _productBarcode,
      unitsPerBox: _unitsPerBox,
      maxUnits: rem,
    );
    if (!mounted) {
      return;
    }
    setState(() {
      if (result.unitsPerBox != null) {
        _unitsPerBox = result.unitsPerBox;
      }
    });
  }

  Future<void> _confirm() async {
    final double rem = widget.product.totalRequired - widget.product.totalPicked;
    final PickHybridQty hybrid = _currentHybrid(rem);
    final String? validation = hybridPickValidationMessage(
      loc: widget.loc,
      hybrid: hybrid,
      boxBarcode: _boxBarcode.text,
      productBarcode: _productBarcode.text,
      maxUnits: rem,
    );
    if (validation != null) {
      if (widget.host.mounted) {
        showAppSnackBar(widget.host, SnackBar(content: Text(validation)));
      }
      return;
    }
    setState(() => _busy = true);
    try {
      await submitHybridPick(
        hybrid: hybrid,
        boxBarcode: _boxBarcode.text,
        productBarcode: _productBarcode.text,
        pickBox: ({
          required int qty,
          required int boxCount,
          required String barcode,
        }) async {
          await widget.ref.read(pickingRepositoryProvider).consolidatedPick(
                barcode: barcode,
                qty: qty,
                requestId: 'consolidated-${DateTime.now().millisecondsSinceEpoch}',
                boxCount: boxCount,
              );
        },
        pickUnit: ({required int qty, required String barcode}) async {
          await widget.ref.read(pickingRepositoryProvider).consolidatedPick(
                barcode: barcode,
                qty: qty,
                requestId: 'consolidated-${DateTime.now().millisecondsSinceEpoch}',
              );
        },
        pickCombined: ({
          required int totalQty,
          required int boxCount,
          required String productBarcode,
          required String boxBarcode,
        }) async {
          await widget.ref.read(pickingRepositoryProvider).consolidatedPick(
                barcode: productBarcode,
                qty: totalQty,
                requestId: 'consolidated-${DateTime.now().millisecondsSinceEpoch}',
                boxCount: boxCount,
                boxBarcode: boxBarcode,
              );
        },
      );
      await widget.ref.read(consolidatedViewProvider.notifier).refreshFromNetwork();
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop();
      if (widget.host.mounted) {
        showConsolidatedPickSuccessSnackBar(widget.host, widget.loc);
      }
      widget.onSuccess?.call();
    } on HybridPickPartialFailure catch (e) {
      if (widget.host.mounted) {
        showAppSnackBar(
          widget.host,
          SnackBar(
            content: Text(
              StringLookup.tParams(
                widget.loc,
                'pickHybridPartialProgress',
                <String, String>{
                  'picked': '${e.boxUnitsPicked}',
                  'total': '${hybrid.total}',
                },
              ),
            ),
          ),
        );
      }
      await widget.ref.read(consolidatedViewProvider.notifier).refreshFromNetwork();
    } on Exception catch (e) {
      if (widget.host.mounted) {
        showAppSnackBar(widget.host, SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final ConsolidatedProduct product = widget.product;
    final AppLocale loc = widget.loc;
    final double rem = product.totalRequired - product.totalPicked;
    final ({int? looseUnits, int? boxCount}) locationAltHint = _locationAltHint();
    return Padding(
      padding: EdgeInsets.only(bottom: sheetBottomPadding(context)),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Text(
                    product.productName,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close_rounded),
                  onPressed: _busy ? null : () => Navigator.of(context).pop(),
                ),
              ],
            ),
            Text(
              '${product.barcode ?? '—'} / ${product.sku ?? '—'}',
              style: TextStyle(
                fontSize: 13,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
                fontFamily: 'monospace',
              ),
            ),
            const SizedBox(height: 16),
            Text(
              StringLookup.tParams(
                loc,
                'quantityRemainingLine',
                <String, String>{'n': formatPickQty(rem)},
              ),
              style: TextStyle(
                fontSize: 14,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 12),
            ConsolidatedPickPlanBanner(
              loc: loc,
              product: product,
              unitsPerBox: _unitsPerBox,
            ),
            PickHybridQtyFields(
              loc: loc,
              boxCount: _boxCount,
              looseQty: _looseQty,
              unitsPerBox: _unitsPerBox,
              maxUnits: rem,
              looseUnits: locationAltHint.looseUnits,
              stockBoxCount: locationAltHint.boxCount,
              onFieldsChanged: () => setState(() {}),
              boxBarcode: _boxBarcode,
              productBarcode: _productBarcode,
              busy: _busy,
              onBoxBarcodeChanged: () => setState(() {
                if (_boxBarcode.text.trim().isEmpty) {
                  _unitsPerBox = unitsPerBoxFromAlternateLocations(
                    product.alternateLocations,
                  );
                  _boxCount.text = '0';
                }
              }),
              onProductBarcodeChanged: () => setState(() {}),
              onBoxBarcodeSubmitted: (String code) async {
                final HybridScanApplyResult result = await applyHybridBoxScan(
                  scanner: widget.ref.read(scannerRepositoryProvider),
                  raw: code,
                  boxCount: _boxCount,
                  looseQty: _looseQty,
                  boxBarcode: _boxBarcode,
                  unitsPerBox: _unitsPerBox,
                  maxUnits: rem,
                );
                if (!mounted) {
                  return;
                }
                setState(() {
                  if (result.unitsPerBox != null) {
                    _unitsPerBox = result.unitsPerBox;
                  }
                });
              },
              onProductBarcodeSubmitted: (String code) async {
                final HybridScanApplyResult result = await applyHybridProductScan(
                  scanner: widget.ref.read(scannerRepositoryProvider),
                  raw: code,
                  boxCount: _boxCount,
                  looseQty: _looseQty,
                  boxBarcode: _boxBarcode,
                  productBarcode: _productBarcode,
                  unitsPerBox: _unitsPerBox,
                  maxUnits: rem,
                );
                if (!mounted) {
                  return;
                }
                setState(() {
                  if (result.unitsPerBox != null) {
                    _unitsPerBox = result.unitsPerBox;
                  }
                });
              },
              onScanBox: () => unawaited(_scanBox()),
              onScanProduct: () => unawaited(_scanProduct()),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : () => unawaited(_confirm()),
              child: Text(StringLookup.t(loc, 'confirmButton')),
            ),
          ],
        ),
      ),
    );
  }
}
