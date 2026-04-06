import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/app_state/network_status_provider.dart';
import '../../../core/router/scanner_args.dart';
import '../../../l10n/string_lookup.dart';
import '../../inventory/data/models/picker_inventory_models.dart';
import '../../inventory/presentation/inventory_providers.dart';
import '../../../shared/widgets/barcode_search_input.dart';
import '../../../shared/widgets/product_card.dart';
import '../movements_providers.dart';

enum _MovementPhase { choose, scanProduct, pallet }

/// RN `MovementScreen` — mahsulot yoki palet ko‘chirish.
class MovementScreen extends ConsumerStatefulWidget {
  const MovementScreen({super.key});

  @override
  ConsumerState<MovementScreen> createState() => _MovementScreenState();
}

class _MovementScreenState extends ConsumerState<MovementScreen> {
  _MovementPhase _phase = _MovementPhase.choose;
  PickerProductDetailResponse? _product;
  bool _loadingProduct = false;
  String? _productError;
  List<PickerLocationOption> _allLocations = const <PickerLocationOption>[];
  PickerProductLocation? _fromLocation;
  PickerLocationOption? _toLocation;
  final TextEditingController _qty = TextEditingController();
  String _locationSearch = '';
  String _palletDestSearch = '';
  bool _submitting = false;

  LocationContentsResponse? _palletContents;
  bool _palletLoading = false;
  String? _palletError;
  final TextEditingController _palletCode = TextEditingController();
  PickerLocationOption? _palletTo;
  bool _palletSubmitting = false;

  bool _handledRouteScan = false;

