import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../inventory/data/models/picker_inventory_models.dart';
import '../../inventory/data/picker_location_format.dart';
import '../../inventory/presentation/inventory_providers.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../customer_returns_providers.dart';
import '../data/customer_returns_models.dart';

class CustomerReturnsQueueScreen extends ConsumerStatefulWidget {
  const CustomerReturnsQueueScreen({super.key});

  @override
  ConsumerState<CustomerReturnsQueueScreen> createState() => _CustomerReturnsQueueScreenState();
}

class _CustomerReturnsQueueScreenState extends ConsumerState<CustomerReturnsQueueScreen> {
  final Map<String, String> _selectedLocationByReturn = <String, String>{};
  final Set<String> _completingIds = <String>{};

  @override
  Widget build(BuildContext context) {
    final WidgetRef ref = this.ref;
    final AppLocale loc = ref.watch(appLocaleProvider);
    final AsyncValue<CustomerReturnListResponse> async =
        ref.watch(customerReturnsQueueProvider);
    final AsyncValue<List<PickerLocationOption>> locationsAsync = ref.watch(pickerLocationsProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(StringLookup.t(loc, 'kirimReturnsQueueCard')),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: async.when(
        data: (CustomerReturnListResponse r) {
          if (r.items.isEmpty) {
            return Center(child: Text(StringLookup.t(loc, 'returnsQueueEmpty')));
          }
          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(customerReturnsQueueProvider);
            },
            child: ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: r.items.length,
              itemBuilder: (BuildContext context, int i) {
                final CustomerReturn c = r.items[i];
                final String? custLabel = (c.customerName != null && c.customerName!.trim().isNotEmpty)
                    ? c.customerName!.trim()
                    : (c.customerId != null && c.customerId!.trim().isNotEmpty ? c.customerId!.trim() : null);
                final String summary = StringLookup.tParams(loc, 'returnsLinesSummary', <String, String>{
                  'status': c.status,
                  'count': '${c.lines.length}',
                });
                return Card(
                  child: ExpansionTile(
                    title: Text(c.docNo),
                    subtitle: Text(
                      custLabel != null ? '$custLabel · $summary' : summary,
                    ),
                    children: <Widget>[
                      Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: <Widget>[
                            ...c.lines.map(
                              (CustomerReturnLine l) => ListTile(
                                dense: true,
                                title: Text(l.productName),
                                subtitle: Text(
                                  StringLookup.tParams(loc, 'returnsLineSubtitle', <String, String>{
                                    'location': l.locationCode,
                                    'qty': '${l.qty}',
                                  }),
                                ),
                              ),
                            ),
                            const SizedBox(height: 8),
                            locationsAsync.when(
                              data: (List<PickerLocationOption> locations) {
                                if (locations.isEmpty) {
                                  return const Text('Lokatsiyalar topilmadi');
                                }
                                return DropdownButtonFormField<String>(
                                  key: ValueKey<String>(
                                    'ret-loc-${c.id}-${_selectedLocationByReturn[c.id] ?? ''}',
                                  ),
                                  isExpanded: true,
                                  initialValue: _selectedLocationByReturn[c.id],
                                  decoration: const InputDecoration(
                                    labelText: 'Qabul lokatsiyasi',
                                    border: OutlineInputBorder(),
                                  ),
                                  items: locations
                                      .map(
                                        (PickerLocationOption option) => DropdownMenuItem<String>(
                                          value: option.id,
                                          child: Text(formatPickerLocationOptionLine(option)),
                                        ),
                                      )
                                      .toList(growable: false),
                                  onChanged: (String? value) {
                                    setState(() {
                                      if (value == null || value.isEmpty) {
                                        _selectedLocationByReturn.remove(c.id);
                                      } else {
                                        _selectedLocationByReturn[c.id] = value;
                                      }
                                    });
                                  },
                                );
                              },
                              loading: () => const LinearProgressIndicator(),
                              error: (_, __) => const Text('Lokatsiyalarni yuklashda xato'),
                            ),
                            const SizedBox(height: 10),
                            FilledButton(
                              onPressed: _completingIds.contains(c.id)
                                  ? null
                                  : () async {
                                      final String? selectedLocationId =
                                          _selectedLocationByReturn[c.id];
                                      if (selectedLocationId == null || selectedLocationId.isEmpty) {
                                        if (context.mounted) {
                                          showAppSnackBar(
                                            context,
                                            const SnackBar(
                                              content: Text('Avval qabul lokatsiyasini tanlang'),
                                            ),
                                          );
                                        }
                                        return;
                                      }
                                      setState(() => _completingIds.add(c.id));
                                try {
                                  await ref
                                      .read(customerReturnsRepositoryProvider)
                                      .completeCustomerReturn(
                                        c.id,
                                        locationId: selectedLocationId,
                                      );
                                  if (context.mounted) {
                                    ref.invalidate(customerReturnsQueueProvider);
                                    showAppSnackBar(
                                      context,
                                      SnackBar(
                                        content: Text(StringLookup.t(loc, 'returnsCompleted')),
                                      ),
                                    );
                                  }
                                } on Exception catch (e) {
                                  if (context.mounted) {
                                    showAppSnackBar(
                                      context,
                                      SnackBar(content: Text('$e')),
                                    );
                                  }
                                } finally {
                                  if (mounted) {
                                    setState(() => _completingIds.remove(c.id));
                                  }
                                }
                              },
                              child: Text(StringLookup.t(loc, 'returnsCompletePicker')),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (Object e, _) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Text('$e'),
              FilledButton(
                onPressed: () => ref.invalidate(customerReturnsQueueProvider),
                child: Text(StringLookup.t(loc, 'retry')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
