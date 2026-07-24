import 'dart:async' show Timer, unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../../../core/config/brand.dart';
import '../../../core/theme/app_colors.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/errors/api_error_localization.dart';
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
  final TextEditingController _newReceiveBoxCount = TextEditingController();
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

  /// Bir sahifali inventarizatsiya holati: 'idle' | 'location' | 'product'.
  String _invView = 'idle';
  String _invWarehouse = 'main';
  List<PickerLocationOption> _invAllLocations = const <PickerLocationOption>[];
  final TextEditingController _invManualInput = TextEditingController();
  PickerLocationOption? _invLocation;
  LocationContentsResponse? _invContents;
  bool _invLoadingContents = false;
  String? _invContentsError;
  final Map<String, String> _invActualQty = <String, String>{};
  final Map<String, TextEditingController> _invQtyCtrls = <String, TextEditingController>{};
  /// Holat 2: karobka paneli ochilgan qator kaliti (`productId-lotId`).
  String? _invExpandedBoxKey;
  _InvLocGroup? _invScanSelectedGroup;
  bool _invSubmitting = false;
  bool _invResolving = false;
  /// Jonli qidiruv (idle input): mahsulot takliflari + debounce.
  Timer? _invSearchDebounce;
  List<PickerInventoryItem> _invSearchProducts = const <PickerInventoryItem>[];
  bool _invSearchLoading = false;
  int _invSearchSeq = 0;
  String? _invHandledLocationStr;
  List<String> _invRecentLocations = <String>[];
  bool _invRecentsLoaded = false;

  Color get _invAccent => context.colors.accentFg;
  Color get _invLink => context.colors.link;
  Color get _invPageBg => context.colors.pageBg;
  Color get _invTextMain => context.colors.textMain;
  Color get _invTextSecondary => context.colors.textSecondary;
  Color get _invTextFaded => context.colors.textFaded;
  Color get _invTint => context.colors.accentTint;
  Color get _invRedText => context.colors.danger;
  Color get _invRedBg => context.colors.dangerBg;
  Color get _invGreenText => context.colors.success;
  Color get _invGreenBg => context.colors.successBg;
  Color get _invGreenBorder => context.colors.successBorder;
  Color get _invHairline => context.colors.hairline;
  static const String _invRecentsPrefsKey = 'inv_recent_locations';

  @override
  void dispose() {
    _customerDebounce?.cancel();
    _invSearchDebounce?.cancel();
    _customerSearchController.dispose();
    _invManualInput.dispose();
    for (final TextEditingController c in _invQtyCtrls.values) {
      c.dispose();
    }
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
          _productError = localizeApiErrorMessage(ref.read(appLocaleProvider), e);
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
    _newReceiveBoxCount.clear();
  }

  void _onNewReceiveBoxBarcodeChanged(String value) {
    final String trimmed = value.trim();
    setState(() {
      if (_newReceiveResolvedBoxBarcode != null &&
          trimmed != _newReceiveResolvedBoxBarcode) {
        _newReceiveResolvedBoxBarcode = null;
        _newReceiveUnitsPerBox = null;
        _newReceiveBoxCount.clear();
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
            icon: Icon(Icons.check, color: context.colors.accentFg),
          ),
        buildInputClearButton(
          visible: true,
          onPressed: () => setState(() {
            _newReceiveBoxBarcode.clear();
            _newReceiveResolvedBoxBarcode = null;
            _newReceiveUnitsPerBox = null;
            _newReceiveBoxCount.clear();
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
            style: TextStyle(fontSize: 13, color: context.colors.textSecondary),
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
              color: unitsPerBox != null ? null : context.colors.textFaded,
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
                  _newReceiveBoxCount.text.trim().isNotEmpty,
              onPressed: () => setState(() => _newReceiveBoxCount.clear()),
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
    // Eski deep-link paramlar (inventoryStep/subMode ham) yangi bir sahifali
    // holatga map qilinadi: lokatsiya bo'lsa — lokatsiya, aks holda mahsulot.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      if (lid != null && lid.isNotEmpty && lcode != null && lcode.isNotEmpty) {
        _invOpenLocation(
          PickerLocationOption(
            id: lid,
            code: lcode,
            name: lcode,
            zoneType: null,
            expiredSlot: null,
            expiredDisplayLabel: null,
          ),
        );
      } else if (pid != null && pid.isNotEmpty) {
        _invOpenProduct(pid);
      }
      GoRouter.of(context).goNamed(
        'kirimForm',
        queryParameters: <String, String>{'flow': 'inventory'},
      );
      _invHandledLocationStr = null;
    });
  }

  Future<void> _loadInvRecents() async {
    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final List<String> list =
          prefs.getStringList(_invRecentsPrefsKey) ?? const <String>[];
      if (mounted) {
        setState(() {
          _invRecentLocations = list;
          _invRecentsLoaded = true;
        });
      }
    } on Exception {
      if (mounted) {
        setState(() => _invRecentsLoaded = true);
      }
    }
  }

  Future<void> _saveInvRecent(String code) async {
    final String c = code.trim();
    if (c.isEmpty) {
      return;
    }
    final List<String> next = <String>[
      c,
      ..._invRecentLocations.where((String e) => e != c),
    ].take(5).toList(growable: false);
    setState(() => _invRecentLocations = next);
    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(_invRecentsPrefsKey, next);
    } on Exception {
      // Lokal saqlash muvaffaqiyatsiz bo'lsa ham oqim davom etadi.
    }
  }

  /// Jonli qidiruv: harf kiritilishi bilan joy (lokal) + mahsulot (API, debounce)
  /// takliflari dropdown'da ko'rsatiladi.
  void _invOnManualInputChanged(String v) {
    _invSearchDebounce?.cancel();
    final String q = v.trim();
    if (q.isEmpty) {
      setState(() {
        _invSearchProducts = const <PickerInventoryItem>[];
        _invSearchLoading = false;
      });
      return;
    }
    if (q.length < 2) {
      // Joy takliflari lokal — darhol; mahsulot qidiruvi 2+ belgidan.
      setState(() {
        _invSearchProducts = const <PickerInventoryItem>[];
        _invSearchLoading = false;
      });
      return;
    }
    setState(() => _invSearchLoading = true);
    _invSearchDebounce = Timer(
      const Duration(milliseconds: 350),
      () => unawaited(_invLoadProductSuggestions(q)),
    );
  }

  Future<void> _invLoadProductSuggestions(String q) async {
    final int seq = ++_invSearchSeq;
    try {
      final PickerInventoryListResponse res = await ref
          .read(inventoryRepositoryProvider)
          .listPickerInventory(q: q, limit: 6);
      if (!mounted || seq != _invSearchSeq) {
        return;
      }
      setState(() {
        _invSearchProducts = res.items;
        _invSearchLoading = false;
      });
    } on Exception {
      if (!mounted || seq != _invSearchSeq) {
        return;
      }
      setState(() {
        _invSearchProducts = const <PickerInventoryItem>[];
        _invSearchLoading = false;
      });
    }
  }

  List<PickerLocationOption> _invLocationSuggestions() {
    final String q = _invManualInput.text.trim().toLowerCase();
    if (q.isEmpty) {
      return const <PickerLocationOption>[];
    }
    return _invAllLocations
        .where((PickerLocationOption l) =>
            l.code.toLowerCase().contains(q) || l.name.toLowerCase().contains(q))
        .take(6)
        .toList(growable: false);
  }

  void _invClearSearchState() {
    _invSearchDebounce?.cancel();
    _invSearchSeq++;
    _invManualInput.clear();
    _invSearchProducts = const <PickerInventoryItem>[];
    _invSearchLoading = false;
  }

  /// Universal kirish: kod lokatsiyami yoki mahsulot barkodimi — o'zi aniqlaydi.
  Future<void> _invHandleCode(String raw) async {
    final String code = raw.trim();
    if (code.isEmpty || _invResolving) {
      return;
    }
    setState(() => _invResolving = true);
    try {
      // 1) Lokatsiya kodi bo'yicha (joriy ombor ro'yxatidan).
      if (_invAllLocations.isEmpty) {
        await _loadInvLocations();
      }
      final String n = code.toLowerCase();
      PickerLocationOption? loc;
      for (final PickerLocationOption l in _invAllLocations) {
        if (l.code.toLowerCase() == n) {
          loc = l;
          break;
        }
      }
      if (loc != null) {
        _invManualInput.clear();
        _invOpenLocation(loc);
        return;
      }
      // 2) Mahsulot barkodi/SKU sifatida resolve.
      final PickerInventoryListResponse res = await ref
          .read(inventoryRepositoryProvider)
          .listPickerInventory(q: code, limit: 10);
      final List<PickerInventoryItem> items = res.items;
      if (items.isEmpty) {
        if (mounted) {
          showAppSnackBar(
            context,
            SnackBar(
              content: Text(
                StringLookup.t(ref.read(appLocaleProvider), 'codeNotFound'),
              ),
            ),
          );
        }
        return;
      }
      PickerInventoryItem chosen;
      if (items.length == 1) {
        chosen = items.first;
      } else {
        // Aniq mos (barkod yoki SKU) bo'lsa — o'sha; aks holda tanlov sheet.
        final PickerInventoryItem? exact = items
            .where((PickerInventoryItem i) =>
                (i.mainBarcode ?? '').trim() == code || i.code.trim() == code)
            .firstOrNull;
        if (exact != null) {
          chosen = exact;
        } else {
          final PickerInventoryItem? picked = await _invShowProductPickSheet(items);
          if (picked == null) {
            return;
          }
          chosen = picked;
        }
      }
      _invManualInput.clear();
      _invOpenProduct(chosen.productId);
    } on Exception catch (e) {
      if (mounted) {
        showAppSnackBar(
          context,
          SnackBar(
            content: Text(
              localizeApiErrorMessage(ref.read(appLocaleProvider), e),
            ),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _invResolving = false);
      }
    }
  }

  Future<PickerInventoryItem?> _invShowProductPickSheet(
    List<PickerInventoryItem> items,
  ) {
    return showModalBottomSheet<PickerInventoryItem>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) {
        return SafeArea(
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.sizeOf(ctx).height * 0.55,
            ),
            child: ListView(
              shrinkWrap: true,
              children: items.map((PickerInventoryItem i) {
                return ListTile(
                  title: Text(i.name, maxLines: 2, overflow: TextOverflow.ellipsis),
                  subtitle: Text(
                    <String>[
                      if ((i.mainBarcode ?? '').trim().isNotEmpty) i.mainBarcode!.trim(),
                      i.code,
                    ].join(' · '),
                  ),
                  onTap: () => Navigator.of(ctx).pop(i),
                );
              }).toList(growable: false),
            ),
          ),
        );
      },
    );
  }

  void _invOpenLocation(PickerLocationOption loc) {
    setState(() {
      _invClearSearchState();
      _invView = 'location';
      _invLocation = loc;
      _invExpandedBoxKey = null;
      _product = null;
      _productError = null;
      _invScanSelectedGroup = null;
    });
    unawaited(_refreshInvLocationContents());
  }

  void _invOpenProduct(String productId) {
    setState(() {
      _invClearSearchState();
      _invView = 'product';
      _invScanSelectedGroup = null;
      _invLocation = null;
      _invContents = null;
      _invContentsError = null;
    });
    unawaited(_loadProduct(productId));
  }

  void _invResetToIdle() {
    setState(() {
      _invClearSearchState();
      _invView = 'idle';
      _invLocation = null;
      _invContents = null;
      _invContentsError = null;
      _invActualQty.clear();
      _invExpandedBoxKey = null;
      _product = null;
      _productError = null;
      _invScanSelectedGroup = null;
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
          for (final TextEditingController c in _invQtyCtrls.values) {
            c.clear();
          }
          _invLoadingContents = false;
        });
      }
    } on Exception catch (e) {
      if (mounted) {
        setState(() {
          _invContentsError =
              localizeApiErrorMessage(ref.read(appLocaleProvider), e);
          _invLoadingContents = false;
        });
      }
    }
  }

  void _onInventoryBack() {
    if (_invView == 'idle') {
      context.goNamed('kirim');
      return;
    }
    // Ichki holatlar (lokatsiya/mahsulot ichida) — avval yoyilganini yopish.
    if (_invView == 'location' && _invExpandedBoxKey != null) {
      setState(() => _invExpandedBoxKey = null);
      return;
    }
    if (_invView == 'product' && _invScanSelectedGroup != null) {
      setState(() => _invScanSelectedGroup = null);
      return;
    }
    _invResetToIdle();
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
    // Universal skan: xom kod qaytadi, turi (lokatsiya/mahsulot) shu yerda aniqlanadi.
    final String? raw = await _scanRawBarcode();
    if (!mounted || raw == null || raw.trim().isEmpty) {
      return;
    }
    await _invHandleCode(raw);
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
          // Muvaffaqiyat: oxirgi lokatsiya chipga qo'shiladi, 1-holatga qaytish.
          final String? code = _invLocation?.code;
          if (code != null) {
            unawaited(_saveInvRecent(code));
          }
          _invResetToIdle();
        }
      }
    } finally {
      if (mounted) {
        setState(() => _invSubmitting = false);
      }
    }
  }

  /// Inventarizatsiya (lokatsiya tarkibi) meta: SKU · muddat.
  String _invContentsItemMetaLine(LocationContentsItem item) {
    final List<String> parts = <String>[];
    if (item.productCode.trim().isNotEmpty) {
      parts.add('SKU: ${item.productCode.trim()}');
    }
    if (item.expiryDate != null && item.expiryDate!.trim().isNotEmpty) {
      parts.add(formatExpiryMonthYear(item.expiryDate));
    }
    return parts.join(' · ');
  }

  PickerProductLocation _invScanPackLot(_InvLocGroup group) {
    return group.lots.firstWhere(
      (PickerProductLocation l) => l.boxCount > 0,
      orElse: () => group.primary,
    );
  }

  // ---------------------------------------------------------------------
  // Inventarizatsiya — bir sahifali (rejimsiz) UI
  // ---------------------------------------------------------------------

  String get _invWarehouseLabel =>
      _invWarehouse == 'showroom' ? 'Showroom' : 'Asosiy ombor';

  /// Navy header: sarlavha + (idle: ombor segmenti | aks holda: skan tugmasi).
  Widget _invHeader() {
    return Container(
      color: Brand.pickerHeaderNavy,
      padding: const EdgeInsets.fromLTRB(4, 6, 12, 12),
      child: SafeArea(
        bottom: false,
        child: Row(
          children: <Widget>[
            IconButton(
              icon: const Icon(Icons.arrow_back, color: Colors.white),
              onPressed: _onInventoryBack,
            ),
            const Expanded(
              child: Text(
                'Inventarizatsiya',
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
            ),
            if (_invView != 'idle') _invHeaderScanButton(),
          ],
        ),
      ),
    );
  }

  /// Ombor segmenti — idle sahifa yuqorisida (headerda emas), to'liq enli.
  Widget _invWarehouseBodySegment() {
    Widget seg(String value, String label) {
      final bool active = _invWarehouse == value;
      return Expanded(
        child: InkWell(
          borderRadius: BorderRadius.circular(9),
          onTap: () {
            if (_invWarehouse == value) {
              return;
            }
            setState(() {
              _invWarehouse = value;
              _invAllLocations = const <PickerLocationOption>[];
            });
            unawaited(_loadInvLocations());
          },
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 10),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: active ? context.colors.accent : Colors.transparent,
              borderRadius: BorderRadius.circular(9),
            ),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: active ? Colors.white : _invTextSecondary,
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: context.colors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _invHairline),
      ),
      child: Row(
        children: <Widget>[
          seg('main', 'Asosiy ombor'),
          seg('showroom', 'Showroom'),
        ],
      ),
    );
  }

  Widget _invHeaderScanButton() {
    return Material(
      color: Colors.white.withValues(alpha: .14),
      borderRadius: BorderRadius.circular(9),
      child: InkWell(
        borderRadius: BorderRadius.circular(9),
        onTap: _openInventoryScanner,
        child: const Padding(
          padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(Icons.qr_code_scanner, size: 18, color: Colors.white),
              SizedBox(width: 6),
              Text(
                'Skanerlash',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Colors.white),
              ),
            ],
          ),
        ),
      ),
    );
  }

  BoxDecoration _invCardDecoration({Color? borderColor}) {
    return BoxDecoration(
      color: context.colors.surface,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: borderColor ?? context.colors.hairline),
      boxShadow: <BoxShadow>[
        BoxShadow(
          color: Colors.black.withValues(alpha: .05),
          blurRadius: 10,
          offset: const Offset(0, 3),
        ),
      ],
    );
  }

  // -------------------- Holat 1: kirish (idle) --------------------

  Widget _invIdleView() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      children: <Widget>[
        _invWarehouseBodySegment(),
        const SizedBox(height: 14),
        Container(
          decoration: _invCardDecoration(),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
          child: Column(
            children: <Widget>[
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  color: _invAccent.withValues(alpha: .10),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Icon(Icons.qr_code_scanner, size: 32, color: _invAccent),
              ),
              const SizedBox(height: 14),
              Text(
                'Skanerlashdan boshlang',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: _invTextMain),
              ),
              const SizedBox(height: 4),
              Text(
                "Bo'lim tanlash shart emas — tizim kodni o'zi aniqlaydi",
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: _invTextSecondary),
              ),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: context.colors.accent,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13)),
                  ),
                  onPressed: _invResolving ? null : _openInventoryScanner,
                  icon: const Icon(Icons.qr_code_scanner),
                  label: const Text(
                    'Skanerlash',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: <Widget>[
                  Expanded(child: Divider(color: _invHairline)),
                  Padding(
                    padding: EdgeInsets.symmetric(horizontal: 10),
                    child: Text(
                      "yoki qo'lda",
                      style: TextStyle(fontSize: 12, color: _invTextFaded),
                    ),
                  ),
                  Expanded(child: Divider(color: _invHairline)),
                ],
              ),
              const SizedBox(height: 12),
              SizedBox(
                height: 48,
                child: TextField(
                  controller: _invManualInput,
                  textCapitalization: TextCapitalization.characters,
                  style: TextStyle(fontSize: 15, color: _invTextMain),
                  decoration: InputDecoration(
                    hintText: 'Lokatsiya kodi yoki barkod',
                    hintStyle: TextStyle(fontSize: 14, color: _invTextFaded),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(color: _invHairline, width: 1.5),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(color: _invAccent, width: 1.5),
                    ),
                    suffixIcon: _invResolving
                        ? const Padding(
                            padding: EdgeInsets.all(12),
                            child: SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                          )
                        : IconButton(
                            icon: Icon(Icons.arrow_forward, color: _invAccent),
                            onPressed: () => unawaited(_invHandleCode(_invManualInput.text)),
                          ),
                  ),
                  textInputAction: TextInputAction.search,
                  onChanged: _invOnManualInputChanged,
                  onSubmitted: (String v) => unawaited(_invHandleCode(v)),
                ),
              ),
              _invSearchDropdown(),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _invHintRow(
          chipText: 'A1',
          chipColor: _invGreenText,
          chipBg: _invGreenBg,
          text: 'Lokatsiya kodi → joy tarkibi va sanoq ochiladi',
        ),
        const SizedBox(height: 8),
        _invHintRow(
          chipText: '▦',
          chipColor: _invAccent,
          chipBg: _invTint,
          text: 'Mahsulot barkodi → uning joylari ochiladi',
        ),
        if (_invRecentLocations.isNotEmpty) ...<Widget>[
          const SizedBox(height: 20),
          Text(
            'Oxirgi lokatsiyalar',
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: _invTextSecondary),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _invRecentLocations.map((String code) {
              return Material(
                color: context.colors.surface,
                borderRadius: BorderRadius.circular(20),
                child: InkWell(
                  borderRadius: BorderRadius.circular(20),
                  onTap: _invResolving ? null : () => unawaited(_invHandleCode(code)),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: _invHairline),
                    ),
                    child: Text(
                      code,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: _invTextMain,
                      ),
                    ),
                  ),
                ),
              );
            }).toList(growable: false),
          ),
        ],
      ],
    );
  }

  /// Jonli qidiruv dropdown'i: joylar (lokal) + mahsulotlar (API).
  Widget _invSearchDropdown() {
    final String q = _invManualInput.text.trim();
    if (q.isEmpty) {
      return const SizedBox.shrink();
    }
    final List<PickerLocationOption> locs = _invLocationSuggestions();
    final bool showProducts = _invSearchLoading || _invSearchProducts.isNotEmpty;
    if (locs.isEmpty && !showProducts) {
      return const SizedBox.shrink();
    }

    Widget sectionLabel(String text) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
        child: Text(
          text,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w800,
            color: _invTextFaded,
            letterSpacing: .4,
          ),
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.only(top: 8),
      constraints: const BoxConstraints(maxHeight: 280),
      decoration: BoxDecoration(
        color: context.colors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _invHairline),
      ),
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.only(bottom: 6),
        children: <Widget>[
          if (locs.isNotEmpty) sectionLabel('JOYLAR'),
          ...locs.map((PickerLocationOption l) {
            return ListTile(
              dense: true,
              visualDensity: VisualDensity.compact,
              leading: Icon(Icons.location_on_outlined, size: 20, color: _invAccent),
              title: Text(
                l.code,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: _invTextMain,
                ),
              ),
              subtitle: l.name.isNotEmpty && l.name != l.code
                  ? Text(
                      l.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12, color: _invTextSecondary),
                    )
                  : null,
              onTap: () => _invOpenLocation(l),
            );
          }),
          if (showProducts) sectionLabel('MAHSULOTLAR'),
          if (_invSearchLoading)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              child: LinearProgressIndicator(minHeight: 2),
            ),
          ..._invSearchProducts.map((PickerInventoryItem i) {
            final String meta = <String>[
              if ((i.mainBarcode ?? '').trim().isNotEmpty) i.mainBarcode!.trim(),
              if (i.code.trim().isNotEmpty) i.code.trim(),
            ].join(' · ');
            return ListTile(
              dense: true,
              visualDensity: VisualDensity.compact,
              leading: Icon(Icons.inventory_2_outlined, size: 20, color: _invAccent),
              title: Text(
                i.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: _invTextMain),
              ),
              subtitle: meta.isEmpty
                  ? null
                  : Text(
                      meta,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12, color: _invTextSecondary),
                    ),
              onTap: () => _invOpenProduct(i.productId),
            );
          }),
        ],
      ),
    );
  }

  Widget _invHintRow({
    required String chipText,
    required Color chipColor,
    required Color chipBg,
    required String text,
  }) {
    return Row(
      children: <Widget>[
        Container(
          width: 28,
          height: 28,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: chipBg,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            chipText,
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: chipColor),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            text,
            style: TextStyle(fontSize: 12.5, color: _invTextSecondary),
          ),
        ),
      ],
    );
  }

  // -------------------- Holat 2: lokatsiya (sanoq) --------------------

  TextEditingController _invQtyCtrl(String key) {
    return _invQtyCtrls.putIfAbsent(
      key,
      () => TextEditingController(text: _invActualQty[key] ?? ''),
    );
  }

  void _invSetActual(String key, String value) {
    setState(() => _invActualQty[key] = value);
  }

  void _invStepQty(LocationContentsItem item, String key, int delta) {
    final TextEditingController c = _invQtyCtrl(key);
    final String cur = c.text.trim();
    int next;
    if (cur.isEmpty) {
      // Birinchi tegishda tizim qiymatidan boshlanadi.
      next = item.availableQty.round() + delta;
    } else {
      next = (int.tryParse(cur) ?? 0) + delta;
    }
    if (next < 0) {
      next = 0;
    }
    c.text = '$next';
    _invSetActual(key, '$next');
  }

  Widget _invLocationView() {
    final LocationContentsResponse? contents = _invContents;
    final List<LocationContentsItem> items =
        contents?.items ?? const <LocationContentsItem>[];
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      children: <Widget>[
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: _invAccent.withValues(alpha: .08),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: _invAccent.withValues(alpha: .22)),
          ),
          child: Row(
            children: <Widget>[
              Icon(Icons.location_on_outlined, size: 22, color: _invAccent),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      _invLocation?.code ?? '—',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: _invAccent,
                      ),
                    ),
                    Text(
                      '$_invWarehouseLabel · ${items.length} mahsulot',
                      style: TextStyle(fontSize: 12, color: _invTextSecondary),
                    ),
                  ],
                ),
              ),
              InkWell(
                borderRadius: BorderRadius.circular(8),
                onTap: _invResetToIdle,
                child: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                  child: Text(
                    'Almashtirish',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: _invLink),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        if (_invLoadingContents) const LinearProgressIndicator(),
        if (_invContentsError != null)
          Text(_invContentsError!, style: TextStyle(color: _invRedText)),
        if (!_invLoadingContents && contents != null && items.isEmpty)
          Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(
              child: Text(
                "Bu lokatsiyada mahsulot yo'q",
                style: TextStyle(color: _invTextSecondary),
              ),
            ),
          ),
        ...items.map(_invLocationItemCard),
      ],
    );
  }

  Widget _invLocationItemCard(LocationContentsItem item) {
    final String key = '${item.productId}-${item.lotId}';
    final int systemQty = item.availableQty.round();
    final String actualStr = (_invActualQty[key] ?? '').trim();
    final int? actual = actualStr.isEmpty ? null : int.tryParse(actualStr);
    final int? diff = actual == null ? null : actual - systemQty;
    final bool boxOpen = _invExpandedBoxKey == key;

    Color? borderColor;
    if (diff != null && diff != 0) {
      borderColor = _invAccent.withValues(alpha: .35);
    } else if (diff == 0) {
      borderColor = _invGreenBorder;
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: _invCardDecoration(borderColor: borderColor),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            item.productName,
            style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700, color: _invTextMain),
          ),
          const SizedBox(height: 3),
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  _invContentsItemMetaLine(item),
                  style: TextStyle(fontSize: 12, color: _invTextSecondary),
                ),
              ),
              InkWell(
                borderRadius: BorderRadius.circular(8),
                onTap: () => setState(() => _invExpandedBoxKey = boxOpen ? null : key),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
                  child: Text(
                    boxOpen ? "Karobka sanog'i ▲" : "Karobka sanog'i ▼",
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _invLink),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: <Widget>[
              Expanded(
                child: RichText(
                  text: TextSpan(
                    style: TextStyle(fontSize: 13, color: _invTextSecondary),
                    children: <InlineSpan>[
                      const TextSpan(text: 'Tizimda: '),
                      TextSpan(
                        text: '$systemQty',
                        style: TextStyle(fontWeight: FontWeight.w800, color: _invTextMain),
                      ),
                    ],
                  ),
                ),
              ),
              _invQtyStepper(item, key),
              const SizedBox(width: 8),
              _invDiffChip(diff),
            ],
          ),
          if (boxOpen) ...<Widget>[
            const SizedBox(height: 10),
            Divider(height: 1, color: _invHairline),
            const SizedBox(height: 10),
            InventorySimpleBoxPanel(
              key: ValueKey<String>('inv-box-$key'),
              productId: item.productId,
              locationId: item.locationId,
              lotId: item.lotId,
              onSaved: (_) {
                if (mounted) {
                  setState(() => _invExpandedBoxKey = null);
                }
                unawaited(_refreshInvLocationContents());
              },
            ),
          ],
        ],
      ),
    );
  }

  Widget _invQtyStepper(LocationContentsItem item, String key) {
    final TextEditingController c = _invQtyCtrl(key);
    Widget btn(IconData icon, int delta) {
      return InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: () => _invStepQty(item, key, delta),
        // Vizual 38×40, teginish maydoni 44 gacha kengaytirilgan.
        child: Container(
          width: 44,
          height: 44,
          alignment: Alignment.center,
          child: Container(
            width: 38,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: context.colors.surfaceAlt,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 18, color: _invTextMain),
          ),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: _invHairline),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          btn(Icons.remove, -1),
          SizedBox(
            width: 56,
            child: TextField(
              controller: c,
              textAlign: TextAlign.center,
              keyboardType: kStockQtyKeyboardType,
              inputFormatters: kStockQtyInputFormatters,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: _invTextMain,
                fontFeatures: <FontFeature>[FontFeature.tabularFigures()],
              ),
              decoration: InputDecoration(
                isDense: true,
                border: InputBorder.none,
                hintText: '—',
                hintStyle: TextStyle(color: _invTextFaded, fontWeight: FontWeight.w600),
                contentPadding: EdgeInsets.symmetric(vertical: 10),
              ),
              onChanged: (String v) => _invSetActual(key, v),
            ),
          ),
          btn(Icons.add, 1),
        ],
      ),
    );
  }

  Widget _invDiffChip(int? diff) {
    final String text;
    final Color fg;
    final Color bg;
    if (diff == null) {
      text = '·';
      fg = _invTextFaded;
      bg = context.colors.surfaceAlt;
    } else if (diff == 0) {
      text = '✓';
      fg = _invGreenText;
      bg = _invGreenBg;
    } else {
      text = diff > 0 ? '+$diff' : '$diff';
      fg = _invRedText;
      bg = _invRedBg;
    }
    return Container(
      constraints: const BoxConstraints(minWidth: 40),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
      alignment: Alignment.center,
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(9)),
      child: Text(
        text,
        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: fg),
      ),
    );
  }

  /// Pastki qotirilgan panel: «Sanaldi: X/Y · Farq: Δ» + yuborish tugmasi.
  Widget _invBottomPanel() {
    final List<LocationContentsItem> items =
        _invContents?.items ?? const <LocationContentsItem>[];
    int entered = 0;
    int totalDiff = 0;
    for (final LocationContentsItem item in items) {
      final String key = '${item.productId}-${item.lotId}';
      final String s = (_invActualQty[key] ?? '').trim();
      if (s.isEmpty) {
        continue;
      }
      final int? actual = int.tryParse(s);
      if (actual == null) {
        continue;
      }
      entered++;
      totalDiff += actual - item.availableQty.round();
    }
    final String diffLabel = totalDiff > 0 ? '+$totalDiff' : '$totalDiff';
    return Container(
      decoration: BoxDecoration(
        color: context.colors.surface,
        border: Border(top: BorderSide(color: _invHairline)),
      ),
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              'Sanaldi: $entered/${items.length} · Farq: $diffLabel',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: _invTextSecondary,
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: 50,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: context.colors.accent,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: entered == 0 || _invSubmitting
                    ? null
                    : () => unawaited(_submitInvByLocationAdjust()),
                child: _invSubmitting
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : Text(
                        'Tuzatishlarni yuborish ($entered)',
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // -------------------- Holat 3: mahsulot --------------------

  Widget _invProductView() {
    final PickerProductDetailResponse? p = _product;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      children: <Widget>[
        if (_loadingProduct) const LinearProgressIndicator(),
        if (_productError != null)
          Text(_productError!, style: TextStyle(color: _invRedText)),
        if (p != null && !_loadingProduct) ...<Widget>[
          Container(
            decoration: _invCardDecoration(),
            padding: const EdgeInsets.all(14),
            child: Row(
              children: <Widget>[
                Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(
                    color: _invTint,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(Icons.inventory_2_outlined, color: _invAccent),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        p.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w700,
                          color: _invTextMain,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        <String>[
                          if ((p.mainBarcode ?? '').trim().isNotEmpty) p.mainBarcode!.trim(),
                          if (p.code.trim().isNotEmpty) p.code.trim(),
                        ].join(' · '),
                        style: GoogleFonts.robotoMono(fontSize: 12, color: _invTextSecondary),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    Text('Jami', style: TextStyle(fontSize: 11, color: _invTextFaded)),
                    Text(
                      '${p.locations.fold<double>(0, (double s, PickerProductLocation l) => s + l.availableQty).round()}',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: _invAccent),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Text(
            'Tuzatish uchun joyni tanlang',
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: _invTextSecondary),
          ),
          const SizedBox(height: 8),
          if (p.locations.isEmpty)
            Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Text('Qoldiq topilmadi', style: TextStyle(color: _invTextSecondary)),
            )
          else
            ..._groupInvLocations(p.locations).map((_InvLocGroup g) => _invProductLocRow(p, g)),
          const SizedBox(height: 8),
          Center(
            child: TextButton(
              onPressed: _invResetToIdle,
              child: Text(
                'Boshqa mahsulot skanerlash',
                style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: _invLink),
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _invProductLocRow(PickerProductDetailResponse p, _InvLocGroup group) {
    final bool selected = _invScanSelectedGroup != null &&
        _invScanSelectedGroup!.locationId == group.locationId &&
        _invScanSelectedGroup!.expiryDate == group.expiryDate;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: _invCardDecoration(
        borderColor: selected ? _invAccent.withValues(alpha: .40) : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: () => setState(() {
              _invScanSelectedGroup = selected ? null : group;
            }),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
              child: Row(
                children: <Widget>[
                  Icon(Icons.location_on_outlined, size: 20, color: _invAccent),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          group.locationCode,
                          style: TextStyle(
                            fontSize: 14.5,
                            fontWeight: FontWeight.w700,
                            color: _invTextMain,
                          ),
                        ),
                        Text(
                          <String>[
                            'Qoldiq: ${group.totalAvailable.round()}',
                            if (formatExpiryMonthYear(group.expiryDate).isNotEmpty)
                              formatExpiryMonthYear(group.expiryDate),
                            if (group.boxCount > 0)
                              'Karobka: ${group.boxCount} (${group.unitsInBoxes} dona)',
                          ].join(' · '),
                          style: TextStyle(fontSize: 12, color: _invTextSecondary),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    selected ? Icons.expand_less : Icons.chevron_right,
                    color: _invTextFaded,
                  ),
                ],
              ),
            ),
          ),
          if (selected) ...<Widget>[
            Divider(height: 1, color: _invHairline),
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
              child: InventorySimpleBoxPanel(
                key: ValueKey<String>(
                  '${group.locationId}|${_invScanPackLot(group).lotId}',
                ),
                productId: p.productId,
                locationId: group.locationId,
                lotId: _invScanPackLot(group).lotId,
                initialBoxCount: group.boxCount,
                initialLooseQty: group.looseUnits,
                looseAdjustLots: group.lots,
                onSaved: (_) {
                  if (mounted) {
                    setState(() => _invScanSelectedGroup = null);
                  }
                  unawaited(_loadProduct(p.productId));
                },
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildInventoryBody() {
    if (_invAllLocations.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadInvLocations());
    }
    if (!_invRecentsLoaded) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadInvRecents());
    }
    switch (_invView) {
      case 'location':
        return _invLocationView();
      case 'product':
        return _invProductView();
      default:
        return _invIdleView();
    }
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
      final bool showBottomPanel = _invView == 'location' &&
          !_invLoadingContents &&
          (_invContents?.items.isNotEmpty ?? false);
      return PopScope(
        canPop: false,
        onPopInvokedWithResult: (bool didPop, Object? result) {
          if (!didPop) {
            _onInventoryBack();
          }
        },
        child: Theme(
          data: Theme.of(context).copyWith(
            textTheme: GoogleFonts.interTextTheme(Theme.of(context).textTheme),
          ),
          child: Scaffold(
            backgroundColor: _invPageBg,
            body: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                _invHeader(),
                Expanded(child: _buildInventoryBody()),
                if (showBottomPanel) _invBottomPanel(),
              ],
            ),
          ),
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
                      DropdownMenuItem<String>(
                        value: 'expired',
                        child: Text(StringLookup.t(appLoc, 'returnsReasonExpired')),
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
                  // Lokatsiya controllerga ko'rsatilmaydi — joy faqat yakunlash
                  // (complete) bosqichida tanlanadi. Bu yerda: partiya + miqdor +
                  // muddat. Muddat mahsulot yuklanganda FEFO'dan avtomatik
                  // to'ldiriladi (ko'rinmas holda), controller o'zgartira oladi.
                  if (_product!.locations.isEmpty) ...<Widget>[
                    Text(
                      StringLookup.t(appLoc, 'returnsNoStockInWarehouse'),
                      style: TextStyle(fontSize: 13, color: context.colors.textSecondary),
                    ),
                    const SizedBox(height: 12),
                  ],
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

