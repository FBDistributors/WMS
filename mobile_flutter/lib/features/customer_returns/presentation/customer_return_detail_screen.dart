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
          final String assignedBy =
              ret.assignedByUserName ??
              ret.assignedByUserId ??
              ret.approvedByUserId ??
              'Nomaʼlum';
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
                      Text('Controller: $assignedBy'),
                      Text('Yuborilgan sana: $sentAt'),
                      Text('Status: ${ret.status}'),
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
                            return DropdownButtonFormField<String>(
                              isExpanded: true,
                              initialValue: _selectedLocationByLine[line.id],
                              decoration: const InputDecoration(
                                labelText: 'Lokatsiya tanlang',
                                border: OutlineInputBorder(),
                              ),
                              items: locations
                                  .map(
                                    (PickerLocationOption option) =>
                                        DropdownMenuItem<String>(
                                      value: option.id,
                                      child: Text(
                                        formatPickerLocationOptionLine(option),
                                      ),
                                    ),
                                  )
                                  .toList(growable: false),
                              onChanged: _submitting
                                  ? null
                                  : (String? value) {
                                      setState(() {
                                        if (value == null || value.isEmpty) {
                                          _selectedLocationByLine.remove(line.id);
                                        } else {
                                          _selectedLocationByLine[line.id] = value;
                                        }
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
      showAppSnackBar(
        context,
        SnackBar(content: Text('Yakunlandi')),
      );
      context.pop();
    } on Exception catch (e) {
      if (!mounted) {
        return;
      }
      showAppSnackBar(context, SnackBar(content: Text('$e')));
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
