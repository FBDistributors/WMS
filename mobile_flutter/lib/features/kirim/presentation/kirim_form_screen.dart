import 'dart:async' show Timer, unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/formatting/expiry_display_format.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/router/scanner_args.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../auth/presentation/auth_providers.dart';
import '../../customer_returns/customer_returns_providers.dart';
import '../../customer_returns/data/customer_returns_models.dart';
import '../../picking/data/picking_models.dart';
import '../../picking/picking_providers.dart';
import '../../general_customers/data/general_customer_models.dart';
import '../../general_customers/general_customers_providers.dart';
import '../../inventory/data/models/picker_inventory_models.dart';
import '../../inventory/data/picker_location_format.dart';
import '../../inventory/presentation/inventory_providers.dart';
import '../../movements/data/movements_repository.dart';
import '../../movements/movements_providers.dart';
import '../../receiving/data/receiving_models.dart';
import '../../receiving/receiving_providers.dart';
import '../../product_boxes/data/product_box_models.dart';
import '../../product_boxes/data/product_box_repository.dart';
import '../../product_boxes/presentation/register_product_box_sheet.dart';
import '../../product_boxes/product_box_providers.dart';
import 'inventory_simple_box_panel.dart';
import 'kirim_receive_qty.dart';
import '../../../shared/input/input_clear_button.dart';
import '../../../shared/layout/sheet_bottom_inset.dart';
import '../../../shared/input/stock_quantity_input.dart';
import '../../../shared/widgets/barcode_search_input.dart';
import '../../../shared/widgets/expiry_date_picker.dart';
import '../../../shared/widgets/product_card.dart';
import '../../../shared/widgets/scan_action_button.dart';

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

/// Bir lokatsiya + bir xil muddat (oy-yil) ostidagi lotlar guruhi —
/// qutili va qutisiz qoldiqlar bitta card'da ko'rsatiladi.
class _InvLocGroup {
  _InvLocGroup({required this.lots}) : assert(lots.isNotEmpty);

  final List<PickerProductLocation> lots;

  PickerProductLocation get primary => lots.first;
  String get locationId => primary.locationId;
  String get locationCode => primary.locationCode;
  String? get expiryDate => primary.expiryDate;
  int get boxCount =>
      lots.fold(0, (int s, PickerProductLocation l) => s + l.boxCount);
  int get unitsInBoxes =>
      lots.fold(0, (int s, PickerProductLocation l) => s + l.unitsInBoxes);
  int get looseUnits =>
      lots.fold(0, (int s, PickerProductLocation l) => s + l.looseUnits);
  double get totalAvailable =>
      lots.fold(0.0, (double s, PickerProductLocation l) => s + l.availableQty);
}

List<_InvLocGroup> _groupInvLocations(List<PickerProductLocation> locs) {
  final Map<String, List<PickerProductLocation>> grouped =
      <String, List<PickerProductLocation>>{};
  final List<String> order = <String>[];
  for (final PickerProductLocation loc in locs) {
    // Card faqat oy-yil ko'rsatgani uchun muddat kaliti ham oy-yil darajasida.
    final String key = '${loc.locationId}|${formatExpiryMonthYear(loc.expiryDate)}';
    final List<PickerProductLocation>? existing = grouped[key];
    if (existing == null) {
      grouped[key] = <PickerProductLocation>[loc];
      order.add(key);
    } else {
      existing.add(loc);
    }
  }
  return order
      .map((String k) => _InvLocGroup(lots: grouped[k]!))
      .toList(growable: false);
}

class _FormLine {
  _FormLine({
    required this.id,
    required this.productId,
    required this.productName,
    this.locationId,
    this.locationCode,
    required this.qty,
    required this.batch,
    this.expiryDate,
  });

  final String id;
  final String productId;
  final String productName;
  final String? locationId;
  final String? locationCode;
  final int qty;
  final String batch;
  final String? expiryDate;
}

/// RN `KirimFormScreen` — `return`, `new`, `inventory` (inventarizatsiya oqimi).
class KirimFormScreen extends ConsumerStatefulWidget {
  const KirimFormScreen({super.key});

  @override
  ConsumerState<KirimFormScreen> createState() => _KirimFormScreenState();
}

class _KirimFormScreenState extends ConsumerState<KirimFormScreen> {
  String _flow = 'return';
  String _warehouse = 'main';
  /// `flow=new` uchun: `byProduct` (standart) yoki `byLocation` (avval saqlash joyi).
  String _newReceiveMode = 'byProduct';
  final TextEditingController _newReceiveBoxCount = TextEditingController(text: '0');
  final TextEditingController _newReceiveBoxBarcode = TextEditingController();
  int? _newReceiveUnitsPerBox;
  /// Oxirgi muvaffaqiyatli aniqlangan quti shtrix kodi (skan yoki qo'lda).
  String? _newReceiveResolvedBoxBarcode;
  bool _skipClearNewReceiveBoxOnLoad = false;
  final List<_FormLine> _lines = <_FormLine>[];
  PickerProductDetailResponse? _product;
  PickerProductLocation? _returnPick;
  final TextEditingController _qty = TextEditingController();
  String? _expiry;
  bool _loadingProduct = false;
  String? _productError;
  List<PickerLocationOption> _allLocations = const <PickerLocationOption>[];
  PickerLocationOption? _destLocation;
  String _receivingLocationCode = '';
  String? _receivingLocationId;
  final TextEditingController _kirimPutawaySearch = TextEditingController();
  bool _sending = false;
  String? _handledProductId;
  int _barcodeFieldKey = 0;

  final TextEditingController _customerSearchController = TextEditingController();
  Timer? _customerDebounce;
  List<GeneralCustomerRow> _customerSuggestions = <GeneralCustomerRow>[];
  bool _customerLoading = false;
  GeneralCustomerRow? _selectedCustomer;
  String? _returnReasonCode;
  String? _returnLineExpiry;
  /// Zaxira (FEFO) bo'lmasa — RN'dagi kabi qo'lda lokatsiya / partiya.
  final TextEditingController _returnManualBatch = TextEditingController();

  int _invStep = 0;
  String? _invSubMode;
  String _invWarehouse = 'main';
  List<PickerLocationOption> _invAllLocations = const <PickerLocationOption>[];
  final TextEditingController _invLocSearch = TextEditingController();
  PickerLocationOption? _invLocation;
  LocationContentsResponse? _invContents;
  bool _invLoadingContents = false;
  String? _invContentsError;
  final Map<String, String> _invActualQty = <String, String>{};
  _InvLocGroup? _invScanSelectedGroup;
  List<ProductBoxSummary> _invProductBoxes = const <ProductBoxSummary>[];
  String? _invScanExpiry;
  bool _invSubmitting = false;
  String? _invHandledLocationStr;
  LocationContentsItem? _invLocPackItem;

