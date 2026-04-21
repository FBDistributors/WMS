import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/app_state/theme_controller.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../../shared/widgets/consolidated_pick_content.dart';
import '../../../shared/widgets/consolidated_top_pick_qty_sheet.dart';
import '../data/picking_models.dart';
import '../picking_providers.dart';

class ConsolidatedPickScreen extends ConsumerStatefulWidget {
  const ConsolidatedPickScreen({super.key});

  @override
  ConsumerState<ConsolidatedPickScreen> createState() => _ConsolidatedPickScreenState();
}

class _ConsolidatedPickScreenState extends ConsumerState<ConsolidatedPickScreen> {
  final TextEditingController _barcode = TextEditingController();
  bool _prefilledFromRoute = false;
  int _consolidatedListRefreshKey = 0;

  @override
  void dispose() {
    _barcode.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_prefilledFromRoute) {
      return;
    }
    final String? b = GoRouterState.of(context).uri.queryParameters['barcode'];
    if (b != null && b.isNotEmpty) {
      _prefilledFromRoute = true;
      _barcode.text = b;
    }
  }

  Future<void> _pick() async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final String b = _barcode.text.trim();
    if (b.isEmpty) {
      return;
    }
    AsyncValue<ConsolidatedViewResponse> view = ref.read(consolidatedViewProvider);
    if (!view.hasValue) {
      await ref.read(consolidatedViewProvider.notifier).refreshFromNetwork();
      view = ref.read(consolidatedViewProvider);
    }
    if (!view.hasValue) {
      if (mounted) {
        showAppSnackBar(
          context,
          SnackBar(content: Text(StringLookup.t(loc, 'loading'))),
        );
      }
      return;
    }
    final int? openQty = consolidatedOpenPickQtyForBarcode(b, view.requireValue.products);
    if (openQty == null) {
      if (mounted) {
        showAppSnackBar(
          context,
          SnackBar(content: Text(StringLookup.t(loc, 'productNotInOrder'))),
        );
      }
      return;
    }
    if (openQty < 1) {
      if (mounted) {
        showAppSnackBar(
          context,
          SnackBar(content: Text(StringLookup.t(loc, 'consolidatedNothingToPick'))),
        );
      }
      return;
    }
    final ConsolidatedProduct? product =
        consolidatedProductForBarcode(b, view.requireValue.products);
    if (product == null) {
      if (mounted) {
        showAppSnackBar(
          context,
          SnackBar(content: Text(StringLookup.t(loc, 'productNotInOrder'))),
        );
      }
      return;
    }
    if (!mounted) {
      return;
    }
    await showConsolidatedTopPickQtySheet(
      context: context,
      ref: ref,
      loc: loc,
      product: product,
      pickBarcode: b,
      onSuccess: () {
        if (!mounted) {
          return;
        }
        setState(() => _consolidatedListRefreshKey++);
        _barcode.clear();
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final bool isDark = ref.watch(appThemeModeProvider) == ThemeMode.dark;

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : const Color(0xFFF5F5F5),
      appBar: AppBar(
        title: Text(StringLookup.t(loc, 'consolidatedPickTitle')),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop()),
      ),
      body: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: TextField(
                    controller: _barcode,
                    decoration: InputDecoration(
                      labelText: StringLookup.t(loc, 'barcodeOrSku'),
                      border: const OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(onPressed: _pick, child: Text(StringLookup.t(loc, 'submit'))),
              ],
            ),
          ),
          Expanded(
            child: ConsolidatedPickContent(
              refreshVersion: _consolidatedListRefreshKey,
              onAfterSuccessfulPick: () {
                if (mounted) {
                  setState(() => _consolidatedListRefreshKey++);
                }
              },
            ),
          ),
        ],
      ),
    );
  }
}
