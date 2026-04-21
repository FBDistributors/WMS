import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/feedback/app_top_snackbar.dart';
import '../../inventory/data/models/picker_inventory_models.dart';
import '../../inventory/data/picker_location_format.dart';
import '../../inventory/presentation/inventory_providers.dart';
import '../customer_returns_providers.dart';
import '../data/customer_returns_models.dart';

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
  final Map<String, TextEditingController> _searchControllerByLine =
      <String, TextEditingController>{};
  bool _submitting = false;

  @override
  Widget build(BuildContext context) {
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

          return ListView(
            padding: const EdgeInsets.all(12),
            children: <Widget>[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        ret.docNo,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 17,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(ret.customerName?.trim().isNotEmpty == true
                          ? ret.customerName!
                          : (ret.customerId ?? 'Mijoz yo‘q')),
                      const SizedBox(height: 8),
                      Text('Yuborilgan sana: $sentAt'),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              ...ret.lines.map(
                (CustomerReturnLine line) => Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
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
                        _BalanceLine(productId: line.productId),
                        const SizedBox(height: 10),
                        locationsAsync.when(
                          loading: () => const LinearProgressIndicator(),
                          error: (_, __) =>
                              const Text('Lokatsiyalarni yuklashda xato'),
                          data: (List<PickerLocationOption> locations) {
                            final String? selectedId =
                                _selectedLocationByLine[line.id];
                            final PickerLocationOption? selectedOption = selectedId == null
                                ? null
                                : locations.cast<PickerLocationOption?>().firstWhere(
                                      (PickerLocationOption? option) =>
                                          option?.id == selectedId,
                                      orElse: () => null,
                                    );
                            return _LocationSearchField(
                              locations: locations,
                              enabled: !_submitting,
                              controller: _controllerForLine(line.id),
                              selectedLabel: selectedOption == null
                                  ? null
                                  : formatPickerLocationOptionLine(selectedOption),
                              onSelected: (PickerLocationOption option) {
                                setState(() {
                                  _selectedLocationByLine[line.id] = option.id;
                                });
                              },
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: _submitting
                    ? null
                    : () => _completeReturn(ret),
                child: Text(_submitting ? 'Yuborilmoqda...' : 'Yakunlash (yig‘uvchi)'),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _completeReturn(
    CustomerReturn ret,
  ) async {
    final List<CompleteCustomerReturnLineRequest> lines =
        <CompleteCustomerReturnLineRequest>[];
    for (final CustomerReturnLine line in ret.lines) {
      final String? locationId = _selectedLocationByLine[line.id];
      if (locationId == null || locationId.isEmpty) {
        showAppSnackBar(
          context,
          const SnackBar(content: Text('Har bir mahsulot uchun lokatsiya tanlang')),
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

class _BalanceLine extends ConsumerWidget {
  const _BalanceLine({required this.productId});

  final String productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<InventoryDetailPair> detailAsync =
        ref.watch(inventoryProductDetailProvider(productId));
    return detailAsync.when(
      loading: () => const Text('Qoldiq: ...'),
      error: (_, __) => const Text('Qoldiq: xato'),
      data: (InventoryDetailPair pair) {
        final double mainAvail = pair.main.locations.fold<double>(
          0,
          (double sum, PickerProductLocation loc) => sum + loc.availableQty,
        );
        final double showroomAvail = pair.showroom.locations.fold<double>(
          0,
          (double sum, PickerProductLocation loc) => sum + loc.availableQty,
        );
        final double total = mainAvail + showroomAvail;
        return Text('Qoldiq: ${total.toStringAsFixed(0)}');
      },
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
  });

  final List<PickerLocationOption> locations;
  final bool enabled;
  final TextEditingController controller;
  final String? selectedLabel;
  final ValueChanged<PickerLocationOption> onSelected;

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
        return TextFormField(
          controller: fieldController,
          focusNode: focusNode,
          enabled: enabled,
          decoration: const InputDecoration(
            labelText: 'Lokatsiya qidirish',
            hintText: 'Lokatsiya kodini yozing...',
            border: OutlineInputBorder(),
            prefixIcon: Icon(Icons.search),
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
