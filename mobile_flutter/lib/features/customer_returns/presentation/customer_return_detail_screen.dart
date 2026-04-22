import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/scanner_args.dart';
import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../scanner/data/scanner_repository.dart';
import '../../scanner/scanner_providers.dart';
import '../../inventory/data/models/picker_inventory_models.dart';
import '../../inventory/data/picker_location_format.dart';
import '../../inventory/presentation/inventory_providers.dart';
import '../customer_returns_providers.dart';
import '../data/customer_return_doc_no_display.dart';
import '../data/customer_return_expiry_match.dart';
import '../data/customer_returns_models.dart';

bool _barcodeResolveMatchesProduct(ScannerResolveOut out, String expectedProductId) {
  if (out.type != ScannerResolveType.product) {
    return false;
  }
  final String? pid = out.productId;
  if (pid == null || pid.isEmpty) {
    return false;
  }
  return pid.trim().toLowerCase() == expectedProductId.trim().toLowerCase();
}

class CustomerReturnDetailScreen extends ConsumerStatefulWidget {
  const CustomerReturnDetailScreen({super.key, required this.returnId});

  final String returnId;

  @override
  ConsumerState<CustomerReturnDetailScreen> createState() =>
      _CustomerReturnDetailScreenState();
}

class _CustomerReturnDetailScreenState
    extends ConsumerState<CustomerReturnDetailScreen> {
  final Map<String, String> _selectedLocationByLine = <String, String>{};
  final Map<String, bool> _skipAutoDefaultByLine = <String, bool>{};
  final Map<String, TextEditingController> _searchControllerByLine =
      <String, TextEditingController>{};
  final Map<String, bool> _productVerifiedByLine = <String, bool>{};
  bool _submitting = false;

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    ref.listen<CustomerReturnLocationScanFromScanner?>(
      pendingCustomerReturnLocationScanProvider,
      (CustomerReturnLocationScanFromScanner? prev, CustomerReturnLocationScanFromScanner? next) {
        if (next == null || next.returnId != widget.returnId) {
          return;
        }
        ref.read(pendingCustomerReturnLocationScanProvider.notifier).state = null;
        final CustomerReturnLocationScanFromScanner snap = next;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) {
            return;
          }
          final CustomerReturn? ret =
              ref.read(customerReturnDetailProvider(widget.returnId)).valueOrNull;
          if (ret == null || !ret.lines.any((CustomerReturnLine l) => l.id == snap.lineId)) {
            return;
          }
          final List<PickerLocationOption> locs =
              ref.read(pickerLocationsProvider).valueOrNull ?? const <PickerLocationOption>[];
          final PickerLocationOption? opt = _optionById(locs, snap.locationId);
          final String label = opt != null
              ? formatPickerLocationOptionLine(opt)
              : (snap.displayLabel.trim().isEmpty ? snap.locationId : snap.displayLabel);
          setState(() {
            _selectedLocationByLine[snap.lineId] = snap.locationId;
            _skipAutoDefaultByLine[snap.lineId] = false;
            _controllerForLine(snap.lineId).text = label;
          });
        });
      },
    );
    ref.listen<CustomerReturnProductVerifyFromScanner?>(
      pendingCustomerReturnProductVerifyProvider,
      (CustomerReturnProductVerifyFromScanner? prev, CustomerReturnProductVerifyFromScanner? next) {
        if (next == null || next.returnId != widget.returnId) {
          return;
        }
        ref.read(pendingCustomerReturnProductVerifyProvider.notifier).state = null;
        final CustomerReturnProductVerifyFromScanner snap = next;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) {
            return;
          }
          final CustomerReturn? ret =
              ref.read(customerReturnDetailProvider(widget.returnId)).valueOrNull;
          if (ret == null || !ret.lines.any((CustomerReturnLine l) => l.id == snap.lineId)) {
            return;
          }
          setState(() {
            _productVerifiedByLine[snap.lineId] = true;
          });
        });
      },
    );
    final AsyncValue<CustomerReturn> detailAsync =
        ref.watch(customerReturnDetailProvider(widget.returnId));
    final AsyncValue<List<PickerLocationOption>> locationsAsync =
        ref.watch(pickerLocationsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Qaytim tafsiloti'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: detailAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (Object e, _) => Center(child: Text('$e')),
        data: (CustomerReturn ret) {
          final String sentAt = _prettyDate(ret.assignedAt ?? ret.updatedAt);
          final String docDisplay = displayCustomerReturnDocNo(ret.docNo);
          final String customerText = ret.customerName?.trim().isNotEmpty == true
              ? ret.customerName!.trim()
              : (ret.customerId?.trim().isNotEmpty == true
                  ? ret.customerId!.trim()
                  : 'Mijoz yo‘q');

          final List<CustomerReturnLine> orderedLines = <CustomerReturnLine>[
            ...ret.lines,
          ]..sort((CustomerReturnLine a, CustomerReturnLine b) {
              final String ka = _lineSortKey(a.id, a.productName, _selectedLocationByLine, locationsAsync.valueOrNull);
              final String kb = _lineSortKey(b.id, b.productName, _selectedLocationByLine, locationsAsync.valueOrNull);
              return ka.compareTo(kb);
            });

          return Column(
            children: <Widget>[
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
                  children: <Widget>[
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              '${StringLookup.t(loc, 'returnsFieldDoc')}: $docDisplay',
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 17,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '${StringLookup.t(loc, 'returnsFieldCustomer')}: $customerText',
                            ),
                            const SizedBox(height: 8),
                            Text('Yuborilgan sana: $sentAt'),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    ...orderedLines.map(
                (CustomerReturnLine line) => locationsAsync.when(
                  loading: () => const Card(
                    child: Padding(
                      padding: EdgeInsets.all(12),
                      child: LinearProgressIndicator(),
                    ),
                  ),
                  error: (_, __) => Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(
                        '${line.productName}\nLokatsiyalarni yuklashda xato',
                      ),
                    ),
                  ),
                  data: (List<PickerLocationOption> locations) => _ReturnLineCard(
                    returnId: widget.returnId,
                    line: line,
                    appLocale: loc,
                    allLocations: locations,
                    enabled: !_submitting,
                    isProductVerified: _productVerifiedByLine[line.id] == true,
                    selectedLocationId: _selectedLocationByLine[line.id],
                    searchController: _controllerForLine(line.id),
                    onLocationPicked: (String locationId, String label) {
                      setState(() {
                        _selectedLocationByLine[line.id] = locationId;
                        _skipAutoDefaultByLine[line.id] = false;
                        _controllerForLine(line.id).text = label;
                      });
                    },
                    onClearLocation: _submitting
                        ? null
                        : () => _clearLocationForLine(line.id),
                    allowAutoDefaultLocation: !(_skipAutoDefaultByLine[line.id] ?? false),
                    onProductVerifyTap: _submitting
                        ? null
                        : () => _openProductVerifyBottomSheet(context, line, loc),
                  ),
                ),
              ),
                    const SizedBox(height: 4),
                  ],
                ),
              ),
              SafeArea(
                top: false,
                minimum: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _submitting
                        ? null
                        : () => _completeReturn(ret, loc),
                    child: Text(
                      _submitting
                          ? StringLookup.t(loc, 'returnsSubmitting')
                          : StringLookup.t(loc, 'returnsCompletePutaway'),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  void _clearLocationForLine(String lineId) {
    setState(() {
      _selectedLocationByLine.remove(lineId);
      _skipAutoDefaultByLine[lineId] = true;
      _controllerForLine(lineId).clear();
      _productVerifiedByLine.remove(lineId);
    });
  }

  Future<void> _openProductVerifyBottomSheet(
    BuildContext host,
    CustomerReturnLine line,
    AppLocale loc,
  ) async {
    final TextEditingController tc = TextEditingController();
    try {
      await showModalBottomSheet<void>(
        context: host,
        isScrollControlled: true,
        useSafeArea: false,
        builder: (BuildContext sheetContext) {
          return Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.viewInsetsOf(sheetContext).bottom,
            ),
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Text(
                      StringLookup.t(loc, 'returnsVerifyProductTitle'),
                      style: Theme.of(sheetContext).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: tc,
                      decoration: InputDecoration(
                        labelText: StringLookup.t(loc, 'returnsVerifyProductHint'),
                        border: const OutlineInputBorder(),
                      ),
                      textInputAction: TextInputAction.done,
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: <Widget>[
                        TextButton.icon(
                          icon: const Icon(Icons.qr_code_scanner),
                          label: Text(StringLookup.t(loc, 'returnsVerifyProductOpenScanner')),
                          onPressed: () {
                            Navigator.pop(sheetContext);
                            WidgetsBinding.instance.addPostFrameCallback((_) {
                              if (!mounted) {
                                return;
                              }
                              context.pushNamed(
                                'scanner',
                                extra: ScannerArgs(
                                  returnToCustomerReturnProductVerify: true,
                                  customerReturnId: widget.returnId,
                                  lineId: line.id,
                                  expectedProductId: line.productId,
                                ),
                              );
                            });
                          },
                        ),
                        const Spacer(),
                        FilledButton(
                          onPressed: () async {
                            final String raw = tc.text.trim();
                            if (raw.isEmpty) {
                              return;
                            }
                            try {
                              final ScannerResolveOut out =
                                  await ref.read(scannerRepositoryProvider).resolveBarcode(raw);
                              if (!mounted) {
                                return;
                              }
                              if (!_barcodeResolveMatchesProduct(out, line.productId)) {
                                showAppSnackBar(
                                  context,
                                  SnackBar(
                                    content: Text(
                                      out.type == ScannerResolveType.location
                                          ? StringLookup.t(loc, 'returnsExpectProductNotLocation')
                                          : StringLookup.t(loc, 'returnsProductMismatch'),
                                    ),
                                  ),
                                  type: AppToastType.warning,
                                );
                                return;
                              }
                              setState(() {
                                _productVerifiedByLine[line.id] = true;
                              });
                              if (sheetContext.mounted) {
                                Navigator.pop(sheetContext);
                              }
                            } on Exception catch (e) {
                              if (mounted) {
                                showAppSnackBar(
                                  context,
                                  SnackBar(content: Text('$e')),
                                  type: AppToastType.error,
                                );
                              }
                            }
                          },
                          child: Text(StringLookup.t(loc, 'returnsVerifyProductSubmit')),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      );
    } finally {
      tc.dispose();
    }
  }

  Future<void> _completeReturn(
    CustomerReturn ret,
    AppLocale loc,
  ) async {
    final List<CompleteCustomerReturnLineRequest> lines =
        <CompleteCustomerReturnLineRequest>[];
    for (final CustomerReturnLine line in ret.lines) {
      if (_productVerifiedByLine[line.id] != true) {
        showAppSnackBar(
          context,
          SnackBar(content: Text(StringLookup.t(loc, 'returnsAllProductsMustBeVerified'))),
          type: AppToastType.warning,
        );
        return;
      }
      final String? locationId = _selectedLocationByLine[line.id];
      if (locationId == null || locationId.isEmpty) {
        showAppSnackBar(
          context,
          SnackBar(content: Text(StringLookup.t(loc, 'returnsLocationRequired'))),
          type: AppToastType.warning,
        );
        return;
      }
      lines.add(
        CompleteCustomerReturnLineRequest(
          lineId: line.id,
          locationId: locationId,
        ),
      );
    }
    setState(() => _submitting = true);
    try {
      await ref
          .read(customerReturnsRepositoryProvider)
          .completeCustomerReturn(ret.id, lines: lines);
      ref.invalidate(customerReturnsQueueProvider);
      ref.invalidate(customerReturnDetailProvider(ret.id));
      if (!mounted) {
        return;
      }
      showAppTopSuccess(context, 'Yakunlandi');
      context.pop();
    } on Exception catch (e) {
      if (!mounted) {
        return;
      }
      showAppSnackBar(
        context,
        SnackBar(content: Text('$e')),
        type: AppToastType.error,
      );
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  String _prettyDate(String raw) {
    final DateTime? dt = DateTime.tryParse(raw);
    if (dt == null) {
      return raw;
    }
    final DateTime local = dt.toLocal();
    final String mm = local.month.toString().padLeft(2, '0');
    final String dd = local.day.toString().padLeft(2, '0');
    final String hh = local.hour.toString().padLeft(2, '0');
    final String min = local.minute.toString().padLeft(2, '0');
    return '${local.year}-$mm-$dd $hh:$min';
  }

  TextEditingController _controllerForLine(String lineId) {
    return _searchControllerByLine.putIfAbsent(
      lineId,
      () => TextEditingController(),
    );
  }

  @override
  void dispose() {
    for (final TextEditingController c in _searchControllerByLine.values) {
      c.dispose();
    }
    super.dispose();
  }
}

class _SuggestionEntry {
  _SuggestionEntry({
    required this.locationId,
    required this.qty,
    required this.fallbackLabel,
  });

  final String locationId;
  final double qty;
  final String fallbackLabel;
}

String _lineSortKey(
  String lineId,
  String productName,
  Map<String, String> selectedByLine,
  List<PickerLocationOption>? locations,
) {
  final String? locationId = selectedByLine[lineId];
  String locationLabel = 'zzz';
  if (locationId != null && locationId.isNotEmpty && locations != null) {
    final PickerLocationOption? opt = _optionById(locations, locationId);
    if (opt != null) {
      locationLabel = formatPickerLocationOptionLine(opt).toLowerCase();
    }
  }
  return '$locationLabel|${productName.toLowerCase()}';
}

_SuggestionEntry? _pickDefaultSuggestion(List<_SuggestionEntry> suggestions) {
  if (suggestions.isEmpty) {
    return null;
  }
  final List<_SuggestionEntry> sorted = <_SuggestionEntry>[...suggestions]
    ..sort((a, b) {
      final int qtyCmp = a.qty.compareTo(b.qty);
      if (qtyCmp != 0) {
        return qtyCmp;
      }
      return a.fallbackLabel.toLowerCase().compareTo(b.fallbackLabel.toLowerCase());
    });
  return sorted.first;
}

List<_SuggestionEntry> _buildExpirySuggestions(
  CustomerReturnLine line,
  List<PickerProductLocation> main,
  List<PickerProductLocation> showroom,
) {
  final List<PickerProductLocation> merged = <PickerProductLocation>[
    ...main,
    ...showroom,
  ];
  final List<PickerProductLocation> matched = merged
      .where(
        (PickerProductLocation l) =>
            expiryMatchesReturnLine(line.expiryDate, l.expiryDate) &&
            l.availableQty > 0,
      )
      .toList(growable: false);
  final Map<String, double> qtyByLoc = <String, double>{};
  for (final PickerProductLocation l in matched) {
    qtyByLoc[l.locationId] = (qtyByLoc[l.locationId] ?? 0) + l.availableQty;
  }
  final List<_SuggestionEntry> out = qtyByLoc.entries
      .map(
        (MapEntry<String, double> e) {
          final PickerProductLocation sample =
              matched.firstWhere((PickerProductLocation l) => l.locationId == e.key);
          final String fallback =
              '${sample.locationCode} · ${sample.expiryDate ?? "—"} · ${e.value.toStringAsFixed(0)}';
          return _SuggestionEntry(
            locationId: e.key,
            qty: e.value,
            fallbackLabel: fallback,
          );
        },
      )
      .toList(growable: false);
  out.sort(
    (a, b) => a.fallbackLabel.toLowerCase().compareTo(b.fallbackLabel.toLowerCase()),
  );
  return out;
}

PickerLocationOption? _optionById(
  List<PickerLocationOption> locations,
  String? locationId,
) {
  if (locationId == null || locationId.isEmpty) {
    return null;
  }
  for (final PickerLocationOption o in locations) {
    if (o.id == locationId) {
      return o;
    }
  }
  return null;
}

class _ReturnLineCard extends ConsumerWidget {
  const _ReturnLineCard({
    required this.returnId,
    required this.line,
    required this.appLocale,
    required this.allLocations,
    required this.enabled,
    required this.isProductVerified,
    required this.selectedLocationId,
    required this.searchController,
    required this.onLocationPicked,
    required this.allowAutoDefaultLocation,
    this.onClearLocation,
    this.onProductVerifyTap,
  });

  final String returnId;
  final CustomerReturnLine line;
  final AppLocale appLocale;
  final List<PickerLocationOption> allLocations;
  final bool enabled;
  final bool isProductVerified;
  final String? selectedLocationId;
  final TextEditingController searchController;
  final void Function(String locationId, String label) onLocationPicked;
  final bool allowAutoDefaultLocation;
  final VoidCallback? onClearLocation;
  final VoidCallback? onProductVerifyTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<InventoryDetailPair> detailAsync =
        ref.watch(inventoryProductDetailProvider(line.productId));
    final PickerLocationOption? selectedOption =
        _optionById(allLocations, selectedLocationId);

    return Card(
      color: isProductVerified ? Colors.green.shade50 : null,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                Expanded(
                  child: InkWell(
                    onTap: onProductVerifyTap,
                    borderRadius: BorderRadius.circular(8),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            line.productName,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(height: 6),
                          Text('Miqdor: ${line.qty}'),
                          Text('Muddati: ${line.expiryDate ?? '—'}'),
                        ],
                      ),
                    ),
                  ),
                ),
                if (isProductVerified)
                  Padding(
                    padding: const EdgeInsets.only(left: 4, bottom: 2),
                    child: Icon(Icons.check_circle, color: Colors.green.shade700, size: 26),
                  )
                else
                  Padding(
                    padding: const EdgeInsets.only(left: 4, bottom: 2),
                    child: IconButton(
                      tooltip: StringLookup.t(appLocale, 'returnsVerifyProductOpenScanner'),
                      style: IconButton.styleFrom(
                        foregroundColor: Theme.of(context).colorScheme.primary,
                        visualDensity: VisualDensity.compact,
                      ),
                      onPressed: enabled
                          ? () {
                              context.pushNamed(
                                'scanner',
                                extra: ScannerArgs(
                                  returnToCustomerReturnProductVerify: true,
                                  customerReturnId: returnId,
                                  lineId: line.id,
                                  expectedProductId: line.productId,
                                ),
                              );
                            }
                          : null,
                      icon: const Icon(Icons.qr_code_scanner),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            detailAsync.when(
              loading: () => const LinearProgressIndicator(),
              error: (_, __) => const SizedBox.shrink(),
              data: (InventoryDetailPair pair) {
                final List<_SuggestionEntry> suggestions = _buildExpirySuggestions(
                  line,
                  pair.main.locations,
                  pair.showroom.locations,
                );
                if ((selectedLocationId == null || selectedLocationId!.isEmpty) &&
                    allowAutoDefaultLocation &&
                    enabled &&
                    suggestions.isNotEmpty) {
                  final _SuggestionEntry? def = _pickDefaultSuggestion(suggestions);
                  if (def != null) {
                    final PickerLocationOption? defOpt = _optionById(allLocations, def.locationId);
                    if (defOpt != null) {
                      WidgetsBinding.instance.addPostFrameCallback((_) {
                        onLocationPicked(defOpt.id, formatPickerLocationOptionLine(defOpt));
                      });
                    }
                  }
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    if (suggestions.isNotEmpty) ...<Widget>[
                      Text(
                        StringLookup.t(appLocale, 'returnsSuggestedLocationsTitle'),
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 6),
                      ...suggestions.map(
                        (_SuggestionEntry s) {
                          final PickerLocationOption? opt =
                              _optionById(allLocations, s.locationId);
                          final String label = opt == null
                              ? s.fallbackLabel
                              : '${formatPickerLocationOptionLine(opt)} · ${s.qty.toStringAsFixed(0)}';
                          final bool selected = selectedLocationId == s.locationId;
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 6),
                            child: Material(
                              color: selected
                                  ? Colors.green.shade50
                                  : Theme.of(context)
                                      .colorScheme
                                      .surfaceContainerHighest
                                      .withValues(alpha: 0.35),
                              borderRadius: BorderRadius.circular(8),
                              child: InkWell(
                                borderRadius: BorderRadius.circular(8),
                                onTap: enabled
                                    ? () {
                                        if (opt != null) {
                                          onLocationPicked(opt.id, label);
                                        } else {
                                          onLocationPicked(s.locationId, label);
                                        }
                                      }
                                    : null,
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 12,
                                    vertical: 10,
                                  ),
                                  child: Row(
                                    children: <Widget>[
                                      Expanded(child: Text(label)),
                                      if (selected)
                                        Icon(
                                          Icons.check_circle,
                                          color: Colors.green.shade700,
                                          size: 22,
                                        ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                      const SizedBox(height: 4),
                    ] else
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(
                          StringLookup.t(
                            appLocale,
                            'returnsNoExpiryMatchLocations',
                          ),
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: Theme.of(context).colorScheme.onSurfaceVariant,
                              ),
                        ),
                      ),
                    _LocationSearchField(
                      locations: allLocations,
                      enabled: enabled,
                      controller: searchController,
                      selectedLabel: selectedOption == null
                          ? null
                          : formatPickerLocationOptionLine(selectedOption),
                      onSelected: (PickerLocationOption option) {
                        onLocationPicked(
                          option.id,
                          formatPickerLocationOptionLine(option),
                        );
                      },
                      hasSelectedLocation:
                          selectedLocationId != null && selectedLocationId!.isNotEmpty,
                      clearTooltip:
                          StringLookup.t(appLocale, 'returnsClearLocation'),
                      onClearLocation: onClearLocation,
                    ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _LocationSearchField extends StatelessWidget {
  const _LocationSearchField({
    required this.locations,
    required this.enabled,
    required this.controller,
    required this.selectedLabel,
    required this.onSelected,
    this.hasSelectedLocation = false,
    this.clearTooltip,
    this.onClearLocation,
  });

  final List<PickerLocationOption> locations;
  final bool enabled;
  final TextEditingController controller;
  final String? selectedLabel;
  final ValueChanged<PickerLocationOption> onSelected;
  final bool hasSelectedLocation;
  final String? clearTooltip;
  final VoidCallback? onClearLocation;

  @override
  Widget build(BuildContext context) {
    return Autocomplete<PickerLocationOption>(
      displayStringForOption: formatPickerLocationOptionLine,
      optionsBuilder: (TextEditingValue textEditingValue) {
        final String q = textEditingValue.text.trim().toLowerCase();
        if (q.isEmpty) {
          return locations.take(20);
        }
        return locations.where((PickerLocationOption option) {
          final String label = formatPickerLocationOptionLine(option).toLowerCase();
          return label.contains(q);
        }).take(20);
      },
      onSelected: onSelected,
      fieldViewBuilder: (
        BuildContext context,
        TextEditingController fieldController,
        FocusNode focusNode,
        VoidCallback onFieldSubmitted,
      ) {
        final String desiredText = selectedLabel ?? controller.text;
        if (fieldController.text != desiredText) {
          fieldController.value = TextEditingValue(
            text: desiredText,
            selection: TextSelection.collapsed(offset: desiredText.length),
          );
        }
        final bool showClear =
            onClearLocation != null && hasSelectedLocation && enabled;
        return TextFormField(
          controller: fieldController,
          focusNode: focusNode,
          enabled: enabled,
          decoration: InputDecoration(
            labelText: 'Lokatsiya qidirish',
            hintText: 'Lokatsiya kodini yozing...',
            border: const OutlineInputBorder(),
            prefixIcon: const Icon(Icons.search),
            suffixIcon: !showClear
                ? null
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      if (showClear)
                        IconButton(
                          tooltip: clearTooltip ?? '',
                          icon: const Icon(Icons.close),
                          onPressed: () {
                            fieldController.clear();
                            controller.clear();
                            onClearLocation?.call();
                          },
                        ),
                    ],
                  ),
          ),
          onChanged: (String value) {
            controller.text = value;
          },
          onFieldSubmitted: (_) => onFieldSubmitted(),
        );
      },
      optionsViewBuilder: (
        BuildContext context,
        AutocompleteOnSelected<PickerLocationOption> onSelected,
        Iterable<PickerLocationOption> options,
      ) {
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 4,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 240, minWidth: 260),
              child: ListView.builder(
                padding: EdgeInsets.zero,
                shrinkWrap: true,
                itemCount: options.length,
                itemBuilder: (BuildContext context, int index) {
                  final PickerLocationOption option = options.elementAt(index);
                  return ListTile(
                    dense: true,
                    title: Text(formatPickerLocationOptionLine(option)),
                    onTap: () {
                      final String label = formatPickerLocationOptionLine(option);
                      controller.value = TextEditingValue(
                        text: label,
                        selection: TextSelection.collapsed(offset: label.length),
                      );
                      onSelected(option);
                    },
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }
}
