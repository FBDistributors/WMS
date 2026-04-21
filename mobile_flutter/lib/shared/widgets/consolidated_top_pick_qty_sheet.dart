import 'dart:math' show max;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_state/app_locale.dart';
import '../../features/picking/data/picking_models.dart';
import '../../features/picking/picking_providers.dart';
import '../../l10n/string_lookup.dart';
import '../feedback/app_top_snackbar.dart';
import '../input/stock_quantity_input.dart';
import '../layout/sheet_bottom_inset.dart';
import 'consolidated_pick_success_snackbar.dart';

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

class _ConsolidatedTopPickQtySheet extends StatefulWidget {
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
  State<_ConsolidatedTopPickQtySheet> createState() => _ConsolidatedTopPickQtySheetState();
}

class _ConsolidatedTopPickQtySheetState extends State<_ConsolidatedTopPickQtySheet> {
  late final TextEditingController _qty;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final double rem = widget.product.totalRequired - widget.product.totalPicked;
    final int maxPick = max(0, rem.round());
    _qty = TextEditingController(text: '${max(1, maxPick)}');
  }

  @override
  void dispose() {
    _qty.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    final int q = int.tryParse(_qty.text.trim()) ?? 0;
    final double rem = widget.product.totalRequired - widget.product.totalPicked;
    final int maxPick = max(0, rem.round());
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
            TextField(
              controller: _qty,
              keyboardType: kStockQtyKeyboardType,
              inputFormatters: kStockQtyInputFormatters,
              decoration: InputDecoration(
                labelText: StringLookup.t(loc, 'qtyShort'),
                border: const OutlineInputBorder(),
              ),
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
