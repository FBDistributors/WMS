import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/app_state/network_status_provider.dart';
import '../../../core/formatting/expiry_display_format.dart';
import '../../../core/router/scanner_args.dart';
import '../../../l10n/string_lookup.dart';
import '../../inventory/data/models/picker_inventory_models.dart';
import '../../inventory/presentation/inventory_providers.dart';
import '../../../shared/input/input_clear_button.dart';
import '../../../shared/input/stock_quantity_input.dart';
import '../../../shared/widgets/barcode_search_input.dart';
import '../../../shared/widgets/product_card.dart';
import '../../../shared/widgets/scan_action_button.dart';
import '../data/movements_repository.dart';
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
  final TextEditingController _locationSearchCtrl = TextEditingController();
  String _locationSearch = '';
  final TextEditingController _palletDestCtrl = TextEditingController();
  String _palletDestSearch = '';
  bool _submitting = false;
  String? _productSubmitKey;

  LocationContentsResponse? _palletContents;
  bool _palletLoading = false;
  String? _palletError;
  final TextEditingController _palletCode = TextEditingController();
  PickerLocationOption? _palletTo;
  bool _palletSubmitting = false;
  String? _palletSubmitKey;
  bool _palletFullTransfer = true;
  final Map<String, bool> _palletSelected = <String, bool>{};
  final Map<String, String> _palletSelectedQty = <String, String>{};

  bool _handledRouteScan = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
      if (online) {
        _loadLocations();
      }
    });
  }

  @override
  void dispose() {
    _qty.dispose();
    _locationSearchCtrl.dispose();
    _palletDestCtrl.dispose();
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
      _locationSearch = '';
      _locationSearchCtrl.clear();
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
    final String normalized = code.trim();
    if (normalized.isEmpty) {
      return;
    }
    setState(() {
      _palletLoading = true;
      _palletError = null;
      _palletContents = null;
      _palletTo = null;
      _palletFullTransfer = true;
      _palletSelected.clear();
      _palletSelectedQty.clear();
      _palletDestSearch = '';
      _palletDestCtrl.clear();
    });
    try {
      final LocationContentsResponse res =
          await ref.read(inventoryRepositoryProvider).getLocationContents(normalized);
      if (mounted) {
        final Map<String, bool> selected = <String, bool>{};
        final Map<String, String> qtyByKey = <String, String>{};
        for (final LocationContentsItem item in res.items) {
          final String key = _palletItemKey(item);
          selected[key] = true;
          qtyByKey[key] = item.availableQty.floor().toString();
        }
        setState(() {
          _palletContents = res;
          _palletCode.text = res.locationCode;
          _palletSelected
            ..clear()
            ..addAll(selected);
          _palletSelectedQty
            ..clear()
            ..addAll(qtyByKey);
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
      final AppLocale loc = ref.read(appLocaleProvider);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(StringLookup.t(loc, 'movementQtyOrLocationInvalid'))),
      );
      return;
    }
    setState(() => _submitting = true);
    try {
      final repo = ref.read(movementsRepositoryProvider);
      final String baseKey = _productSubmitKey ?? const Uuid().v4();
      _productSubmitKey = baseKey;
      await repo.createStockMovement(
        productId: p.productId,
        lotId: from.lotId,
        locationId: from.locationId,
        qtyChange: -n.toDouble(),
        reasonCode: 'inventory_shortage',
        idempotencyKey: '$baseKey-out',
      );
      await repo.createStockMovement(
        productId: p.productId,
        lotId: from.lotId,
        locationId: to.id,
        qtyChange: n.toDouble(),
        reasonCode: 'inventory_overage',
        idempotencyKey: '$baseKey-in',
      );
      if (mounted) {
        final AppLocale loc = ref.read(appLocaleProvider);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(StringLookup.t(loc, 'movementTransferred'))),
        );
        setState(() {
          _phase = _MovementPhase.choose;
          _product = null;
          _fromLocation = null;
          _toLocation = null;
          _qty.clear();
          _locationSearch = '';
          _locationSearchCtrl.clear();
          _productSubmitKey = null;
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
    final List<TransferLocationLineInput> lines = <TransferLocationLineInput>[];
    if (!_palletFullTransfer) {
      for (final LocationContentsItem item in c.items) {
        final String key = _palletItemKey(item);
        final bool isSelected = _palletSelected[key] ?? false;
        if (!isSelected) {
          continue;
        }
        final int qty = int.tryParse((_palletSelectedQty[key] ?? '').trim()) ?? 0;
        final int max = item.availableQty.floor();
        if (qty < 1 || qty > max) {
          final AppLocale loc = ref.read(appLocaleProvider);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(StringLookup.t(loc, 'movementPalletQtyInvalid'))),
          );
          return;
        }
        lines.add(
          TransferLocationLineInput(
            productId: item.productId,
            lotId: item.lotId,
            qty: qty,
          ),
        );
      }
      if (lines.isEmpty) {
        final AppLocale loc = ref.read(appLocaleProvider);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(StringLookup.t(loc, 'movementPalletSelectAtLeastOne'))),
        );
        return;
      }
    }
    setState(() => _palletSubmitting = true);
    try {
      final String requestKey = _palletSubmitKey ?? const Uuid().v4();
      _palletSubmitKey = requestKey;
      await ref.read(movementsRepositoryProvider).transferLocationStock(
            fromLocationId: c.locationId,
            toLocationId: to.id,
            fullTransfer: _palletFullTransfer,
            lines: lines,
            idempotencyKey: requestKey,
          );
      if (mounted) {
        final AppLocale loc = ref.read(appLocaleProvider);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(StringLookup.t(loc, 'movementPalletTransferred'))),
        );
        setState(() {
          _phase = _MovementPhase.choose;
          _palletContents = null;
          _palletTo = null;
          _palletCode.clear();
          _palletFullTransfer = true;
          _palletSelected.clear();
          _palletSelectedQty.clear();
          _palletDestSearch = '';
          _palletDestCtrl.clear();
          _palletSubmitKey = null;
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
      if (context.canPop()) {
        context.pop();
      } else {
        context.goNamed('kirim');
      }
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
        _locationSearch = '';
        _locationSearchCtrl.clear();
      });
      return;
    }
    setState(() {
      _phase = _MovementPhase.choose;
      _palletContents = null;
      _palletError = null;
      _palletTo = null;
      _palletCode.clear();
      _palletDestSearch = '';
      _palletDestCtrl.clear();
    });
  }

  List<PickerLocationOption> _filterLocations(
    String q, {
    int cap = 40,
    bool showAllWhenEmpty = false,
  }) {
    final String s = q.trim().toLowerCase();
    if (s.isEmpty) {
      return showAllWhenEmpty ? _allLocations.take(cap).toList() : <PickerLocationOption>[];
    }
    return _allLocations
        .where(
          (PickerLocationOption l) =>
              l.code.toLowerCase().contains(s) || l.name.toLowerCase().contains(s),
        )
        .take(cap)
        .toList();
  }

  String _palletItemKey(LocationContentsItem item) => '${item.productId}|${item.lotId}';

  String _palletItemMeta(LocationContentsItem item) {
    final List<String> parts = <String>[];
    final String? barcode = item.barcode?.trim();
    if (barcode != null && barcode.isNotEmpty) {
      parts.add(barcode);
    }
    final String sku = item.productCode.trim();
    if (sku.isNotEmpty) {
      parts.add(sku);
    }
    if (item.expiryDate != null && item.expiryDate!.trim().isNotEmpty) {
      parts.add(formatExpiryMonthYear(item.expiryDate));
    }
    parts.add('${StringLookup.t(ref.read(appLocaleProvider), 'movementPalletStock')}: ${item.availableQty.floor()}');
    return parts.join(' • ');
  }

  void _setPalletTransferMode(bool full) {
    final LocationContentsResponse? c = _palletContents;
    final Map<String, bool> selected = <String, bool>{};
    final Map<String, String> qtyByKey = <String, String>{};
    if (c != null) {
      for (final LocationContentsItem item in c.items) {
        final String key = _palletItemKey(item);
        selected[key] = true;
        qtyByKey[key] = item.availableQty.floor().toString();
      }
    }
    setState(() {
      _palletFullTransfer = full;
      if (!full) {
        _palletSelected
          ..clear()
          ..addAll(selected);
        _palletSelectedQty
          ..clear()
          ..addAll(qtyByKey);
      }
    });
  }

  void _clearPalletSourceInput() {
    setState(() {
      _palletCode.clear();
      _palletContents = null;
      _palletError = null;
      _palletLoading = false;
      _palletTo = null;
      _palletFullTransfer = true;
      _palletSelected.clear();
      _palletSelectedQty.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final bool online = ref.watch(networkOnlineProvider).valueOrNull ?? true;
    ref.listen<AsyncValue<bool>>(networkOnlineProvider, (AsyncValue<bool>? prev, AsyncValue<bool> next) {
      final bool wasOnline = prev?.valueOrNull ?? true;
      final bool nowOnline = next.valueOrNull ?? true;
      if (!wasOnline && nowOnline && mounted) {
        _loadLocations();
      }
    });

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
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                StringLookup.t(loc, 'movementOfflineLimited'),
                style: const TextStyle(color: Colors.orange),
              ),
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
                subtitle: Text(StringLookup.t(loc, 'movementSubtitleScanOrBarcode')),
                onTap: () => setState(() => _phase = _MovementPhase.scanProduct),
              ),
            ),
            Card(
              child: ListTile(
                leading: const Icon(Icons.grid_view),
                title: Text(StringLookup.t(loc, 'movementPalletMode')),
                subtitle: Text(StringLookup.t(loc, 'movementSubtitleScanLocationCode')),
                onTap: () => setState(() => _phase = _MovementPhase.pallet),
              ),
            ),
          ],
          if (_phase == _MovementPhase.scanProduct) ...<Widget>[
            if (_product == null) ...<Widget>[
              BarcodeSearchInput(
                onSelectProduct: _loadProduct,
                label: StringLookup.t(loc, 'barcodeOrSku'),
                onProductScanPressed: () => context.pushNamed(
                  'scanner',
                  extra: const ScannerArgs(returnToMovement: true),
                ),
                showClearButton: true,
              ),
              if (_productError != null) Text(_productError!, style: const TextStyle(color: Colors.red)),
            ] else ...<Widget>[
              ProductCard(
                title: _product!.name,
                subtitle: _product!.code,
                barcode: _product!.mainBarcode,
              ),
              const SizedBox(height: 12),
              Text(StringLookup.t(loc, 'movementFrom'),
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              if (_product!.locations.isEmpty)
                Text(StringLookup.t(loc, 'movementNoStock'))
              else
                ..._product!.locations.map((PickerProductLocation pl) {
                  final bool sel = _fromLocation?.lotId == pl.lotId &&
                      _fromLocation?.locationId == pl.locationId;
                  return Card(
                    color: sel ? Colors.green.shade50 : null,
                    child: ListTile(
                      title: Text(pl.locationCode),
                      subtitle: Text(
                        StringLookup.tParams(loc, 'movementAvailableInLot', <String, String>{
                          'qty': pl.availableQty.toStringAsFixed(0),
                          'expiry': formatExpiryMonthYear(pl.expiryDate),
                        }),
                      ),
                      trailing: sel
                          ? Icon(Icons.check_circle, color: Colors.green.shade700)
                          : null,
                      onTap: () => setState(() => _fromLocation = pl),
                    ),
                  );
                }),
              const SizedBox(height: 12),
              Text(StringLookup.t(loc, 'movementTo'),
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              TextField(
                controller: _locationSearchCtrl,
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  labelText: StringLookup.t(loc, 'movementLocationSearchLabel'),
                  border: const OutlineInputBorder(),
                  suffixIcon: buildInputClearButton(
                    visible: _locationSearchCtrl.text.trim().isNotEmpty,
                    onPressed: () => setState(() {
                      _locationSearchCtrl.clear();
                      _locationSearch = '';
                      _toLocation = null;
                    }),
                  ),
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
                  onTap: () {
                    FocusManager.instance.primaryFocus?.unfocus();
                    setState(() {
                      _toLocation = o;
                      _locationSearch = o.code;
                      _locationSearchCtrl.text = o.code;
                    });
                  },
                );
              }),
              const SizedBox(height: 8),
              TextField(
                controller: _qty,
                keyboardType: kStockQtyKeyboardType,
                inputFormatters: kStockQtyInputFormatters,
                decoration: InputDecoration(
                  labelText: StringLookup.t(loc, 'qtyShort'),
                  border: const OutlineInputBorder(),
                  suffixIcon: buildInputClearButton(
                    visible: _qty.text.trim().isNotEmpty,
                    onPressed: () => setState(() => _qty.clear()),
                  ),
                ),
                onChanged: (_) => setState(() {}),
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
                    : Text(StringLookup.t(loc, 'movementTransfer')),
              ),
            ],
          ],
          if (_phase == _MovementPhase.pallet) ...<Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                Expanded(
                  child: TextField(
                    controller: _palletCode,
                    textInputAction: TextInputAction.search,
                    decoration: InputDecoration(
                      labelText: StringLookup.t(loc, 'movementLocationCodeLabel'),
                      border: const OutlineInputBorder(),
                      suffixIcon: buildInputClearButton(
                        visible: _palletCode.text.trim().isNotEmpty,
                        onPressed: _clearPalletSourceInput,
                      ),
                    ),
                    onChanged: (_) => setState(() {}),
                    onSubmitted: (_) => _loadPallet(_palletCode.text),
                  ),
                ),
                const SizedBox(width: 8),
                ScanActionButton(
                  onPressed: () => context.pushNamed(
                    'scanner',
                    extra: const ScannerArgs(returnToMovementPallet: true),
                  ),
                  compact: true,
                ),
              ],
            ),
            if (_palletCode.text.trim().isNotEmpty) ...<Widget>[
              const SizedBox(height: 8),
              ..._filterLocations(_palletCode.text, cap: 12).map((PickerLocationOption o) {
                return ListTile(
                  title: Text(o.code),
                  subtitle: Text(o.name),
                  onTap: () {
                    FocusManager.instance.primaryFocus?.unfocus();
                    setState(() => _palletCode.text = o.code);
                    _loadPallet(o.code);
                  },
                );
              }),
            ],
            FilledButton(
              onPressed: _palletLoading ? null : () => _loadPallet(_palletCode.text),
              child: Text(StringLookup.t(loc, 'movementLoad')),
            ),
            if (_palletLoading) const LinearProgressIndicator(),
            if (_palletError != null) Text(_palletError!, style: const TextStyle(color: Colors.red)),
            if (_palletContents != null) ...<Widget>[
              Text(
                StringLookup.tParams(loc, 'movementPalletHeader', <String, String>{
                  'code': _palletContents!.locationCode,
                  'count': '${_palletContents!.items.length}',
                }),
              ),
              const SizedBox(height: 8),
              SegmentedButton<bool>(
                segments: <ButtonSegment<bool>>[
                  ButtonSegment<bool>(
                    value: true,
                    label: Text(StringLookup.t(loc, 'movementPalletModeFull')),
                  ),
                  ButtonSegment<bool>(
                    value: false,
                    label: Text(StringLookup.t(loc, 'movementPalletModePartial')),
                  ),
                ],
                selected: <bool>{_palletFullTransfer},
                onSelectionChanged: (Set<bool> s) {
                  _setPalletTransferMode(s.first);
                },
              ),
              const SizedBox(height: 8),
              ..._palletContents!.items.map((LocationContentsItem item) {
                final String key = _palletItemKey(item);
                final bool selected = _palletSelected[key] ?? false;
                final int max = item.availableQty.floor();
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        if (!_palletFullTransfer)
                          CheckboxListTile(
                            value: selected,
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            controlAffinity: ListTileControlAffinity.leading,
                            title: Text(item.productName),
                            subtitle: Text(_palletItemMeta(item)),
                            onChanged: (bool? v) {
                              setState(() {
                                _palletSelected[key] = v ?? false;
                                _palletSelectedQty.putIfAbsent(
                                  key,
                                  () => max.toString(),
                                );
                              });
                            },
                          )
                        else ...<Widget>[
                          Text(item.productName, style: const TextStyle(fontWeight: FontWeight.w600)),
                          const SizedBox(height: 4),
                          Text(_palletItemMeta(item)),
                        ],
                        if (!_palletFullTransfer && selected) ...<Widget>[
                          const SizedBox(height: 8),
                          TextFormField(
                            key: ValueKey<String>('pallet-qty-$key'),
                            initialValue: _palletSelectedQty[key] ?? max.toString(),
                            keyboardType: kStockQtyKeyboardType,
                            inputFormatters: kStockQtyInputFormatters,
                            decoration: InputDecoration(
                              labelText: StringLookup.t(loc, 'qtyShort'),
                              helperText:
                                  '${StringLookup.t(loc, 'movementPalletQtyMax')}: $max',
                              border: const OutlineInputBorder(),
                            ),
                            onChanged: (String v) {
                              _palletSelectedQty[key] = v;
                            },
                          ),
                        ],
                      ],
                    ),
                  ),
                );
              }),
              TextField(
                controller: _palletDestCtrl,
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  labelText: StringLookup.t(loc, 'movementDestSearchLabel'),
                  border: const OutlineInputBorder(),
                  suffixIcon: buildInputClearButton(
                    visible: _palletDestCtrl.text.trim().isNotEmpty,
                    onPressed: () => setState(() {
                      _palletDestCtrl.clear();
                      _palletDestSearch = '';
                      _palletTo = null;
                    }),
                  ),
                ),
                onChanged: (String v) => setState(() => _palletDestSearch = v),
              ),
              ..._filterLocations(_palletDestSearch, cap: 30).map((PickerLocationOption o) {
                final bool sel = _palletTo?.id == o.id;
                return ListTile(
                  title: Text(o.code),
                  tileColor: sel ? Colors.green.shade50 : null,
                  onTap: () {
                    FocusManager.instance.primaryFocus?.unfocus();
                    setState(() {
                      _palletTo = o;
                      _palletDestSearch = o.code;
                      _palletDestCtrl.text = o.code;
                    });
                  },
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
                    : Text(StringLookup.t(loc, 'movementTransferPallet')),
              ),
            ],
          ],
        ],
      ),
    );
  }
}