  @override
  void dispose() {
    _customerDebounce?.cancel();
    _customerSearchController.dispose();
    _invLocSearch.dispose();
    _newReceiveBoxCount.dispose();
    _newReceiveBoxBarcode.dispose();
    _kirimPutawaySearch.dispose();
    _returnManualBatch.dispose();
    _qty.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final Uri u = GoRouterState.of(context).uri;
    _flow = u.queryParameters['flow'] ?? 'return';
    _warehouse = u.queryParameters['warehouse'] ?? 'main';
    if (_flow == 'new') {
      _newReceiveMode = u.queryParameters['newMode'] == 'byLocation' ? 'byLocation' : 'byProduct';
      final String? rid = u.queryParameters['receivingLocationId'];
      _receivingLocationId = (rid != null && rid.isNotEmpty) ? rid : null;
      final String? qc = u.queryParameters['receivingLocationCode'];
      _receivingLocationCode = (qc != null && qc.isNotEmpty) ? qc : '';
    } else {
      _newReceiveMode = 'byProduct';
      _receivingLocationCode = '';
      _receivingLocationId = null;
    }
    if (_flow == 'inventory') {
      _inventoryDidChangeDependencies(u);
    } else {
      final String? pid = u.queryParameters['scannedProductId'];
      if (pid != null && pid.isNotEmpty && _handledProductId != pid) {
        _handledProductId = pid;
        WidgetsBinding.instance.addPostFrameCallback((_) => _loadProduct(pid));
      }
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
    final bool preservePutaway = _flow == 'new' && _newReceiveMode == 'byLocation';
    final bool preserveUserInput = preservePutaway ||
        _skipClearNewReceiveBoxOnLoad ||
        (_flow == 'new' && _product?.productId == productId);
    final PickerLocationOption? savedDest =
        preserveUserInput ? _destLocation : null;
    final String savedPutawaySearch =
        preserveUserInput ? _kirimPutawaySearch.text : '';
    final String? savedExpiry = preserveUserInput ? _expiry : null;
    setState(() {
      _loadingProduct = true;
      _productError = null;
      _product = null;
      _returnPick = null;
      if (!preserveUserInput) {
        _destLocation = null;
        _kirimPutawaySearch.clear();
        _expiry = null;
        _returnManualBatch.clear();
      }
      _qty.clear();
      if (_flow == 'new' && !_skipClearNewReceiveBoxOnLoad) {
        _clearNewReceiveBoxState();
      }
      _skipClearNewReceiveBoxOnLoad = false;
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
          if (preserveUserInput) {
            _destLocation = savedDest;
            if (savedPutawaySearch.isNotEmpty) {
              _kirimPutawaySearch.text = savedPutawaySearch;
            }
            _expiry = savedExpiry;
          }
          if (_flow == 'inventory') {
            unawaited(_loadInvProductBoxes(productId));
          }
          if (_flow == 'return' && res.locations.isNotEmpty) {
            final List<PickerProductLocation> sorted = _sortFefo(res.locations);
            _returnPick = sorted.first;
            _returnLineExpiry = sorted.first.expiryDate;
            _returnManualBatch.clear();
          }
          if (_flow == 'return' && res.locations.isEmpty) {
            _returnManualBatch.clear();
            _returnLineExpiry = null;
          }
        });
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            FocusManager.instance.primaryFocus?.unfocus();
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

  Future<void> _openKirimProductScannerAndLoad() async {
    if (_flow != 'new' && _flow != 'return') {
      return;
    }
    final ScannerArgs extra = _flow == 'new'
        ? ScannerArgs(
            returnToKirimForm: true,
            flow: 'new',
            warehouse: _warehouse,
            newMode: _newReceiveMode,
            receivingLocationId: _receivingLocationId,
            receivingLocationCode:
                _receivingLocationCode.isEmpty ? null : _receivingLocationCode,
          )
        : ScannerArgs(
            returnToKirimForm: true,
            flow: 'return',
            warehouse: _warehouse,
          );
    final String? id = await context.pushNamed<String>(
      'scanner',
      extra: extra,
    );
    if (!mounted || id == null || id.isEmpty) {
      return;
    }
    await _loadProduct(id);
  }

  Future<void> _addLineReturn() async {
    final PickerProductDetailResponse? p = _product;
    final int q = int.tryParse(_qty.text.trim()) ?? 0;
    final AppLocale loc = ref.read(appLocaleProvider);

    if (p == null) {
      if (!mounted) return;
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'kirimSelectProductFirst'))),
      );
      return;
    }
    if (q < 1) {
      if (!mounted) return;
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'kirimNewReceiveFillAll'))),
      );
      return;
    }

    final String batchTrim = _returnManualBatch.text.trim();
    final String batchValue = (() {
      if (batchTrim.isNotEmpty) {
        return batchTrim;
      }
      final PickerProductLocation? pick = _returnPick;
      if (pick != null && pick.batchNo.trim().isNotEmpty) {
        return pick.batchNo.trim();
      }
      return '';
    })();
    final String? expTrim = _returnLineExpiry?.trim();
    final String? lineExpiry = (expTrim != null && expTrim.isNotEmpty) ? expTrim : null;
    setState(() {
      _lines.add(
        _FormLine(
          id: const Uuid().v4(),
          productId: p.productId,
          productName: p.name,
          locationId: null,
          locationCode: null,
          qty: q,
          batch: batchValue,
          expiryDate: lineExpiry,
        ),
      );
      _clearReturnLineFormAfterAdd();
    });
  }

  void _clearReturnLineFormAfterAdd() {
    _product = null;
    _returnPick = null;
    _returnLineExpiry = null;
    _returnManualBatch.clear();
    _qty.clear();
    _productError = null;
    _loadingProduct = false;
    _handledProductId = null;
    _barcodeFieldKey++;
  }

  bool _canPressAddLineReturn() {
    return _product != null;
  }

  void _scheduleCustomerSearch() {
    _customerDebounce?.cancel();
    _customerDebounce = Timer(const Duration(milliseconds: 400), () {
      if (!mounted) {
        return;
      }
      final String q = _customerSearchController.text.trim();
      if (q.length < 2) {
        setState(() {
          _customerSuggestions = <GeneralCustomerRow>[];
          _customerLoading = false;
        });
        return;
      }
      unawaited(_fetchCustomerSuggestions(q));
    });
  }

  Future<void> _fetchCustomerSuggestions(String q) async {
    setState(() => _customerLoading = true);
    try {
      final List<GeneralCustomerRow> list =
          await ref.read(generalCustomersRepositoryProvider).list(search: q, limit: 40);
      if (mounted) {
        setState(() {
          _customerSuggestions = list;
          _customerLoading = false;
        });
      }
    } on Exception {
      if (mounted) {
        setState(() {
          _customerSuggestions = <GeneralCustomerRow>[];
          _customerLoading = false;
        });
      }
    }
  }

  Future<String?> _showReturnPickerDialog() async {
    final AppLocale loc = ref.read(appLocaleProvider);
    List<PickerUser> pickers = const <PickerUser>[];
    try {
      pickers = await ref.read(pickingRepositoryProvider).getPickers();
    } on Exception {
      pickers = const <PickerUser>[];
    }
    if (!mounted) {
      return null;
    }
    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext ctx) {
        String? selectedId = pickers.isNotEmpty ? pickers.first.id : null;
        return StatefulBuilder(
          builder: (BuildContext ctx2, void Function(void Function()) setLocal) {
            return AlertDialog(
              title: Text(StringLookup.t(loc, 'returnsSelectPickerTitle')),
              content: pickers.isEmpty
                  ? Text(StringLookup.t(loc, 'loadError'))
                  : Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        Text(StringLookup.t(loc, 'pickerNameLabel')),
                        const SizedBox(height: 8),
                        DropdownButton<String>(
                          isExpanded: true,
                          value: selectedId,
                          items: pickers
                              .map(
                                (PickerUser p) => DropdownMenuItem<String>(
                                  value: p.id,
                                  child: Text(
                                    (p.fullName != null && p.fullName!.trim().isNotEmpty)
                                        ? p.fullName!
                                        : p.username,
                                  ),
                                ),
                              )
                              .toList(growable: false),
                          onChanged: (String? v) => setLocal(() => selectedId = v),
                        ),
                      ],
                    ),
              actions: <Widget>[
                TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: Text(StringLookup.t(loc, 'cancel')),
                ),
                FilledButton(
                  onPressed: selectedId == null ? null : () => Navigator.pop(ctx, selectedId),
                  child: Text(StringLookup.t(loc, 'confirmButton')),
                ),
              ],
            );
          },
        );
      },
    );
  }

  List<PickerLocationOption> _filterKirimPutaway(String q, {int cap = 40}) {
    final String s = q.trim().toLowerCase();
    if (s.isEmpty) {
      return const <PickerLocationOption>[];
    }
    return _allLocations
        .where(
          (PickerLocationOption l) =>
              l.code.toLowerCase().contains(s) || l.name.toLowerCase().contains(s),
        )
        .take(cap)
        .toList();
  }

  Widget _kirimPutawayResultsList() {
    final String q = _kirimPutawaySearch.text.trim();
    final PickerLocationOption? d = _destLocation;
    if (d != null && q.isNotEmpty && q.toLowerCase() == d.code.trim().toLowerCase()) {
      return const SizedBox.shrink();
    }
    final List<PickerLocationOption> filtered = _filterKirimPutaway(_kirimPutawaySearch.text);
    if (filtered.isEmpty) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Material(
        elevation: 1,
        borderRadius: BorderRadius.circular(8),
        clipBehavior: Clip.antiAlias,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 220),
          child: ListView.builder(
            shrinkWrap: true,
            padding: EdgeInsets.zero,
            itemCount: filtered.length,
            itemBuilder: (BuildContext _, int i) {
              final PickerLocationOption o = filtered[i];
              final bool sel = _destLocation?.id == o.id;
              final String n = o.name.trim();
              final bool showSubtitle =
                  n.isNotEmpty && n.toLowerCase() != o.code.toLowerCase();
              return ListTile(
                dense: true,
                title: Text(o.code),
                subtitle: showSubtitle ? Text(o.name) : null,
                tileColor: sel ? Colors.green.shade50 : null,
                onTap: () {
                  FocusManager.instance.primaryFocus?.unfocus();
                  setState(() {
                    _destLocation = o;
                    _kirimPutawaySearch.text = o.code;
                  });
                },
              );
            },
          ),
        ),
      ),
    );
  }

  void _clearNewReceiveBoxState() {
    _newReceiveUnitsPerBox = null;
    _newReceiveResolvedBoxBarcode = null;
    _newReceiveBoxBarcode.clear();
    _newReceiveBoxCount.text = '0';
  }

  void _onNewReceiveBoxBarcodeChanged(String value) {
    final String trimmed = value.trim();
    setState(() {
      if (_newReceiveResolvedBoxBarcode != null &&
          trimmed != _newReceiveResolvedBoxBarcode) {
        _newReceiveResolvedBoxBarcode = null;
        _newReceiveUnitsPerBox = null;
        _newReceiveBoxCount.text = '0';
      }
    });
  }

  Future<void> _confirmNewReceiveBoxBarcodeManual() async {
    final String barcode = _newReceiveBoxBarcode.text.trim();
    if (barcode.isEmpty || barcode == _newReceiveResolvedBoxBarcode) {
      return;
    }
    FocusScope.of(context).unfocus();
    await _handleNewReceiveBoxBarcode(barcode);
  }

  void _clearKirimNewAfterLocationSuccess() {
    setState(() {
      _product = null;
      _qty.clear();
      _expiry = null;
      _productError = null;
      _loadingProduct = false;
      _handledProductId = null;
      _barcodeFieldKey++;
      _clearNewReceiveBoxState();
    });
  }

  void _clearPutawayForNewMode() {
    setState(() {
      _destLocation = null;
      _kirimPutawaySearch.clear();
    });
  }

  Widget _kirimNewPutawayFieldsOnly(AppLocale appLoc) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          StringLookup.t(appLoc, 'kirimStorageLocation'),
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _kirimPutawaySearch,
          textCapitalization: TextCapitalization.characters,
          decoration: InputDecoration(
            labelText: StringLookup.t(appLoc, 'kirimPutawaySearchLabel'),
            border: const OutlineInputBorder(),
            suffixIcon: buildInputClearButton(
              visible: _kirimPutawaySearch.text.trim().isNotEmpty,
              onPressed: () {
                setState(() {
                  _kirimPutawaySearch.clear();
                  _destLocation = null;
                });
              },
            ),
          ),
          onChanged: (String v) {
            setState(() {
              final PickerLocationOption? sel = _destLocation;
              if (sel != null && v.trim().toLowerCase() != sel.code.trim().toLowerCase()) {
                _destLocation = null;
              }
            });
          },
        ),
        _kirimPutawayResultsList(),
      ],
    );
  }

  Widget? _newReceiveBoxBarcodeSuffix(AppLocale appLoc) {
    final String text = _newReceiveBoxBarcode.text.trim();
    if (text.isEmpty) {
      return null;
    }
    final bool needsConfirm = text != _newReceiveResolvedBoxBarcode;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        if (needsConfirm)
          IconButton(
            tooltip: StringLookup.t(appLoc, 'kirimNewBoxBarcodeConfirm'),
            onPressed: () => unawaited(_confirmNewReceiveBoxBarcodeManual()),
            constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
            padding: EdgeInsets.zero,
            splashRadius: 20,
            icon: const Icon(Icons.check, color: Color(0xFF1A237E)),
          ),
        buildInputClearButton(
          visible: true,
          onPressed: () => setState(() {
            _newReceiveBoxBarcode.clear();
            _newReceiveResolvedBoxBarcode = null;
            _newReceiveUnitsPerBox = null;
            _newReceiveBoxCount.text = '0';
          }),
        )!,
      ],
    );
  }

  Widget _kirimNewHybridQtyFields(AppLocale appLoc) {
    final int boxCount = int.tryParse(_newReceiveBoxCount.text.trim()) ?? 0;
    final int looseQty = int.tryParse(_qty.text.trim()) ?? 0;
    final int? unitsPerBox = _newReceiveUnitsPerBox;
    final bool canEditBoxCount = unitsPerBox != null && unitsPerBox >= 1;
    final int? total = computeKirimReceiveTotal(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: unitsPerBox,
    );
    final String looseLabel = boxCount > 0 && unitsPerBox != null && unitsPerBox >= 1
        ? StringLookup.t(appLoc, 'inventoryLooseQtyTarget')
        : StringLookup.t(appLoc, 'qtyShort');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: TextField(
                controller: _newReceiveBoxBarcode,
                textInputAction: TextInputAction.done,
                decoration: InputDecoration(
                  labelText: StringLookup.t(appLoc, 'inventoryBoxBarcode'),
                  border: const OutlineInputBorder(),
                  hintText: StringLookup.t(appLoc, 'kirimNewBoxBarcodeHint'),
                  suffixIcon: _newReceiveBoxBarcodeSuffix(appLoc),
                ),
                onChanged: _onNewReceiveBoxBarcodeChanged,
                onSubmitted: (_) =>
                    unawaited(_confirmNewReceiveBoxBarcodeManual()),
              ),
            ),
            const SizedBox(width: 8),
            ScanActionButton(
              compact: true,
              label: StringLookup.t(appLoc, 'inventoryScanBox'),
              onPressed: () => unawaited(_openNewReceiveBoxScan()),
            ),
          ],
        ),
        if (_product == null) ...<Widget>[
          const SizedBox(height: 8),
          Text(
            StringLookup.t(appLoc, 'kirimNewScanBoxFirst'),
            style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
          ),
        ],
        const SizedBox(height: 12),
        InputDecorator(
          decoration: InputDecoration(
            labelText: StringLookup.t(appLoc, 'kirimNewUnitsPerBox'),
            border: const OutlineInputBorder(),
          ),
          child: Text(
            unitsPerBox?.toString() ?? '—',
            style: TextStyle(
              fontSize: 16,
              color: unitsPerBox != null ? null : Colors.grey.shade600,
            ),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _newReceiveBoxCount,
          enabled: canEditBoxCount,
          keyboardType: kStockQtyKeyboardType,
          inputFormatters: kStockQtyInputFormatters,
          decoration: InputDecoration(
            labelText: StringLookup.t(appLoc, 'kirimNewBoxCount'),
            border: const OutlineInputBorder(),
            suffixIcon: buildInputClearButton(
              visible: canEditBoxCount &&
                  _newReceiveBoxCount.text.trim().isNotEmpty &&
                  _newReceiveBoxCount.text.trim() != '0',
              onPressed: () => setState(() => _newReceiveBoxCount.text = '0'),
            ),
          ),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _qty,
          keyboardType: kStockQtyKeyboardType,
          inputFormatters: kStockQtyInputFormatters,
          decoration: InputDecoration(
            labelText: looseLabel,
            border: const OutlineInputBorder(),
            suffixIcon: buildInputClearButton(
              visible: _qty.text.trim().isNotEmpty,
              onPressed: () => setState(() => _qty.clear()),
            ),
          ),
          onChanged: (_) => setState(() {}),
        ),
        if (total != null) ...<Widget>[
          const SizedBox(height: 12),
          Text(
            StringLookup.tParams(
              appLoc,
              'inventoryTargetTotal',
              <String, String>{'total': '$total'},
            ),
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        ],
      ],
    );
  }

  Widget _kirimNewExpiryQtyCard(AppLocale appLoc) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            ExpiryDatePickerField(
              value: _expiry,
              onChanged: (String? v) => setState(() => _expiry = v),
            ),
            const SizedBox(height: 12),
            _kirimNewHybridQtyFields(appLoc),
          ],
        ),
      ),
    );
  }

  Future<void> _openNewReceiveBoxScan() async {
    final String? barcode = await _scanRawBarcode();
    if (!mounted || barcode == null || barcode.trim().isEmpty) {
      return;
    }
    await _handleNewReceiveBoxBarcode(barcode.trim());
  }

  Future<void> _openRegisterProductBoxSheetForReceive({
    required String productId,
    required String productName,
    required String initialBarcode,
  }) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) {
        return Padding(
          padding: EdgeInsets.only(bottom: sheetBottomPadding(context)),
          child: RegisterProductBoxSheet(
            productId: productId,
            productName: productName,
            initialBarcode: initialBarcode,
            onSaved: (int units) {
              if (mounted) {
                setState(() {
                  _newReceiveUnitsPerBox = units;
                  _newReceiveResolvedBoxBarcode = initialBarcode;
                });
                showAppSnackBar(
                  context,
                  SnackBar(content: Text(StringLookup.t(loc, 'inventoryBoxSaved'))),
                );
              }
            },
          ),
        );
      },
    );
  }

  Future<void> _handleNewReceiveBoxBarcode(String barcode) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    setState(() => _newReceiveBoxBarcode.text = barcode);
    try {
      final ProductBoxResolve resolved =
          await ref.read(productBoxRepositoryProvider).resolveByBarcode(barcode);
      if (_product != null && _product!.productId != resolved.productId) {
        if (mounted) {
          showAppSnackBar(
            context,
            SnackBar(content: Text(StringLookup.t(loc, 'inventoryBoxProductMismatch'))),
          );
        }
        return;
      }
      if (_product != null && _product!.productId == resolved.productId) {
        setState(() {
          _newReceiveBoxBarcode.text = barcode;
          _newReceiveResolvedBoxBarcode = barcode;
          _newReceiveUnitsPerBox = resolved.unitsPerBox;
        });
        return;
      }
      _skipClearNewReceiveBoxOnLoad = true;
      await _loadProduct(resolved.productId);
      if (!mounted) {
        return;
      }
      setState(() {
        _newReceiveBoxBarcode.text = barcode;
        _newReceiveResolvedBoxBarcode = barcode;
        _newReceiveUnitsPerBox = resolved.unitsPerBox;
      });
    } on ProductBoxNotFoundException {
      final PickerProductDetailResponse? p = _product;
      if (p == null) {
        if (mounted) {
          showAppSnackBar(
            context,
            SnackBar(content: Text(StringLookup.t(loc, 'kirimNewScanBoxFirst'))),
          );
        }
        return;
      }
      await _openRegisterProductBoxSheetForReceive(
        productId: p.productId,
        productName: p.name,
        initialBarcode: barcode,
      );
    } on Exception catch (e) {
      if (mounted) {
        showAppLocalizedError(context, loc, e);
      }
    }
  }

  Future<void> _submitReturn() async {
    if (_sending) {
      return;
    }
    if (_lines.isEmpty) {
      if (mounted) {
        final AppLocale locMsg = ref.read(appLocaleProvider);
        showAppSnackBar(
          context,
          SnackBar(content: Text(StringLookup.t(locMsg, 'returnsAddAtLeastOne'))),
        );
      }
      return;
    }
    final AppLocale locMsg = ref.read(appLocaleProvider);
    final AuthSession session =
        ref.read(authControllerProvider).valueOrNull ?? const AuthSession.unauthenticated();
    final List<String> perms = session.me?.permissions ?? const <String>[];
    if (!perms.contains('documents:edit_status')) {
      if (mounted) {
        showAppSnackBar(
        context,
          SnackBar(content: Text(StringLookup.t(locMsg, 'returnsApproveAssignNeedPermission'))),
        );
      }
      return;
    }
    if (_selectedCustomer == null) {
      if (mounted) {
        showAppSnackBar(
        context,
          SnackBar(content: Text(StringLookup.t(locMsg, 'returnsCustomerRequired'))),
        );
      }
      return;
    }
    if (_returnReasonCode == null || _returnReasonCode!.trim().isEmpty) {
      if (mounted) {
        showAppSnackBar(
        context,
          SnackBar(content: Text(StringLookup.t(locMsg, 'returnsReasonRequired'))),
        );
      }
      return;
    }
    setState(() => _sending = true);
    try {
      final String cname = (_selectedCustomer!.customerName != null &&
              _selectedCustomer!.customerName!.trim().isNotEmpty)
          ? _selectedCustomer!.customerName!.trim()
          : _selectedCustomer!.customerId;
      CustomerReturn doc = await ref.read(customerReturnsRepositoryProvider).createCustomerReturn(
            customerId: _selectedCustomer!.customerId,
            customerName: cname,
            reasonCode: _returnReasonCode!,
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
      doc = await ref.read(customerReturnsRepositoryProvider).controllerApprove(doc.id);
      if (mounted) {
        final String? pickerId = await _showReturnPickerDialog();
        if (pickerId != null && pickerId.isNotEmpty) {
          await ref.read(customerReturnsRepositoryProvider).assignPicker(doc.id, pickerId);
          if (mounted) {
            showAppSnackBar(
        context,
              SnackBar(content: Text(StringLookup.t(locMsg, 'returnsFlowDone'))),
            );
          }
        }
      }
      if (mounted) {
        context.goNamed('kirim');
      }
    } on Exception catch (e) {
      if (mounted) {
        showAppLocalizedError(context, locMsg, e);
      }
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  Future<void> _submitNew() async {
    if (_sending) {
      return;
    }
    final AppLocale locMsg = ref.read(appLocaleProvider);
    void showFillAll() {
      if (mounted) {
        showAppSnackBar(
        context,
          SnackBar(content: Text(StringLookup.t(locMsg, 'kirimNewReceiveFillAll'))),
        );
      }
    }

    final PickerProductDetailResponse? p = _product;
    final PickerLocationOption? loc = _destLocation;
    final String? exp = _expiry?.trim();

    if (p == null || loc == null) {
      showFillAll();
      return;
    }
    if (exp == null || exp.isEmpty) {
      showFillAll();
      return;
    }

    final int boxCount = int.tryParse(_newReceiveBoxCount.text.trim()) ?? 0;
    final int looseQty = int.tryParse(_qty.text.trim()) ?? 0;
    final int? upb = _newReceiveUnitsPerBox;
    int? submitBoxCount;
    int submitQty;

    if (boxCount > 0) {
      final String barcode = _newReceiveBoxBarcode.text.trim();
      if (upb == null ||
          barcode.isEmpty ||
          barcode != _newReceiveResolvedBoxBarcode) {
        if (mounted) {
          showAppSnackBar(
            context,
            SnackBar(content: Text(StringLookup.t(locMsg, 'kirimNewBoxQtyIncomplete'))),
          );
        }
        return;
      }
      submitBoxCount = boxCount;
      submitQty = boxCount * upb + looseQty;
    } else {
      submitQty = looseQty;
    }

    if (submitQty < 1) {
      showFillAll();
      return;
    }

    setState(() => _sending = true);
    final int? successUnitsPerBox = _newReceiveUnitsPerBox;
    final int successLooseQty = looseQty;
    final String destLocationCode = loc.code;
    try {
      // Atomik: yaratish + yakunlash bitta so'rovda — xato bo'lsa qoralama qolmaydi.
      await ref.read(receivingRepositoryProvider).createReceipt(
            complete: true,
            lines: <ReceiptLineCreate>[
              ReceiptLineCreate(
                productId: p.productId,
                qty: submitQty,
                locationId: loc.id,
                expiryDate: _expiry,
                boxBarcode: submitBoxCount != null ? _newReceiveBoxBarcode.text.trim() : null,
                boxCount: submitBoxCount,
              ),
            ],
          );
      if (mounted) {
        final AppLocale loc = ref.read(appLocaleProvider);
        final String successMessage;
        if (submitBoxCount != null && successUnitsPerBox != null) {
          if (successLooseQty > 0) {
            successMessage = StringLookup.tParams(
              loc,
              'kirimBoxReceiveSuccessHybrid',
              <String, String>{
                'boxCount': '$submitBoxCount',
                'unitsPerBox': '$successUnitsPerBox',
                'loose': '$successLooseQty',
                'total': '$submitQty',
                'product': p.name,
                'location': destLocationCode,
              },
            );
          } else {
            successMessage = StringLookup.tParams(
              loc,
              'kirimBoxReceiveSuccess',
              <String, String>{
                'boxCount': '$submitBoxCount',
                'unitsPerBox': '$successUnitsPerBox',
                'total': '$submitQty',
                'product': p.name,
                'location': destLocationCode,
              },
            );
          }
        } else {
          successMessage = StringLookup.t(loc, 'kirimSingleReceiveSuccess');
        }
        if (_newReceiveMode == 'byLocation') {
          _clearKirimNewAfterLocationSuccess();
          showAppSnackBar(
            context,
            SnackBar(content: Text(successMessage)),
          );
        } else {
          await showDialog<void>(
            context: context,
            builder: (BuildContext ctx) {
              return AlertDialog(
                content: Text(successMessage),
                actions: <Widget>[
                  TextButton(
                    onPressed: () => Navigator.of(ctx).pop(),
                    child: Text(MaterialLocalizations.of(ctx).okButtonLabel),
                  ),
                ],
              );
            },
          );
          if (mounted) {
            _onNewFlowBack();
          }
        }
      }
    } on Exception catch (e) {
      if (mounted) {
        showAppLocalizedError(context, locMsg, e);
      }
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  void _inventoryDidChangeDependencies(Uri u) {
    final Map<String, String> qp = u.queryParameters;
    final String? pid = qp['scannedProductId'];
    final String? lid = qp['inventoryLocationId'];
    final String? lcode = qp['inventoryLocationCode'];
    if ((pid == null || pid.isEmpty) && (lid == null || lid.isEmpty)) {
      return;
    }
    final String full = u.toString();
    if (full == _invHandledLocationStr) {
      return;
    }
    _invHandledLocationStr = full;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      if (pid != null && pid.isNotEmpty) {
        if (lid != null && lcode != null && lcode.isNotEmpty) {
          setState(() {
            _invSubMode = _invSubMode ?? 'byLocation';
            _invLocation = PickerLocationOption(
              id: lid,
              code: lcode,
              name: lcode,
              zoneType: null,
              expiredSlot: null,
              expiredDisplayLabel: null,
            );
            _invLocSearch.text = lcode;
            _invStep = 2;
          });
          unawaited(_loadProduct(pid));
        } else {
          setState(() {
            _invSubMode = 'byScan';
            _invStep = 2;
            _invScanSelectedGroup = null;
          });
          unawaited(_loadProduct(pid));
        }
        GoRouter.of(context).goNamed(
          'kirimForm',
          queryParameters: <String, String>{'flow': 'inventory'},
        );
        _invHandledLocationStr = null;
        return;
      }
      if (lid != null && lcode != null && lcode.isNotEmpty) {
        final int step = int.tryParse(qp['inventoryStep'] ?? '') ?? 2;
        setState(() {
          _invSubMode = _invSubMode ?? 'byLocation';
          _invLocation = PickerLocationOption(
            id: lid,
            code: lcode,
            name: lcode,
            zoneType: null,
            expiredSlot: null,
            expiredDisplayLabel: null,
          );
          _invLocSearch.text = lcode;
          _invStep = step.clamp(1, 2);
        });
        GoRouter.of(context).goNamed(
          'kirimForm',
          queryParameters: <String, String>{'flow': 'inventory'},
        );
        _invHandledLocationStr = null;
      }
    });
  }

  Future<void> _loadInvLocations() async {
    try {
      final List<PickerLocationOption> list = await ref
          .read(inventoryRepositoryProvider)
          .listPickerLocations(warehouse: _invWarehouse);
      if (mounted) {
        setState(() => _invAllLocations = list);
      }
    } on Exception {
      if (mounted) {
        setState(() => _invAllLocations = const <PickerLocationOption>[]);
      }
    }
  }

  String _invNorm(String s) => s.trim().toLowerCase();

  List<PickerLocationOption> _filteredInvLocations() {
    final String q = _invLocSearch.text.trim();
    if (q.isEmpty) {
      return const <PickerLocationOption>[];
    }
    final String n = _invNorm(q);
    return _invAllLocations
        .where(
          (PickerLocationOption l) =>
              _invNorm(l.code).contains(n) || _invNorm(l.name).contains(n),
        )
        .take(50)
        .toList(growable: false);
  }

  bool get _showInvLocDropdown {
    final String t = _invLocSearch.text.trim();
    if (t.isEmpty) {
      return false;
    }
    return _invLocation == null || _invLocation!.code != t;
  }

  Future<void> _refreshInvLocationContents() async {
    final PickerLocationOption? loc = _invLocation;
    if (loc == null) {
      return;
    }
    setState(() {
      _invLoadingContents = true;
      _invContentsError = null;
      _invContents = null;
    });
    try {
      final LocationContentsResponse res =
          await ref.read(inventoryRepositoryProvider).getLocationContents(loc.code);
      if (mounted) {
        setState(() {
          _invContents = res;
          _invActualQty.clear();
          _invLoadingContents = false;
        });
      }
    } on Exception catch (e) {
      if (mounted) {
        setState(() {
          _invContentsError = '$e';
          _invLoadingContents = false;
        });
      }
    }
  }

  void _onInventoryBack() {
    if (_invStep == 0) {
      context.goNamed('kirim');
      return;
    }
    if (_invStep == 1) {
      setState(() {
        _invStep = 0;
        _invSubMode = null;
      });
      return;
    }
    if (_invStep == 2) {
      setState(() {
        _invStep = 1;
        if (_invSubMode == 'byScan') {
          _product = null;
          _invScanSelectedGroup = null;
          _productError = null;
        }
      });
      return;
    }
    if (_invStep == 3) {
      setState(() {
        _invStep = 2;
        if (_invSubMode == 'byScan') {
          _invScanSelectedGroup = null;
        }
        if (_invSubMode == 'byLocation') {
          _invLocPackItem = null;
        }
      });
    }
  }

  void _onNewFlowBack() {
    if (_flow == 'new') {
      context.goNamed('kirimNew');
      return;
    }
    if (context.canPop()) {
      context.pop();
      return;
    }
    context.goNamed('kirim');
  }

  void _onReturnFlowBack() {
    if (_flow == 'return') {
      context.goNamed('kirim');
      return;
    }
    if (context.canPop()) {
      context.pop();
      return;
    }
    context.goNamed('kirim');
  }

  void _openInventoryScanner() {
    unawaited(_openInventoryScannerAndHandleResult());
  }

  Future<String?> _scanRawBarcode() {
    return context.pushNamed<String>(
      'scanner',
      extra: const ScannerArgs(returnRawBarcode: true),
    );
  }

  Future<void> _openInventoryScannerAndHandleResult() async {
    final bool byLoc = _invSubMode == 'byLocation' && _invLocation != null;
    final String? productId = await context.pushNamed<String>(
      'scanner',
      extra: ScannerArgs(
        returnToKirimForm: true,
        flow: 'inventory',
        warehouse: _invWarehouse,
        inventoryStep: byLoc ? 2 : 1,
        inventoryLocationId: byLoc ? _invLocation!.id : null,
        inventoryLocationCode: byLoc ? _invLocation!.code : null,
      ),
    );
    if (!mounted || productId == null || productId.isEmpty) {
      return;
    }
    _invSelectProductFromBarcode(productId);
  }

  void _invSelectProductFromBarcode(String productId) {
    setState(() {
      _invSubMode = 'byScan';
      _invStep = 2;
      _invScanSelectedGroup = null;
    });
    unawaited(_loadProduct(productId));
  }

  Future<void> _submitInvByLocationAdjust() async {
    final AppLocale locale = ref.read(appLocaleProvider);
    final List<LocationContentsItem> items = _invContents?.items ?? const <LocationContentsItem>[];
    if (items.isEmpty || _invSubmitting) {
      return;
    }
    setState(() => _invSubmitting = true);
    bool hadError = false;
    bool forbidden = false;
    final Set<String> sent = <String>{};
    try {
      final MovementsRepository repo = ref.read(movementsRepositoryProvider);
      for (final LocationContentsItem item in items) {
        final String uKey = '${item.productId}-${item.lotId}-${item.locationId}';
        if (sent.contains(uKey)) {
          continue;
        }
        final String key = '${item.productId}-${item.lotId}';
        final String actualStr = (_invActualQty[key] ?? '').trim();
        if (actualStr.isEmpty) {
          continue;
        }
        final int actual = int.tryParse(actualStr) ?? 0;
        final double delta = actual.toDouble() - item.availableQty;
        if (delta == 0) {
          continue;
        }
        sent.add(uKey);
        try {
          await repo.createStockMovement(
            productId: item.productId,
            lotId: item.lotId,
            locationId: item.locationId,
            qtyChange: delta,
            reasonCode: delta < 0 ? 'inventory_shortage' : 'inventory_overage',
          );
        } on StockMovementForbiddenException {
          forbidden = true;
        } on Exception {
          hadError = true;
        }
      }
      if (mounted) {
        if (forbidden) {
          showAppSnackBar(
        context,
            SnackBar(content: Text(StringLookup.t(locale, 'inventoryPermissionDenied'))),
          );
        } else if (hadError) {
          showAppSnackBar(
        context,
            SnackBar(content: Text(StringLookup.t(locale, 'inventorySomeRowsFailed'))),
          );
        } else if (sent.isNotEmpty) {
          showAppSnackBar(
        context,
            SnackBar(content: Text(StringLookup.t(locale, 'inventorySaved'))),
          );
          setState(() => _invActualQty.clear());
          await _refreshInvLocationContents();
        }
      }
    } finally {
      if (mounted) {
        setState(() => _invSubmitting = false);
      }
    }
  }

  Widget _invChoiceCard({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: <Widget>[
              Icon(icon, size: 32, color: const Color(0xFF1A237E)),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Text(subtitle, style: TextStyle(fontSize: 13, color: Colors.grey.shade700)),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: Colors.grey.shade600),
            ],
          ),
        ),
      ),
    );
  }

  /// Inventarizatsiya (lokatsiya tarkibi): shtrix, muddat, tizim — `batch_no` ko‘rsatilmaydi.
  String _invContentsItemMetaLine(LocationContentsItem item) {
    final List<String> parts = <String>[];
    final String? bc = item.barcode?.trim();
    if (bc != null && bc.isNotEmpty) {
      parts.add(bc);
    }
    if (item.expiryDate != null && item.expiryDate!.trim().isNotEmpty) {
      parts.add(formatExpiryMonthYear(item.expiryDate));
    }
    parts.add('Qoldiq: ${item.availableQty.round()}');
    return parts.join(' • ');
  }

  PickerProductLocation _invScanPackLot(_InvLocGroup group) {
    return group.lots.firstWhere(
      (PickerProductLocation l) => l.boxCount > 0,
      orElse: () => group.primary,
    );
  }

  Future<void> _loadInvProductBoxes(String productId) async {
    try {
      final List<ProductBoxSummary> boxes =
          await ref.read(productBoxRepositoryProvider).listByProduct(productId);
      if (!mounted) {
        return;
      }
      setState(() => _invProductBoxes = boxes);
    } on Exception {
      if (mounted) {
        setState(() => _invProductBoxes = const <ProductBoxSummary>[]);
      }
    }
  }

  bool _invShowBoxBreakdown(_InvLocGroup group) =>
      _invProductBoxes.isNotEmpty || group.boxCount > 0;

  List<Widget> _invBoxBreakdownRowsFromLoc(AppLocale appLoc, _InvLocGroup group) {
    if (!_invShowBoxBreakdown(group)) {
      return const <Widget>[];
    }
    return <Widget>[
      _invValueRow(
        StringLookup.t(appLoc, 'inventoryLocationFullBoxes'),
        '${group.boxCount}',
      ),
      _invValueRow(
        StringLookup.t(appLoc, 'inventoryUnitsInBoxes'),
        '${group.unitsInBoxes}',
      ),
      if (group.looseUnits > 0)
        _invValueRow(
          StringLookup.t(appLoc, 'inventoryLooseStock'),
          '${group.looseUnits}',
        ),
      _invValueRow(
        StringLookup.t(appLoc, 'inventoryLocationTotalUnits'),
        '${group.totalAvailable.round()}',
        emphasize: true,
      ),
    ];
  }

  Widget _invValueRow(String label, String value, {bool emphasize = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: RichText(
        text: TextSpan(
          style: TextStyle(
            fontSize: 14,
            color: Colors.grey.shade800,
          ),
          children: <InlineSpan>[
            TextSpan(
              text: '$label: ',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            TextSpan(
              text: value,
              style: TextStyle(
                fontWeight: emphasize ? FontWeight.w700 : FontWeight.w500,
                color: emphasize ? const Color(0xFF1A237E) : Colors.grey.shade900,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _invScanLocationCard(
    AppLocale appLoc,
    PickerProductDetailResponse p,
    _InvLocGroup group,
  ) {
    final String ean = (p.mainBarcode ?? '').trim().isEmpty ? '—' : p.mainBarcode!.trim();
    final String expiry = formatExpiryMonthYear(group.expiryDate);
    final List<Widget> boxRows = _invBoxBreakdownRowsFromLoc(appLoc, group);
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () {
          setState(() {
            _invScanSelectedGroup = group;
            _invScanExpiry = group.expiryDate;
            _invStep = 3;
          });
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      group.locationCode,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF1A237E),
                      ),
                    ),
                    const SizedBox(height: 8),
                    _invValueRow('Shtrix kod', ean),
                    _invValueRow('SKU', p.code.trim().isEmpty ? '—' : p.code.trim()),
                    _invValueRow('Muddat', expiry),
                    if (boxRows.isEmpty)
                      _invValueRow('Qoldiq', '${group.totalAvailable.round()}', emphasize: true)
                    else ...<Widget>[
                      Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Text(
                          StringLookup.t(appLoc, 'inventoryLocationStockComputed'),
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: Colors.grey.shade700,
                          ),
                        ),
                      ),
                      ...boxRows,
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 6),
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Icon(Icons.chevron_right, color: Color(0xFF1A237E)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildInventoryBody() {
    if (_invAllLocations.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadInvLocations());
    }
    final AppLocale appLoc = ref.watch(appLocaleProvider);
    final double bottomPad = MediaQuery.viewPaddingOf(context).bottom + 24;
    return ListView(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + bottomPad),
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      children: <Widget>[
        if (_invStep == 0) ...<Widget>[
          _invChoiceCard(
            icon: Icons.location_on_outlined,
            title: 'Lokatsiya bo‘yicha',
            subtitle: 'Lokatsiyani tanlang, ichidagi qoldiqlarni tekshiring.',
            onTap: () => setState(() {
              _invSubMode = 'byLocation';
              _invStep = 1;
            }),
          ),
          _invChoiceCard(
            icon: Icons.qr_code_scanner,
            title: 'Skanerlash orqali',
            subtitle: 'Mahsulotni skanerlang, keyin lokatsiyani tanlang.',
            onTap: () => setState(() {
              _invSubMode = 'byScan';
              _invStep = 1;
              _product = null;
              _invScanSelectedGroup = null;
            }),
          ),
        ],
        if (_invStep > 0 && _invSubMode == 'byLocation' && _invStep == 1) ...<Widget>[
          SegmentedButton<String>(
            segments: const <ButtonSegment<String>>[
              ButtonSegment<String>(value: 'main', label: Text('Asosiy ombor')),
              ButtonSegment<String>(value: 'showroom', label: Text('Showroom')),
            ],
            selected: <String>{_invWarehouse},
            onSelectionChanged: (Set<String> v) {
              setState(() {
                _invWarehouse = v.first;
                _invLocation = null;
                _invLocSearch.clear();
              });
              unawaited(_loadInvLocations());
            },
          ),
          const SizedBox(height: 12),
          const Text('Lokatsiyani tanlang', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Expanded(
                  child: TextField(
                    controller: _invLocSearch,
                    decoration: InputDecoration(
                      labelText: 'Kod yoki nom bo‘yicha qidiruv',
                      border: const OutlineInputBorder(),
                      suffixIcon: buildInputClearButton(
                        visible: _invLocSearch.text.trim().isNotEmpty,
                        onPressed: () => setState(() {
                          _invLocSearch.clear();
                          _invLocation = null;
                        }),
                      ),
                    ),
                    onChanged: (_) => setState(() {}),
                    textCapitalization: TextCapitalization.characters,
                  ),
                ),
                const SizedBox(width: 8),
                ScanActionButton(
                  onPressed: _openInventoryScanner,
                  compact: true,
                ),
              ],
            ),
          ),
          if (_showInvLocDropdown)
            Card(
              margin: const EdgeInsets.only(top: 8),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 220),
                child: ListView(
                  shrinkWrap: true,
                  children: _filteredInvLocations().map((PickerLocationOption loc) {
                    return ListTile(
                      title: Text(formatPickerLocationOptionLine(loc)),
                      subtitle: loc.name.isNotEmpty && loc.name != loc.code ? Text(loc.name) : null,
                      onTap: () {
                        setState(() {
                          _invLocation = loc;
                          _invLocSearch.text = loc.code;
                        });
                      },
                    );
                  }).toList(),
                ),
              ),
            ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _invLocation == null
                ? null
                : () {
                    setState(() => _invStep = 2);
                    unawaited(_refreshInvLocationContents());
                  },
            child: const Text('Lokatsiya tarkibini ko‘rish'),
          ),
        ],
        if (_invSubMode == 'byLocation' && _invStep == 2 && _invLocation != null) ...<Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  'Tanlangan: ${_invLocation!.code}',
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF1565C0),
                  ),
                ),
              ),
              TextButton(
                onPressed: () => setState(() {
                  _invStep = 1;
                  _invContents = null;
                  _invContentsError = null;
                  _invActualQty.clear();
                }),
                child: const Text('Almashtirish'),
              ),
            ],
          ),
          if (_invLoadingContents) const LinearProgressIndicator(),
          if (_invContentsError != null)
            Text(_invContentsError!, style: const TextStyle(color: Colors.red)),
          if (!_invLoadingContents && _invContents != null) ...<Widget>[
            if (_invContents!.items.isEmpty)
              Text('Bu lokatsiyada mahsulot yo‘q', style: TextStyle(color: Colors.grey.shade700))
            else ...<Widget>[
              const Text('Qoldiqlar', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              ..._invContents!.items.map((LocationContentsItem item) {
                final String key = '${item.productId}-${item.lotId}';
                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      Text(
                        item.productName,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      Text(
                        _invContentsItemMetaLine(item),
                        style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
                      ),
                      const SizedBox(height: 8),
                      OutlinedButton.icon(
                        onPressed: () => setState(() {
                          _invLocPackItem = item;
                          _invStep = 3;
                        }),
                        icon: const Icon(Icons.inventory_2_outlined),
                        label: Text(StringLookup.t(appLoc, 'inventoryOpenBoxCount')),
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        keyboardType: kStockQtyKeyboardType,
                        inputFormatters: kStockQtyInputFormatters,
                        decoration: const InputDecoration(
                          labelText: 'Haqiqiy miqdor',
                          border: OutlineInputBorder(),
                        ),
                        onChanged: (String v) => setState(() => _invActualQty[key] = v),
                      ),
                    ],
                  ),
                );
              }),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: _invSubmitting ? null : () => unawaited(_submitInvByLocationAdjust()),
                child: _invSubmitting
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('Tuzatishlarni yuborish'),
              ),
            ],
          ],
        ],
        if (_invSubMode == 'byLocation' &&
            _invStep == 3 &&
            _invLocPackItem != null &&
            _invLocation != null) ...<Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  StringLookup.t(appLoc, 'inventoryOpenBoxCount'),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
              TextButton(
                onPressed: () => setState(() {
                  _invStep = 2;
                  _invLocPackItem = null;
                }),
                child: Text(StringLookup.t(appLoc, 'back')),
              ),
            ],
          ),
          const SizedBox(height: 8),
          InventorySimpleBoxPanel(
            productId: _invLocPackItem!.productId,
            locationId: _invLocPackItem!.locationId,
            lotId: _invLocPackItem!.lotId,
            onSaved: (_) {
              unawaited(_refreshInvLocationContents());
              if (mounted) {
                setState(() {
                  _invStep = 2;
                  _invLocPackItem = null;
                });
              }
            },
          ),
        ],
        if (_invSubMode == 'byScan' && _invStep == 1) ...<Widget>[
          BarcodeSearchInput(
            onSelectProduct: _invSelectProductFromBarcode,
            label: 'Mahsulot barcode',
            onProductScanPressed: _openInventoryScanner,
          ),
        ],
        if (_invSubMode == 'byScan' && _invStep == 2 && _loadingProduct) const LinearProgressIndicator(),
        if (_invSubMode == 'byScan' && _invStep == 2 && _product != null && !_loadingProduct) ...<Widget>[
          ProductCard(
            title: _product!.name,
            subtitle: _product!.code,
            barcode: _product!.mainBarcode,
          ),
          const SizedBox(height: 12),
          const Text('Tuzatish uchun lokatsiyani tanlang', style: TextStyle(fontWeight: FontWeight.w600)),
          if (_product!.locations.isEmpty)
            Text('Qoldiq topilmadi', style: TextStyle(color: Colors.grey.shade700))
          else
            ..._groupInvLocations(_product!.locations).map(
              (_InvLocGroup group) =>
                  _invScanLocationCard(appLoc, _product!, group),
            ),
          TextButton(
            onPressed: () => setState(() {
              _product = null;
              _invStep = 1;
              _invProductBoxes = const <ProductBoxSummary>[];
            }),
            child: const Text('Boshqa mahsulot skanerlash'),
          ),
        ],
        if (_invSubMode == 'byScan' &&
            _invStep == 3 &&
            _product != null &&
            _invScanSelectedGroup != null) ...<Widget>[
          const Text(
            'Tanlangan lokatsiya',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    _invScanSelectedGroup!.locationCode,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFF1A237E),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _product!.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    StringLookup.tParams(
                      appLoc,
                      'inventoryCompactBreakdown',
                      <String, String>{
                        'boxes': '${_invScanSelectedGroup!.boxCount}',
                        'loose': '${_invScanSelectedGroup!.looseUnits}',
                        'total': '${_invScanSelectedGroup!.totalAvailable.round()}',
                      },
                    ),
                    style: TextStyle(fontSize: 13, color: Colors.grey.shade800),
                  ),
                ],
              ),
            ),
          ),
          ExpiryDatePickerField(
            value: _invScanExpiry,
            onChanged: (String? v) => setState(() => _invScanExpiry = v),
          ),
          const SizedBox(height: 10),
          InventorySimpleBoxPanel(
            key: ValueKey<String>(
              '${_invScanSelectedGroup!.locationId}|${_invScanPackLot(_invScanSelectedGroup!).lotId}',
            ),
            productId: _product!.productId,
            locationId: _invScanSelectedGroup!.locationId,
            lotId: _invScanPackLot(_invScanSelectedGroup!).lotId,
            initialBoxCount: _invScanSelectedGroup!.boxCount,
            initialLooseQty: _invScanSelectedGroup!.looseUnits,
            looseAdjustLots: _invScanSelectedGroup!.lots,
            onSaved: (_) {
              if (mounted) {
                setState(() {
                  _invScanSelectedGroup = null;
                  _invScanExpiry = null;
                  _invStep = 2;
                });
              }
              unawaited(_loadProduct(_product!.productId));
            },
          ),
        ],
        if (_invSubMode == 'byScan' && _invStep == 1 && _loadingProduct) const LinearProgressIndicator(),
        if (_invSubMode == 'byScan' && _invStep == 1 && _productError != null)
          Text(_productError!, style: const TextStyle(color: Colors.red)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale appLoc = ref.watch(appLocaleProvider);
    if (_flow != 'inventory' && _allLocations.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadLocations());
    }

    String title = StringLookup.t(appLoc, 'kirimTitle');
    if (_flow == 'new') {
      title = _warehouse == 'showroom'
          ? StringLookup.t(appLoc, 'kirimFormTitleNewShowroom')
          : StringLookup.t(appLoc, 'kirimFormTitleNewMain');
    } else if (_flow == 'return') {
      title = StringLookup.t(appLoc, 'kirimCustomerReturns');
    } else if (_flow == 'inventory') {
      title = StringLookup.t(appLoc, 'kirimInventory');
    }

    if (_flow == 'inventory') {
      return PopScope(
        canPop: false,
        onPopInvokedWithResult: (bool didPop, Object? result) {
          if (!didPop) {
            _onInventoryBack();
          }
        },
        child: Scaffold(
          appBar: AppBar(
            title: Text(title),
            leading: IconButton(
              icon: const Icon(Icons.arrow_back),
              onPressed: _onInventoryBack,
            ),
          ),
          body: _buildInventoryBody(),
        ),
      );
    }

    final double kirimBodyBottomPad = MediaQuery.viewPaddingOf(context).bottom + 24;
    final Widget body = ListView(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + kirimBodyBottomPad),
              children: <Widget>[
                if (_flow == 'return')
                  SegmentedButton<String>(
                    segments: <ButtonSegment<String>>[
                      ButtonSegment<String>(
                        value: 'main',
                        label: Text(StringLookup.t(appLoc, 'warehouseSegmentMain')),
                      ),
                      ButtonSegment<String>(
                        value: 'showroom',
                        label: Text(StringLookup.t(appLoc, 'warehouseSegmentShowroom')),
                      ),
                    ],
                    selected: <String>{_warehouse},
                    onSelectionChanged: (Set<String> v) {
                      setState(() {
                        _warehouse = v.first;
                        _product = null;
                        _returnPick = null;
                        _returnLineExpiry = null;
                        _returnManualBatch.clear();
                        _lines.clear();
                      });
                      _loadLocations();
                    },
                  ),
                if (_flow == 'return') ...<Widget>[
                  const SizedBox(height: 12),
                  Text(
                    StringLookup.t(appLoc, 'returnsCustomerSearchLabel'),
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  if (_selectedCustomer != null)
                    InputDecorator(
                      decoration: InputDecoration(
                        border: const OutlineInputBorder(),
                        suffixIcon: buildInputClearButton(
                          visible: true,
                          onPressed: () => setState(() => _selectedCustomer = null),
                        ),
                      ),
                      child: Text(_selectedCustomer!.displayLabel, style: const TextStyle(fontSize: 15)),
                    )
                  else ...<Widget>[
                    TextField(
                      controller: _customerSearchController,
                      decoration: InputDecoration(
                        border: const OutlineInputBorder(),
                        hintText: StringLookup.t(appLoc, 'returnsCustomerSearchLabel'),
                        suffixIcon: buildInputClearButton(
                          visible: _customerSearchController.text.trim().isNotEmpty,
                          onPressed: () => setState(() {
                            _customerSearchController.clear();
                            _customerSuggestions = <GeneralCustomerRow>[];
                            _customerLoading = false;
                          }),
                        ),
                      ),
                      onChanged: (_) => _scheduleCustomerSearch(),
                    ),
                    if (_customerLoading) const LinearProgressIndicator(),
                    if (_customerSuggestions.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Material(
                          elevation: 1,
                          borderRadius: BorderRadius.circular(8),
                          clipBehavior: Clip.antiAlias,
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxHeight: 200),
                            child: ListView.builder(
                              shrinkWrap: true,
                              padding: EdgeInsets.zero,
                              itemCount: _customerSuggestions.length,
                              itemBuilder: (BuildContext _, int i) {
                                final GeneralCustomerRow r = _customerSuggestions[i];
                                return ListTile(
                                  dense: true,
                                  title: Text(r.displayLabel),
                                  onTap: () {
                                    FocusManager.instance.primaryFocus?.unfocus();
                                    setState(() {
                                      _selectedCustomer = r;
                                      _customerSuggestions = <GeneralCustomerRow>[];
                                    });
                                  },
                                );
                              },
                            ),
                          ),
                        ),
                      ),
                  ],
                  const SizedBox(height: 12),
                  Text(
                    StringLookup.t(appLoc, 'returnsReasonLabel'),
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    initialValue: _returnReasonCode,
                    decoration: const InputDecoration(
                      border: OutlineInputBorder(),
                    ),
                    items: <DropdownMenuItem<String>>[
                      DropdownMenuItem<String>(
                        value: 'customer_return',
                        child: Text(StringLookup.t(appLoc, 'returnsReasonCustomerReturn')),
                      ),
                      DropdownMenuItem<String>(
                        value: 'damaged',
                        child: Text(StringLookup.t(appLoc, 'returnsReasonDamaged')),
                      ),
                      DropdownMenuItem<String>(
                        value: 'wrong_shipment',
                        child: Text(StringLookup.t(appLoc, 'returnsReasonWrongShipment')),
                      ),
                    ],
                    onChanged: (String? v) => setState(() => _returnReasonCode = v),
                  ),
                ],
                if (_flow == 'new' && _newReceiveMode == 'byLocation') ...<Widget>[
                  _kirimNewPutawayFieldsOnly(appLoc),
                  const SizedBox(height: 12),
                  Stack(
                    children: <Widget>[
                      AbsorbPointer(
                        absorbing: _destLocation == null,
                        child: Opacity(
                          opacity: _destLocation == null ? 0.45 : 1,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: <Widget>[
                              BarcodeSearchInput(
                                key: ValueKey<int>(_barcodeFieldKey),
                                onSelectProduct: _loadProduct,
                                label: StringLookup.t(appLoc, 'barcodeOrSku'),
                                showClearButton: true,
                                onProductScanPressed: () =>
                                    unawaited(_openKirimProductScannerAndLoad()),
                              ),
                              if (_loadingProduct) const LinearProgressIndicator(),
                              if (_productError != null)
                                Text(_productError!, style: const TextStyle(color: Colors.red)),
                              if (_product != null) ...<Widget>[
                                const SizedBox(height: 8),
                                ProductCard(
                                  title: _product!.name,
                                  subtitle: _product!.code,
                                  barcode: _product!.mainBarcode,
                                ),
                              ],
                              const SizedBox(height: 16),
                              const Divider(height: 1),
                              const SizedBox(height: 16),
                              _kirimNewExpiryQtyCard(appLoc),
                            ],
                          ),
                        ),
                      ),
                      if (_destLocation == null)
                        Positioned.fill(
                          child: GestureDetector(
                            behavior: HitTestBehavior.translucent,
                            onTap: () {
                              showAppSnackBar(
                                context,
                                SnackBar(
                                  content:
                                      Text(StringLookup.t(appLoc, 'kirimSelectLocationFirst')),
                                ),
                              );
                            },
                          ),
                        ),
                    ],
                  ),
                ],
                if (_flow != 'new' || _newReceiveMode == 'byProduct') ...<Widget>[
                  const SizedBox(height: 12),
                  BarcodeSearchInput(
                    key: ValueKey<int>(_barcodeFieldKey),
                    onSelectProduct: _loadProduct,
                    label: StringLookup.t(appLoc, 'barcodeOrSku'),
                    showClearButton: true,
                    onProductScanPressed: (_flow == 'new' || _flow == 'return')
                        ? () => unawaited(_openKirimProductScannerAndLoad())
                        : null,
                  ),
                  if (_loadingProduct) const LinearProgressIndicator(),
                  if (_productError != null)
                    Text(_productError!, style: const TextStyle(color: Colors.red)),
                  if (_product != null) ...<Widget>[
                    const SizedBox(height: 8),
                    ProductCard(
                      title: _product!.name,
                      subtitle: _product!.code,
                      barcode: _product!.mainBarcode,
                    ),
                  ],
                ],
                if (_flow == 'return' && _product != null) ...<Widget>[
                  Text(
                    StringLookup.t(appLoc, 'kirimBatchFefo'),
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  if (_product!.locations.isNotEmpty) ...<Widget>[
                    const SizedBox(height: 6),
                    Text(
                      StringLookup.t(appLoc, 'returnsFefoSuggestionHint'),
                      style: TextStyle(fontSize: 13, color: Colors.grey.shade800),
                    ),
                    const SizedBox(height: 4),
                  ],
                  if (_product!.locations.isEmpty) ...<Widget>[
                    const SizedBox(height: 6),
                    Text(
                      StringLookup.t(appLoc, 'returnsNoStockInWarehouse'),
                      style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      StringLookup.t(appLoc, 'returnsNoStockSelectLocationHint'),
                      style: TextStyle(fontSize: 13, color: Colors.grey.shade800),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _returnManualBatch,
                      textCapitalization: TextCapitalization.characters,
                      decoration: InputDecoration(
                        labelText: StringLookup.t(appLoc, 'kirimBatchLabel'),
                        border: const OutlineInputBorder(),
                        suffixIcon: buildInputClearButton(
                          visible: _returnManualBatch.text.trim().isNotEmpty,
                          onPressed: () => setState(() => _returnManualBatch.clear()),
                        ),
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (_product!.locations.isNotEmpty)
                    ..._sortFefo(_product!.locations).map((PickerProductLocation loc) {
                      return ListTile(
                        title: Text(
                          '${StringLookup.t(appLoc, 'kirimFefoLocationPrefix')}${loc.locationCode}',
                        ),
                        subtitle: Text(
                          '${StringLookup.t(appLoc, 'kirimFefoQtyPrefix')}${loc.availableQty.toStringAsFixed(0)} · '
                          '${StringLookup.t(appLoc, 'kirimFefoExpiryPrefix')}${formatExpiryMonthYear(loc.expiryDate)}',
                        ),
                        tileColor: null,
                        onTap: () {
                          FocusManager.instance.primaryFocus?.unfocus();
                          setState(() {
                            _returnPick = loc;
                            _returnLineExpiry = loc.expiryDate;
                          });
                        },
                      );
                    }),
                  TextField(
                    controller: _qty,
                    keyboardType: kStockQtyKeyboardType,
                    inputFormatters: kStockQtyInputFormatters,
                    decoration: InputDecoration(
                      labelText: StringLookup.t(appLoc, 'qtyShort'),
                      border: const OutlineInputBorder(),
                      suffixIcon: buildInputClearButton(
                        visible: _qty.text.trim().isNotEmpty,
                        onPressed: () => setState(() => _qty.clear()),
                      ),
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: 12),
                  ExpiryDatePickerField(
                    value: _returnLineExpiry,
                    onChanged: (String? v) => setState(() => _returnLineExpiry = v),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: !_canPressAddLineReturn()
                        ? null
                        : () => unawaited(_addLineReturn()),
                    child: Text(StringLookup.t(appLoc, 'kirimAddLine')),
                  ),
                ],
                if (_flow == 'new' && _newReceiveMode == 'byProduct')
                  Stack(
                    children: <Widget>[
                      AbsorbPointer(
                        absorbing: _product == null,
                        child: Opacity(
                          opacity: _product == null ? 0.45 : 1,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: <Widget>[
                              _kirimNewPutawayFieldsOnly(appLoc),
                              const SizedBox(height: 16),
                              const Divider(height: 1),
                              const SizedBox(height: 16),
                              _kirimNewExpiryQtyCard(appLoc),
                            ],
                          ),
                        ),
                      ),
                      if (_product == null)
                        Positioned.fill(
                          child: GestureDetector(
                            behavior: HitTestBehavior.translucent,
                            onTap: () {
                              showAppSnackBar(
                                context,
                                SnackBar(
                                  content: Text(StringLookup.t(appLoc, 'kirimSelectProductFirst')),
                                ),
                              );
                            },
                          ),
                        ),
                    ],
                  ),
                if (_flow == 'return') ...<Widget>[
                  const Divider(height: 24),
                  Text(
                    StringLookup.tParams(
                      appLoc,
                      'kirimLinesHeading',
                      <String, String>{'count': '${_lines.length}'},
                    ),
                  ),
                  ..._lines.map(
                    (_FormLine l) => ListTile(
                      title: Text(l.productName),
                      subtitle: Text(
                        '${(l.locationCode == null || l.locationCode!.isEmpty) ? "Lokatsiya: picker tanlaydi" : l.locationCode} · ${l.qty} · ${l.batch}',
                      ),
                      trailing: IconButton(
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () => setState(() => _lines.remove(l)),
                      ),
                    ),
                  ),
                ],
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
                      : Text(
                          _flow == 'return'
                              ? StringLookup.t(appLoc, 'submit')
                              : StringLookup.t(appLoc, 'kirimCompleteReceiving'),
                        ),
                ),
              ],
            );

    final bool lockBackToKirimNew = _flow == 'new';
    final bool lockBackToKirimReturn = _flow == 'return';
    return PopScope(
      canPop: !(lockBackToKirimNew || lockBackToKirimReturn),
      onPopInvokedWithResult: (bool didPop, Object? result) {
        if (!didPop && lockBackToKirimNew) {
          _onNewFlowBack();
        }
        if (!didPop && lockBackToKirimReturn) {
          _onReturnFlowBack();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(title),
          leading: lockBackToKirimNew
              ? IconButton(
                  icon: const Icon(Icons.arrow_back),
                  onPressed: _onNewFlowBack,
                )
              : lockBackToKirimReturn
                  ? IconButton(
                      icon: const Icon(Icons.arrow_back),
                      onPressed: _onReturnFlowBack,
                    )
                  : null,
          actions: <Widget>[
            if (_flow == 'new' && _newReceiveMode == 'byLocation')
              TextButton(
                onPressed: _clearPutawayForNewMode,
                child: Text(StringLookup.t(appLoc, 'kirimChangePutawayLocation')),
              ),
          ],
        ),
        body: body,
      ),
    );
  }
}

