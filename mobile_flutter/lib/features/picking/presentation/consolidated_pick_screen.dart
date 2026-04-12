import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/app_state/theme_controller.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/widgets/consolidated_pick_content.dart';
import '../../../shared/widgets/consolidated_pick_success_snackbar.dart';
import '../data/picking_models.dart';
import '../picking_providers.dart';

class ConsolidatedPickScreen extends ConsumerStatefulWidget {
  const ConsolidatedPickScreen({super.key});

  @override
  ConsumerState<ConsolidatedPickScreen> createState() => _ConsolidatedPickScreenState();
}

class _ConsolidatedPickScreenState extends ConsumerState<ConsolidatedPickScreen> {
  final TextEditingController _barcode = TextEditingController();
  bool _busy = false;
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(StringLookup.t(loc, 'loading'))),
        );
      }
      return;
    }
    final int? openQty = consolidatedOpenPickQtyForBarcode(b, view.requireValue.products);
    if (openQty == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(StringLookup.t(loc, 'productNotInOrder'))),
        );
      }
      return;
    }
    if (openQty < 1) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(StringLookup.t(loc, 'consolidatedNothingToPick'))),
        );
      }
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(pickingRepositoryProvider).consolidatedPick(barcode: b, qty: openQty);
      await ref.read(consolidatedViewProvider.notifier).refreshFromNetwork();
      if (mounted) {
        setState(() => _consolidatedListRefreshKey++);
        showConsolidatedPickSuccessSnackBar(
          context,
          ref.read(appLocaleProvider),
        );
      }
      _barcode.clear();
    } on Exception catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
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
                FilledButton(onPressed: _busy ? null : _pick, child: Text(StringLookup.t(loc, 'submit'))),
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
