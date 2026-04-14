import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../l10n/string_lookup.dart';
import '../data/models/picker_inventory_models.dart';
import 'inventory_barcode_resolve_extra.dart';
import 'inventory_barcode_resolve_routing.dart';
import 'inventory_providers.dart';

InventoryByBarcodeResponse _byBarcodeFromPickerItem(PickerInventoryItem it) {
  final List<InventoryByBarcodeLocation> locs = it.topLocations
      .take(3)
      .map(
        (PickerLotInfo l) => InventoryByBarcodeLocation(
          locationCode: l.locationCode,
          availableQty: l.availableQty,
        ),
      )
      .toList(growable: false);
  return InventoryByBarcodeResponse(
    productId: it.productId,
    name: it.name,
    barcode: it.mainBarcode,
    brand: null,
    bestLocations: locs,
    totalAvailable: it.availableQty,
  );
}

class InventoryBarcodeResolveScreen extends ConsumerStatefulWidget {
  const InventoryBarcodeResolveScreen({super.key, required this.extra});

  final InventoryBarcodeResolveExtra extra;

  @override
  ConsumerState<InventoryBarcodeResolveScreen> createState() =>
      _InventoryBarcodeResolveScreenState();
}

class _InventoryBarcodeResolveScreenState extends ConsumerState<InventoryBarcodeResolveScreen> {
  bool _started = false;

  void _returnToScanner() {
    if (context.canPop()) {
      context.pop();
      return;
    }
    context.goNamed('scanner', extra: widget.extra.args);
  }

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
      final InventoryByBarcodeResponse product =
          await ref.read(inventoryRepositoryProvider).getInventoryByBarcode(barcode);
      if (!mounted) {
        return;
      }
      routeAfterInventoryBarcodeLookup(router, product, widget.extra.args);
    } on Object catch (e) {
      if (!mounted) {
        return;
      }
      final String msg = '$e';
      final bool notFound = msg.contains('404') ||
          msg.toLowerCase().contains('product not found') ||
          msg.toLowerCase().contains('not found');
      if (notFound) {
        try {
          final PickerInventoryListResponse pick =
              await ref.read(inventoryRepositoryProvider).listPickerInventory(
                    q: barcode.trim(),
                    limit: 20,
                  );
          if (!mounted) {
            return;
          }
          if (pick.items.length == 1) {
            routeAfterInventoryBarcodeLookup(
              router,
              _byBarcodeFromPickerItem(pick.items.first),
              widget.extra.args,
            );
            return;
          }
        } on Object {
          // fall through to error UI
        }
      }
      HapticFeedback.heavyImpact();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      _returnToScanner();
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: _returnToScanner,
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
