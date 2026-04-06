import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../core/router/scanner_args.dart';
import '../../customer_returns/data/customer_returns_models.dart';
import '../../customer_returns/customer_returns_providers.dart';
import '../../inventory/data/models/picker_inventory_models.dart';
import '../../inventory/presentation/inventory_providers.dart';
import '../../receiving/data/receiving_models.dart';
import '../../receiving/receiving_providers.dart';
import '../../../shared/widgets/barcode_search_input.dart';
import '../../../shared/widgets/expiry_date_picker.dart';
import '../../../shared/widgets/product_card.dart';

List<PickerProductLocation> _sortFefo(List<PickerProductLocation> locs) {
  final List<PickerProductLocation> copy = List<PickerProductLocation>.from(locs);
  copy.sort((PickerProductLocation a, PickerProductLocation b) {
    final int expA = a.expiryDate != null
        ? DateTime.tryParse(a.expiryDate!)?.millisecondsSinceEpoch ?? 1 << 62
        : 1 << 62;
    final int expB = b.expiryDate != null
        ? DateTime.tryParse(b.expiryDate!)?.millisecondsSinceEpoch ?? 1 << 62
        : 1 << 62;
    if (expA != expB) {
      return expA.compareTo(expB);
    }
    return b.availableQty.compareTo(a.availableQty);
  });
  return copy;
}

class _FormLine {
  _FormLine({
    required this.id,
    required this.productId,
    required this.productName,
    required this.locationId,
    required this.locationCode,
    required this.qty,
    required this.batch,
    this.expiryDate,
  });

  final String id;
  final String productId;
  final String productName;
  final String locationId;
  final String locationCode;
  final int qty;
  final String batch;
  final String? expiryDate;
}

/// RN `KirimFormScreen` — `return`, `new`; `inventory` uchun qisqa xabar.
class KirimFormScreen extends ConsumerStatefulWidget {
  const KirimFormScreen({super.key});

  @override
  ConsumerState<KirimFormScreen> createState() => _KirimFormScreenState();
}

class _KirimFormScreenState extends ConsumerState<KirimFormScreen> {
  String _flow = 'return';
  String _warehouse = 'main';
  final List<_FormLine> _lines = <_FormLine>[];
  PickerProductDetailResponse? _product;
  PickerProductLocation? _returnPick;
  final TextEditingController _qty = TextEditingController(text: '1');
  String? _expiry;
  bool _loadingProduct = false;
  String? _productError;
  List<PickerLocationOption> _allLocations = const <PickerLocationOption>[];
  PickerLocationOption? _destLocation;
  String _receivingLocationCode = '';
  bool _sending = false;
  String? _handledProductId;

