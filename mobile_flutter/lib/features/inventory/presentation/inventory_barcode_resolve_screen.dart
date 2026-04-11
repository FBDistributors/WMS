import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../l10n/string_lookup.dart';
import 'inventory_barcode_resolve_extra.dart';
import 'inventory_barcode_resolve_routing.dart';
import 'inventory_providers.dart';

class InventoryBarcodeResolveScreen extends ConsumerStatefulWidget {
  const InventoryBarcodeResolveScreen({super.key, required this.extra});

  final InventoryBarcodeResolveExtra extra;

  @override
  ConsumerState<InventoryBarcodeResolveScreen> createState() =>
      _InventoryBarcodeResolveScreenState();
}

class _InventoryBarcodeResolveScreenState extends ConsumerState<InventoryBarcodeResolveScreen> {
  bool _started = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _resolve());
  }

  Future<void> _resolve() async {
    if (_started) {
      return;
    }
    _started = true;
    final String barcode = widget.extra.barcode;
    final GoRouter router = GoRouter.of(context);
    try {
      final product =
          await ref.read(inventoryRepositoryProvider).getInventoryByBarcode(barcode);
      if (!mounted) {
        return;
      }
      routeAfterInventoryBarcodeLookup(router, product, widget.extra.args);
    } on Object catch (e) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      router.goNamed('scanner', extra: widget.extra.args);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () {
            context.goNamed('scanner', extra: widget.extra.args);
          },
        ),
        title: Text(StringLookup.t(loc, 'loading')),
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Text(
                StringLookup.t(loc, 'loading'),
                textAlign: TextAlign.center,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
