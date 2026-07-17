import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/router/scanner_args.dart';
import '../../../l10n/string_lookup.dart';
import '../../../core/errors/api_error_localization.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../../shared/input/stock_quantity_input.dart';
import '../../../shared/widgets/scan_action_button.dart';
import '../data/product_box_models.dart';
import '../product_box_providers.dart';

class RegisterProductBoxSheet extends ConsumerStatefulWidget {
  const RegisterProductBoxSheet({
    super.key,
    required this.productId,
    required this.productName,
    this.initialBarcode,
    this.onSaved,
  });

  final String productId;
  final String productName;
  final String? initialBarcode;
  final void Function(int unitsPerBox)? onSaved;

  @override
  ConsumerState<RegisterProductBoxSheet> createState() => _RegisterProductBoxSheetState();
}

class _RegisterProductBoxSheetState extends ConsumerState<RegisterProductBoxSheet> {
  late final TextEditingController _barcode;
  final TextEditingController _units = TextEditingController();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _barcode = TextEditingController(text: widget.initialBarcode ?? '');
  }

  @override
  void dispose() {
    _barcode.dispose();
    _units.dispose();
    super.dispose();
  }

  Future<void> _scanBarcode() async {
    final String? code = await context.pushNamed<String>(
      'scanner',
      extra: const ScannerArgs(returnRawBarcode: true),
    );
    if (!mounted || code == null || code.trim().isEmpty) {
      return;
    }
    setState(() => _barcode.text = code.trim());
  }

  Future<void> _save() async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final String code = _barcode.text.trim();
    final int units = int.tryParse(_units.text.trim()) ?? 0;
    if (code.isEmpty || units < 1) {
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'kirimNewReceiveFillAll'))),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await ref.read(productBoxRepositoryProvider).create(
            ProductBoxCreate(
              boxBarcode: code,
              productId: widget.productId,
              unitsPerBox: units,
            ),
          );
      widget.onSaved?.call(units);
      if (mounted) {
        Navigator.of(context).pop();
      }
    } on Exception catch (e) {
      if (!mounted) {
        return;
      }
      final String msg = '$e';
      final String text = msg.contains('already exists')
          ? StringLookup.t(loc, 'inventoryBoxAlreadyExists')
          : localizeApiErrorMessage(loc, e);
      showAppSnackBar(context, SnackBar(content: Text(text)));
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            StringLookup.t(loc, 'inventoryAddBox'),
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
          ),
          const SizedBox(height: 6),
          Text(
            widget.productName,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: context.colors.textSecondary),
          ),
          const SizedBox(height: 16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: TextField(
                  controller: _barcode,
                  decoration: InputDecoration(
                    labelText: StringLookup.t(loc, 'inventoryBoxBarcode'),
                    border: const OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              ScanActionButton(
                compact: true,
                label: StringLookup.t(loc, 'inventoryScanBox'),
                onPressed: _saving ? null : _scanBarcode,
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _units,
            keyboardType: kStockQtyKeyboardType,
            inputFormatters: kStockQtyInputFormatters,
            decoration: InputDecoration(
              labelText: StringLookup.t(loc, 'inventoryBoxUnitsPerBox'),
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : Text(StringLookup.t(loc, 'inventoryBoxSave')),
          ),
        ],
      ),
    );
  }
}