  @override
  void dispose() {
    _qty.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final Uri u = GoRouterState.of(context).uri;
    _flow = u.queryParameters['flow'] ?? 'return';
    _warehouse = u.queryParameters['warehouse'] ?? 'main';
    _receivingLocationCode = u.queryParameters['receivingLocationCode'] ?? '';
    final String? pid = u.queryParameters['scannedProductId'];
    if (pid != null && pid.isNotEmpty && _handledProductId != pid) {
      _handledProductId = pid;
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadProduct(pid));
    }
  }

  Future<void> _loadLocations() async {
    try {
      final List<PickerLocationOption> list = await ref
          .read(inventoryRepositoryProvider)
          .listPickerLocations(warehouse: _warehouse);
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
      _returnPick = null;
    });
    try {
      final PickerProductDetailResponse res = await ref
          .read(inventoryRepositoryProvider)
          .getPickerProductDetail(
            productId,
            warehouse: _flow == 'return' ? _warehouse : null,
          );
      if (mounted) {
        setState(() {
          _product = res;
          _loadingProduct = false;
          if (_flow == 'return' && res.locations.isNotEmpty) {
            _returnPick = _sortFefo(res.locations).first;
          }
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

  Future<void> _addLineReturn() async {
    final PickerProductDetailResponse? p = _product;
    final PickerProductLocation? pick = _returnPick;
    final int q = int.tryParse(_qty.text.trim()) ?? 0;
    if (p == null || pick == null || q < 1) {
      return;
    }
    if (q > pick.availableQty.floor()) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Mavjud miqdordan oshmasin')),
      );
      return;
    }
    setState(() {
      _lines.add(
        _FormLine(
          id: const Uuid().v4(),
          productId: p.productId,
          productName: p.name,
          locationId: pick.locationId,
          locationCode: pick.locationCode,
          qty: q,
          batch: pick.batchNo,
          expiryDate: pick.expiryDate,
        ),
      );
    });
  }

  Future<void> _addLineNew() async {
    final PickerProductDetailResponse? p = _product;
    final PickerLocationOption? loc = _destLocation;
    final int q = int.tryParse(_qty.text.trim()) ?? 0;
    final String batch = 'MOB-${DateTime.now().millisecondsSinceEpoch}';
    if (p == null || loc == null || q < 1) {
      return;
    }
    setState(() {
      _lines.add(
        _FormLine(
          id: const Uuid().v4(),
          productId: p.productId,
          productName: p.name,
          locationId: loc.id,
          locationCode: loc.code,
          qty: q,
          batch: batch,
          expiryDate: _expiry,
        ),
      );
    });
  }

  Future<void> _submitReturn() async {
    if (_lines.isEmpty || _sending) {
      return;
    }
    setState(() => _sending = true);
    try {
      await ref.read(customerReturnsRepositoryProvider).createCustomerReturn(
            lines: _lines
                .map(
                  (_FormLine l) => CreateCustomerReturnLine(
                    productId: l.productId,
                    locationId: l.locationId,
                    qty: l.qty,
                    productName: l.productName,
                    locationCode: l.locationCode,
                    batch: l.batch,
                    expiryDate: l.expiryDate,
                  ),
                )
                .toList(),
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Yuborildi')));
        context.pop();
      }
    } on Exception catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  Future<void> _submitNew() async {
    if (_lines.isEmpty || _sending) {
      return;
    }
    setState(() => _sending = true);
    try {
      final receipt = await ref.read(receivingRepositoryProvider).createReceipt(
            lines: _lines
                .map(
                  (_FormLine l) => ReceiptLineCreate(
                    productId: l.productId,
                    qty: l.qty,
                    batch: l.batch,
                    locationId: l.locationId,
                    expiryDate: l.expiryDate,
                  ),
                )
                .toList(),
          );
      await ref.read(receivingRepositoryProvider).completeReceipt(receipt.id);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Qabul yakunlandi')));
        context.pop();
      }
    } on Exception catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_allLocations.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadLocations());
    }

    String title = 'Kirim';
    if (_flow == 'new') {
      title = _warehouse == 'showroom' ? 'Showroom kirim' : 'Asosiy kirim';
    } else if (_flow == 'return') {
      title = 'Mijoz qaytishi';
    } else if (_flow == 'inventory') {
      title = 'Inventarizatsiya';
    }

    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: _flow == 'inventory'
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'To‘liq inventarizatsiya oqimi keyingi yangilanishda. '
                  'Hozircha inventar ro‘yxati va Ko‘chirish modulidan foydalaning.',
                  textAlign: TextAlign.center,
                ),
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(16),
              children: <Widget>[
                if (_flow == 'return')
                  SegmentedButton<String>(
                    segments: const <ButtonSegment<String>>[
                      ButtonSegment<String>(value: 'main', label: Text('Asosiy')),
                      ButtonSegment<String>(value: 'showroom', label: Text('Showroom')),
                    ],
                    selected: <String>{_warehouse},
                    onSelectionChanged: (Set<String> v) {
                      setState(() {
                        _warehouse = v.first;
                        _product = null;
                        _returnPick = null;
                        _lines.clear();
                      });
                      _loadLocations();
                    },
                  ),
                if (_flow == 'new' && _receivingLocationCode.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text('Qabul joyi: $_receivingLocationCode'),
                  ),
                if (_flow == 'new')
                  FilledButton.icon(
                    onPressed: () => context.pushNamed(
                      'scanner',
                      extra: ScannerArgs(
                        returnToKirimLocation: true,
                        flow: 'new',
                        warehouse: _warehouse,
                      ),
                    ),
                    icon: const Icon(Icons.qr_code_scanner),
                    label: const Text('Qabul lokatsiyasini skanerlash'),
                  ),
                const SizedBox(height: 12),
                BarcodeSearchInput(
                  onSelectProduct: _loadProduct,
                  label: 'Mahsulot barcode',
                ),
                if (_loadingProduct) const LinearProgressIndicator(),
                if (_productError != null) Text(_productError!, style: const TextStyle(color: Colors.red)),
                if (_product != null) ...<Widget>[
                  const SizedBox(height: 8),
                  ProductCard(
                    title: _product!.name,
                    subtitle: _product!.code,
                    barcode: _product!.mainBarcode,
                  ),
                ],
                if (_flow == 'return' && _product != null) ...<Widget>[
                  const Text('Partiya (FEFO)', style: TextStyle(fontWeight: FontWeight.w600)),
                  ..._sortFefo(_product!.locations).map((PickerProductLocation loc) {
                    final bool sel =
                        _returnPick?.lotId == loc.lotId && _returnPick?.locationId == loc.locationId;
                    return ListTile(
                      title: Text(loc.locationCode),
                      subtitle: Text(
                        '${loc.batchNo} · ${loc.availableQty.toStringAsFixed(0)} · ${loc.expiryDate ?? '—'}',
                      ),
                      tileColor: sel ? Colors.blue.shade50 : null,
                      onTap: () => setState(() => _returnPick = loc),
                    );
                  }),
                  TextField(
                    controller: _qty,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Miqdor',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  FilledButton(onPressed: _addLineReturn, child: const Text('Qator qo‘shish')),
                ],
                if (_flow == 'new' && _product != null) ...<Widget>[
                  const Text('Saqlash joyi', style: TextStyle(fontWeight: FontWeight.w600)),
                  ..._allLocations.take(40).map((PickerLocationOption o) {
                    final bool sel = _destLocation?.id == o.id;
                    return ListTile(
                      title: Text(o.code),
                      subtitle: Text(o.name),
                      tileColor: sel ? Colors.green.shade50 : null,
                      onTap: () => setState(() => _destLocation = o),
                    );
                  }),
                  TextField(
                    controller: _qty,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Miqdor',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  ExpiryDatePickerField(
                    value: _expiry,
                    onChanged: (String? v) => setState(() => _expiry = v),
                  ),
                  FilledButton(onPressed: _addLineNew, child: const Text('Qator qo‘shish')),
                ],
                const Divider(height: 24),
                Text('Qatorlar: ${_lines.length}'),
                ..._lines.map(
                  (_FormLine l) => ListTile(
                    title: Text(l.productName),
                    subtitle: Text('${l.locationCode} · ${l.qty} · ${l.batch}'),
                    trailing: IconButton(
                      icon: const Icon(Icons.delete_outline),
                      onPressed: () => setState(() => _lines.remove(l)),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _sending
                      ? null
                      : () {
                          if (_flow == 'return') {
                            unawaited(_submitReturn());
                          } else if (_flow == 'new') {
                            unawaited(_submitNew());
                          }
                        },
                  child: _sending
                      ? const SizedBox(
                          height: 22,
                          width: 22,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : Text(_flow == 'return' ? 'Yuborish' : 'Qabulni yakunlash'),
                ),
              ],
            ),
    );
  }
}
