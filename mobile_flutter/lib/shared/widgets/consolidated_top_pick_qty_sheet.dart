import 'dart:async' show unawaited;
import 'dart:math' show max;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_state/app_locale.dart';
import '../../features/picking/data/picking_models.dart';
import '../../features/picking/picking_providers.dart';
import '../../features/scanner/data/scanner_repository.dart';
import '../../features/scanner/scanner_providers.dart';
import '../../l10n/string_lookup.dart';
import '../feedback/app_top_snackbar.dart';
import '../layout/sheet_bottom_inset.dart';
import 'consolidated_pick_success_snackbar.dart';
import 'pick_box_qty_fields.dart';

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
  late final TextEditingController _qty;
  late final TextEditingController _boxCount;
  String _pickQtyMode = 'byUnit';
  int? _unitsPerBox;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final double rem = widget.product.totalRequired - widget.product.totalPicked;
    final int maxPick = max(0, rem.round());
    _qty = TextEditingController(text: '${max(1, maxPick)}');
    _boxCount = TextEditingController(text: '1');
    unawaited(_resolveBoxScan());
  }

  Future<void> _resolveBoxScan() async {
    try {
      final ScannerResolveOut out =
          await ref.read(scannerRepositoryProvider).resolveBarcode(widget.pickBarcode);
      if (!mounted) {
        return;
      }
      if (out.isBoxScan && out.unitsPerScan != null) {
        final double rem = widget.product.totalRequired - widget.product.totalPicked;
        setState(() {
          _pickQtyMode = 'byBox';
          _unitsPerBox = out.unitsPerScan;
          _qty.text = '${out.unitsPerScan}';
          if (rem < out.unitsPerScan!) {
            _qty.text = '${rem.round()}';
          }
        });
      }
    } on Object {
      /* offline */
    }
  }

  @override
  void dispose() {
    _qty.dispose();
    _boxCount.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    final double rem = widget.product.totalRequired - widget.product.totalPicked;
    final int maxPick = max(0, rem.round());
    final int q = pickQtyFromBoxMode(
      mode: _pickQtyMode,
      unitQty: _qty,
      boxCount: _boxCount,
      unitsPerBox: _unitsPerBox,
      maxUnits: rem,
    );
    if (q < 1 || q > maxPick) {
      if (widget.host.mounted) {
        showAppSnackBar(
          widget.host,
          SnackBar(
            content: Text(
              StringLookup.tParams(
                widget.loc,
                'qtyRangeError',
                <String, String>{'max': '$maxPick'},
              ),
            ),
          ),
        );
      }
      return;
    }
    setState(() => _busy = true);
    try {
      await widget.ref.read(pickingRepositoryProvider).consolidatedPick(
            barcode: widget.pickBarcode.trim(),
            qty: q,
            requestId: 'consolidated-${DateTime.now().millisecondsSinceEpoch}',
            boxCount: pickBoxCountForSubmit(
              mode: _pickQtyMode,
              boxCount: _boxCount,
              unitsPerBox: _unitsPerBox,
            ),
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
    } on Exception catch (e) {
      if (widget.host.mounted) {
        showAppSnackBar(
          widget.host,
          SnackBar(content: Text('$e')),
        );
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
    int? primaryLoose;
    for (final PickingAlternateLocation a in product.alternateLocations) {
      if (a.isPrimary) {
        primaryLoose = a.looseUnits;
        break;
      }
    }
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
            PickBoxQtyFields(
              loc: loc,
              mode: _pickQtyMode,
              onModeChanged: (String m) => setState(() => _pickQtyMode = m),
              unitQty: _qty,
              boxCount: _boxCount,
              unitsPerBox: _unitsPerBox,
              maxUnits: rem,
              looseUnits: primaryLoose,
              onFieldsChanged: () => setState(() {}),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : _confirm,
              child: Text(StringLookup.t(loc, 'confirmButton')),
            ),
          ],
        ),
      ),
    );
  }
}
