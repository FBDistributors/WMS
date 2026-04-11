import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/app_state/theme_controller.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/widgets/consolidated_pick_content.dart';
import '../../../shared/widgets/consolidated_pick_success_snackbar.dart';
import '../picking_providers.dart';

class ConsolidatedPickScreen extends ConsumerStatefulWidget {
  const ConsolidatedPickScreen({super.key});

  @override
  ConsumerState<ConsolidatedPickScreen> createState() => _ConsolidatedPickScreenState();
}

class _ConsolidatedPickScreenState extends ConsumerState<ConsolidatedPickScreen> {
  final TextEditingController _barcode = TextEditingController();
  final TextEditingController _qty = TextEditingController(text: '1');
  bool _busy = false;
  bool _prefilledFromRoute = false;
  int _consolidatedListRefreshKey = 0;

  @override
  void dispose() {
    _barcode.dispose();
    _qty.dispose();
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
    final String b = _barcode.text.trim();
    final int q = int.tryParse(_qty.text.trim()) ?? 1;
    if (b.isEmpty) {
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(pickingRepositoryProvider).consolidatedPick(barcode: b, qty: q);
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
            padding: const EdgeInsets.all(12),
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
                SizedBox(
                  width: 72,
                  child: TextField(
                    controller: _qty,
                    keyboardType: TextInputType.number,
                    inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                    decoration: InputDecoration(
                      labelText: StringLookup.t(loc, 'qtyShort'),
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
