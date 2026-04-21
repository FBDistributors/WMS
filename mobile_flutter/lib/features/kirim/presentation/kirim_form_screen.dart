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
import '../../../shared/input/input_clear_button.dart';
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

/// RN `KirimFormScreen` — `return`, `new`, `inventory` (inventarizatsiya oqimi).
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
  final TextEditingController _qty = TextEditingController();
  String? _expiry;
  bool _loadingProduct = false;
  String? _productError;
  List<PickerLocationOption> _allLocations = const <PickerLocationOption>[];
  PickerLocationOption? _destLocation;
  String _receivingLocationCode = '';
  String? _receivingLocationId;
  final TextEditingController _batchNew = TextEditingController();
  final TextEditingController _kirimPutawaySearch = TextEditingController();
  bool _sending = false;
  String? _handledProductId;
  int _barcodeFieldKey = 0;

  final TextEditingController _customerSearchController = TextEditingController();
  Timer? _customerDebounce;
  List<GeneralCustomerRow> _customerSuggestions = <GeneralCustomerRow>[];
  bool _customerLoading = false;
  GeneralCustomerRow? _selectedCustomer;
  String? _returnLineExpiry;

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
  PickerProductLocation? _invScanSelectedLoc;
  final TextEditingController _invScanActualQty = TextEditingController();
  String? _invScanExpiry;
  bool _invSubmitting = false;
  String? _invHandledLocationStr;

  @override
  void dispose() {
    _customerDebounce?.cancel();
    _customerSearchController.dispose();
    _invLocSearch.dispose();
    _invScanActualQty.dispose();
    _batchNew.dispose();
    _kirimPutawaySearch.dispose();
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
      final String? rid = u.queryParameters['receivingLocationId'];
      _receivingLocationId = (rid != null && rid.isNotEmpty) ? rid : null;
      final String? qc = u.queryParameters['receivingLocationCode'];
      _receivingLocationCode = (qc != null && qc.isNotEmpty) ? qc : '';
    } else {
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
    setState(() {
      _loadingProduct = true;
      _productError = null;
      _product = null;
      _returnPick = null;
      _destLocation = null;
      _expiry = null;
      _batchNew.clear();
      _kirimPutawaySearch.clear();
      _qty.clear();
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
            final List<PickerProductLocation> sorted = _sortFefo(res.locations);
            _returnPick = sorted.first;
            _returnLineExpiry = sorted.first.expiryDate;
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
    final PickerProductLocation? pick = _returnPick;
    final int q = int.tryParse(_qty.text.trim()) ?? 0;
    if (p == null || pick == null) {
      return;
    }
    if (q < 1) {
      if (mounted) {
        final AppLocale loc = ref.read(appLocaleProvider);
        showAppSnackBar(
        context,
          SnackBar(content: Text(StringLookup.t(loc, 'kirimNewReceiveFillAll'))),
        );
      }
      return;
    }
    if (q > pick.availableQty.floor()) {
      final AppLocale loc = ref.read(appLocaleProvider);
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'kirimQtyExceedsStock'))),
      );
      return;
    }
    final String? lineExpiry = (_returnLineExpiry != null && _returnLineExpiry!.trim().isNotEmpty)
        ? _returnLineExpiry
        : pick.expiryDate;
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
          expiryDate: lineExpiry,
        ),
      );
      _product = null;
      _returnPick = null;
      _returnLineExpiry = null;
      _qty.clear();
      _productError = null;
      _loadingProduct = false;
      _handledProductId = null;
      _barcodeFieldKey++;
    });
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

  Future<void> _submitReturn() async {
    if (_lines.isEmpty || _sending) {
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
    setState(() => _sending = true);
    try {
      final String cname = (_selectedCustomer!.customerName != null &&
              _selectedCustomer!.customerName!.trim().isNotEmpty)
          ? _selectedCustomer!.customerName!.trim()
          : _selectedCustomer!.customerId;
      CustomerReturn doc = await ref.read(customerReturnsRepositoryProvider).createCustomerReturn(
            customerId: _selectedCustomer!.customerId,
            customerName: cname,
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
        showAppSnackBar(context, SnackBar(content: Text('$e')));
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
    final int q = int.tryParse(_qty.text.trim()) ?? 0;
    final String batchTrim = _batchNew.text.trim();
    final String? exp = _expiry?.trim();

    if (p == null || loc == null) {
      showFillAll();
      return;
    }
    if (exp == null || exp.isEmpty) {
      showFillAll();
      return;
    }
    if (batchTrim.isEmpty) {
      showFillAll();
      return;
    }
    if (_qty.text.trim().isEmpty || q < 1) {
      showFillAll();
      return;
    }

    final String batch = batchTrim;
    setState(() => _sending = true);
    try {
      final receipt = await ref.read(receivingRepositoryProvider).createReceipt(
            lines: <ReceiptLineCreate>[
              ReceiptLineCreate(
                productId: p.productId,
                qty: q,
                batch: batch,
                locationId: loc.id,
                expiryDate: _expiry,
              ),
            ],
          );
      await ref.read(receivingRepositoryProvider).completeReceipt(receipt.id);
      if (mounted) {
        final AppLocale loc = ref.read(appLocaleProvider);
        await showDialog<void>(
          context: context,
          builder: (BuildContext ctx) {
            return AlertDialog(
              content: Text(StringLookup.t(loc, 'kirimSingleReceiveSuccess')),
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
    } on Exception catch (e) {
      if (mounted) {
        showAppSnackBar(context, SnackBar(content: Text('$e')));
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
            _invScanSelectedLoc = null;
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
          _invScanSelectedLoc = null;
          _productError = null;
        }
      });
      return;
    }
    if (_invStep == 3) {
      setState(() {
        _invStep = 2;
        if (_invSubMode == 'byScan') {
          _invScanSelectedLoc = null;
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
    final bool byLoc = _invSubMode == 'byLocation' && _invLocation != null;
    context.pushNamed(
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
  }

  void _invSelectProductFromBarcode(String productId) {
    setState(() {
      _invSubMode = 'byScan';
      _invStep = 2;
      _invScanSelectedLoc = null;
    });
    unawaited(_loadProduct(productId));
  }

  Future<void> _submitInvByLocationAdjust() async {
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
            const SnackBar(content: Text('Inventarizatsiya uchun ruxsat yo‘q')),
          );
        } else if (hadError) {
          showAppSnackBar(
        context,
            const SnackBar(content: Text('Ayrim qatorlar yuborilmadi')),
          );
        } else if (sent.isNotEmpty) {
          showAppSnackBar(
        context,
            const SnackBar(content: Text('Saqlandi')),
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

  Future<void> _submitInvScanAdjust(PickerProductLocation loc) async {
    final PickerProductDetailResponse? p = _product;
    if (p == null || _invSubmitting) {
      return;
    }
    final int actual = int.tryParse(_invScanActualQty.text.trim()) ?? 0;
    final double delta = actual.toDouble() - loc.availableQty;
    if (delta == 0) {
      showAppSnackBar(
        context,
        const SnackBar(content: Text('O‘zgarish yo‘q')),
      );
      return;
    }
    setState(() => _invSubmitting = true);
    try {
      await ref.read(movementsRepositoryProvider).createStockMovement(
            productId: p.productId,
            lotId: loc.lotId,
            locationId: loc.locationId,
            qtyChange: delta,
            reasonCode: delta < 0 ? 'inventory_shortage' : 'inventory_overage',
          );
      if (mounted) {
        showAppSnackBar(
        context,
          const SnackBar(content: Text('Tuzatildi')),
        );
        setState(() {
          _invScanSelectedLoc = null;
          _invScanActualQty.clear();
          _invScanExpiry = null;
          _invStep = 2;
        });
        await _loadProduct(p.productId);
      }
    } on StockMovementForbiddenException {
      if (mounted) {
        showAppSnackBar(
        context,
          const SnackBar(content: Text('Inventarizatsiya uchun ruxsat yo‘q')),
        );
      }
    } on Exception catch (e) {
      if (mounted) {
        showAppSnackBar(context, SnackBar(content: Text('$e')));
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
    parts.add('Tizim: ${item.availableQty.round()}');
    return parts.join(' • ');
  }

  /// Skan rejimi: lokatsiya qatori — mahsulot shtrix/SKU + muddat + tizim (`batch_no` yo‘q).
  String _invScanLocationSubtitle(PickerProductDetailResponse p, PickerProductLocation loc) {
    final List<String> parts = <String>[];
    final String? bc = p.mainBarcode?.trim();
    if (bc != null && bc.isNotEmpty) {
      parts.add(bc);
    }
    final String code = p.code.trim();
    if (code.isNotEmpty) {
      parts.add(code);
    }
    if (loc.expiryDate != null && loc.expiryDate!.trim().isNotEmpty) {
      parts.add(formatExpiryMonthYear(loc.expiryDate));
    }
    parts.add('Tizim: ${loc.availableQty.round()}');
    return parts.join(' • ');
  }

  Widget _buildInventoryBody() {
    if (_invAllLocations.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadInvLocations());
    }
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
              _invScanSelectedLoc = null;
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
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
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
            ..._product!.locations.map((PickerProductLocation loc) {
              return ListTile(
                title: Text(loc.locationCode),
                subtitle: Text(
                  _invScanLocationSubtitle(_product!, loc),
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () {
                  setState(() {
                    _invScanSelectedLoc = loc;
                    _invScanActualQty.text = '${loc.availableQty.round()}';
                    _invScanExpiry = loc.expiryDate;
                    _invStep = 3;
                  });
                },
              );
            }),
          TextButton(
            onPressed: () => setState(() {
              _product = null;
              _invStep = 1;
            }),
            child: const Text('Boshqa mahsulot skanerlash'),
          ),
        ],
        if (_invSubMode == 'byScan' &&
            _invStep == 3 &&
            _product != null &&
            _invScanSelectedLoc != null) ...<Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  _invScanSelectedLoc!.locationCode,
                  style: const TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF1565C0)),
                ),
              ),
              TextButton(
                onPressed: () => setState(() {
                  _invStep = 2;
                  _invScanSelectedLoc = null;
                }),
                child: const Text('Almashtirish'),
              ),
            ],
          ),
          ProductCard(
            title: _product!.name,
            subtitle: _product!.code,
            barcode: _product!.mainBarcode,
          ),
          Text('Tizim: ${_invScanSelectedLoc!.availableQty.round()}',
              style: const TextStyle(fontWeight: FontWeight.w500)),
          TextField(
            controller: _invScanActualQty,
            keyboardType: kStockQtyKeyboardType,
            inputFormatters: kStockQtyInputFormatters,
            decoration: const InputDecoration(
              labelText: 'Haqiqiy miqdor',
              border: OutlineInputBorder(),
            ),
          ),
          ExpiryDatePickerField(
            value: _invScanExpiry,
            onChanged: (String? v) => setState(() => _invScanExpiry = v),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _invSubmitting
                ? null
                : () => unawaited(_submitInvScanAdjust(_invScanSelectedLoc!)),
            child: _invSubmitting
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text('Tuzatishni yuborish'),
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
                ],
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
                  Text(
                    StringLookup.t(appLoc, 'kirimBatchFefo'),
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  ..._sortFefo(_product!.locations).map((PickerProductLocation loc) {
                    final bool sel =
                        _returnPick?.lotId == loc.lotId && _returnPick?.locationId == loc.locationId;
                    return ListTile(
                      title: Text(
                        '${StringLookup.t(appLoc, 'kirimFefoLocationPrefix')}${loc.locationCode}',
                      ),
                      subtitle: Text(
                        '${StringLookup.t(appLoc, 'kirimFefoQtyPrefix')}${loc.availableQty.toStringAsFixed(0)} · '
                        '${StringLookup.t(appLoc, 'kirimFefoExpiryPrefix')}${formatExpiryMonthYear(loc.expiryDate)}',
                      ),
                      tileColor: sel ? Colors.blue.shade50 : null,
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
                    onPressed: _addLineReturn,
                    child: Text(StringLookup.t(appLoc, 'kirimAddLine')),
                  ),
                ],
                if (_flow == 'new')
                  Stack(
                    children: <Widget>[
                      AbsorbPointer(
                        absorbing: _product == null,
                        child: Opacity(
                          opacity: _product == null ? 0.45 : 1,
                          child: Column(
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
                                    if (sel != null &&
                                        v.trim().toLowerCase() != sel.code.trim().toLowerCase()) {
                                      _destLocation = null;
                                    }
                                  });
                                },
                              ),
                              _kirimPutawayResultsList(),
                              const SizedBox(height: 16),
                              const Divider(height: 1),
                              const SizedBox(height: 16),
                              Card(
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
                                      TextField(
                                        controller: _batchNew,
                                        textCapitalization: TextCapitalization.characters,
                                        decoration: InputDecoration(
                                          labelText: StringLookup.t(appLoc, 'kirimBatchLabel'),
                                          border: const OutlineInputBorder(),
                                          suffixIcon: buildInputClearButton(
                                            visible: _batchNew.text.trim().isNotEmpty,
                                            onPressed: () => setState(() => _batchNew.clear()),
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
                                    ],
                                  ),
                                ),
                              ),
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
                      subtitle: Text('${l.locationCode} · ${l.qty} · ${l.batch}'),
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
        ),
        body: body,
      ),
    );
  }
}