  @override
  void dispose() {
    _qty.dispose();
    _palletCode.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_handledRouteScan) {
      return;
    }
    final Uri u = GoRouterState.of(context).uri;
    final String? pid = u.queryParameters['scannedProductId'];
    final String? loc = u.queryParameters['scannedLocationCode'];
    if (pid != null && pid.isNotEmpty) {
      _handledRouteScan = true;
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadProduct(pid));
      setState(() => _phase = _MovementPhase.scanProduct);
    } else if (loc != null && loc.isNotEmpty) {
      _handledRouteScan = true;
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadPallet(loc));
      setState(() => _phase = _MovementPhase.pallet);
    }
  }

  Future<void> _loadLocations() async {
    try {
      final List<PickerLocationOption> list =
          await ref.read(inventoryRepositoryProvider).listPickerLocations();
      if (mounted) {
        setState(() => _allLocations = list);
      }
    } on Exception {
      if (mounted) {
        setState(() => _allLocations = const <PickerLocationOption>[]);
      }
    }
  }

  Future<void> _loadProduct(String productId) async {
    setState(() {
      _loadingProduct = true;
      _productError = null;
      _product = null;
      _fromLocation = null;
      _toLocation = null;
      _qty.clear();
    });
    try {
      final PickerProductDetailResponse res =
          await ref.read(inventoryRepositoryProvider).getPickerProductDetail(productId);
      if (mounted) {
        setState(() {
          _product = res;
          _loadingProduct = false;
        });
      }
    } on Exception catch (e) {
      if (mounted) {
        setState(() {
          _productError = '$e';
          _loadingProduct = false;
        });
      }
    }
  }

  Future<void> _loadPallet(String code) async {
    setState(() {
      _palletLoading = true;
      _palletError = null;
      _palletContents = null;
      _palletTo = null;
    });
    try {
      final LocationContentsResponse res =
          await ref.read(inventoryRepositoryProvider).getLocationContents(code);
      if (mounted) {
        setState(() {
          _palletContents = res;
          _palletCode.text = res.locationCode;
          _palletLoading = false;
        });
      }
    } on Exception catch (e) {
      if (mounted) {
        setState(() {
          _palletError = '$e';
          _palletLoading = false;
        });
      }
    }
  }

  Future<void> _submitProductMove() async {
    final PickerProductDetailResponse? p = _product;
    final PickerProductLocation? from = _fromLocation;
    final PickerLocationOption? to = _toLocation;
    if (p == null || from == null || to == null) {
      return;
    }
    final int n = int.tryParse(_qty.text.trim()) ?? 0;
    final int max = from.availableQty.floor();
    if (n < 1 || n > max || from.locationId == to.id) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Miqdor yoki lokatsiyani tekshiring')),
      );
      return;
    }
    setState(() => _submitting = true);
    try {
      final repo = ref.read(movementsRepositoryProvider);
      await repo.createStockMovement(
        productId: p.productId,
        lotId: from.lotId,
        locationId: from.locationId,
        qtyChange: -n.toDouble(),
        reasonCode: 'inventory_shortage',
      );
      await repo.createStockMovement(
        productId: p.productId,
        lotId: from.lotId,
        locationId: to.id,
        qtyChange: n.toDouble(),
        reasonCode: 'inventory_overage',
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Ko‘chirildi')));
        setState(() {
          _phase = _MovementPhase.choose;
          _product = null;
          _fromLocation = null;
          _toLocation = null;
          _qty.clear();
        });
      }
    } on Exception catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  Future<void> _submitPallet() async {
    final LocationContentsResponse? c = _palletContents;
    final PickerLocationOption? to = _palletTo;
    if (c == null || to == null || c.items.isEmpty || c.locationId == to.id) {
      return;
    }
    setState(() => _palletSubmitting = true);
    try {
      await ref.read(movementsRepositoryProvider).transferLocationStock(
            fromLocationId: c.locationId,
            toLocationId: to.id,
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Palet ko‘chirildi')));
        setState(() {
          _phase = _MovementPhase.choose;
          _palletContents = null;
          _palletTo = null;
          _palletCode.clear();
        });
      }
    } on Exception catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) {
        setState(() => _palletSubmitting = false);
      }
    }
  }

  void _headerBack() {
    if (_phase == _MovementPhase.choose) {
      context.pop();
      return;
    }
    if (_phase == _MovementPhase.scanProduct) {
      setState(() {
        _phase = _MovementPhase.choose;
        _product = null;
        _fromLocation = null;
        _toLocation = null;
        _qty.clear();
        _productError = null;
      });
      return;
    }
    setState(() {
      _phase = _MovementPhase.choose;
      _palletContents = null;
      _palletError = null;
      _palletTo = null;
      _palletCode.clear();
    });
  }

  List<PickerLocationOption> _filterLocations(String q, {int cap = 40}) {
    final String s = q.trim().toLowerCase();
    if (s.isEmpty) {
      return _allLocations.take(cap).toList();
    }
    return _allLocations
        .where(
          (PickerLocationOption l) =>
              l.code.toLowerCase().contains(s) || l.name.toLowerCase().contains(s),
        )
        .take(cap)
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final bool online = ref.watch(networkOnlineProvider).valueOrNull ?? true;
    if (_allLocations.isEmpty && online) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadLocations());
    }

    if (_loadingProduct && _phase == _MovementPhase.scanProduct) {
      return Scaffold(
        appBar: AppBar(
          title: Text(StringLookup.t(loc, 'movementTitle')),
          leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: _headerBack),
        ),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(StringLookup.t(loc, 'movementTitle')),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: _headerBack),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          if (!online)
            const Padding(
              padding: EdgeInsets.only(bottom: 12),
              child: Text('Offline — ko‘chirish cheklangan', style: TextStyle(color: Colors.orange)),
            ),
          if (_phase == _MovementPhase.choose) ...<Widget>[
            Text(
              StringLookup.t(loc, 'movementTitle'),
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 12),
            Card(
              child: ListTile(
                leading: const Icon(Icons.qr_code_scanner),
                title: Text(StringLookup.t(loc, 'movementProductMode')),
                subtitle: const Text('Skaner yoki barcode'),
                onTap: () => setState(() => _phase = _MovementPhase.scanProduct),
              ),
            ),
            Card(
              child: ListTile(
                leading: const Icon(Icons.grid_view),
                title: Text(StringLookup.t(loc, 'movementPalletMode')),
                subtitle: const Text('Lokatsiya kodini skanerlang'),
                onTap: () => setState(() => _phase = _MovementPhase.pallet),
              ),
            ),
          ],
          if (_phase == _MovementPhase.scanProduct) ...<Widget>[
            if (_product == null) ...<Widget>[
              BarcodeSearchInput(
                onSelectProduct: _loadProduct,
                label: 'Barcode',
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: () => context.pushNamed(
                  'scanner',
                  extra: const ScannerArgs(returnToMovement: true),
                ),
                icon: const Icon(Icons.camera_alt),
                label: const Text('Skaner'),
              ),
              if (_productError != null) Text(_productError!, style: const TextStyle(color: Colors.red)),
            ] else ...<Widget>[
              ProductCard(
                title: _product!.name,
                subtitle: _product!.code,
                barcode: _product!.mainBarcode,
              ),
              const SizedBox(height: 12),
              const Text('Qayerdan', style: TextStyle(fontWeight: FontWeight.w600)),
              if (_product!.locations.isEmpty)
                const Text('Zaxira yo‘q')
              else
                ..._product!.locations.map((PickerProductLocation loc) {
                  final bool sel = _fromLocation?.lotId == loc.lotId &&
                      _fromLocation?.locationId == loc.locationId;
                  return Card(
                    color: sel ? Colors.blue.shade50 : null,
                    child: ListTile(
                      title: Text(loc.locationCode),
                      subtitle: Text(
                        'Mavjud: ${loc.availableQty.toStringAsFixed(0)} · ${loc.batchNo}',
                      ),
                      onTap: () => setState(() => _fromLocation = loc),
                    ),
                  );
                }),
              const SizedBox(height: 12),
              const Text('Qayerga', style: TextStyle(fontWeight: FontWeight.w600)),
              TextField(
                decoration: const InputDecoration(
                  labelText: 'Lokatsiya qidiruv',
                  border: OutlineInputBorder(),
                ),
                onChanged: (String v) => setState(() => _locationSearch = v),
              ),
              const SizedBox(height: 8),
              ..._filterLocations(_locationSearch).map((PickerLocationOption o) {
                final bool sel = _toLocation?.id == o.id;
                return ListTile(
                  title: Text(o.code),
                  subtitle: Text(o.name),
                  tileColor: sel ? Colors.green.shade50 : null,
                  onTap: () => setState(() => _toLocation = o),
                );
              }),
              const SizedBox(height: 8),
              TextField(
                controller: _qty,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Miqdor',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _submitting ? null : _submitProductMove,
                child: _submitting
                    ? const SizedBox(
                        height: 22,
                        width: 22,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('Ko‘chirish'),
              ),
            ],
          ],
          if (_phase == _MovementPhase.pallet) ...<Widget>[
            TextField(
              controller: _palletCode,
              decoration: const InputDecoration(
                labelText: 'Lokatsiya kodi',
                border: OutlineInputBorder(),
              ),
              onSubmitted: (_) => _loadPallet(_palletCode.text),
            ),
            FilledButton(
              onPressed: _palletLoading ? null : () => _loadPallet(_palletCode.text),
              child: const Text('Yuklash'),
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: () => context.pushNamed(
                'scanner',
                extra: const ScannerArgs(returnToMovementPallet: true),
              ),
              icon: const Icon(Icons.camera_alt),
              label: const Text('Skaner (lokatsiya)'),
            ),
            if (_palletLoading) const LinearProgressIndicator(),
            if (_palletError != null) Text(_palletError!, style: const TextStyle(color: Colors.red)),
            if (_palletContents != null) ...<Widget>[
              Text('${_palletContents!.locationCode} · ${_palletContents!.items.length} qator'),
              TextField(
                decoration: const InputDecoration(
                  labelText: 'Manzil qidiruv',
                  border: OutlineInputBorder(),
                ),
                onChanged: (String v) => setState(() => _palletDestSearch = v),
              ),
              ..._filterLocations(_palletDestSearch, cap: 30).map((PickerLocationOption o) {
                final bool sel = _palletTo?.id == o.id;
                return ListTile(
                  title: Text(o.code),
                  tileColor: sel ? Colors.green.shade50 : null,
                  onTap: () => setState(() => _palletTo = o),
                );
              }),
              FilledButton(
                onPressed: _palletSubmitting ? null : _submitPallet,
                child: _palletSubmitting
                    ? const SizedBox(
                        height: 22,
                        width: 22,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('Paletni ko‘chirish'),
              ),
            ],
          ],
        ],
      ),
    );
  }
}
