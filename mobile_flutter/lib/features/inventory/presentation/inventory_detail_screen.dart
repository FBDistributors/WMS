import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'dart:math' as math;

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/formatting/expiry_display_format.dart';
import '../../../l10n/string_lookup.dart';
import '../data/models/picker_inventory_models.dart';
import 'inventory_locale.dart';
import 'inventory_providers.dart';

/// RN `InventoryDetailScreen` — asosiy + showroom omborlari.
class InventoryDetailScreen extends ConsumerWidget {
  const InventoryDetailScreen({super.key, required this.productId});

  final String productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final InventoryLocale invLoc = ref.watch(inventoryLocaleProvider);
    final AppLocale appLoc = ref.watch(appLocaleProvider);
    final AsyncValue<InventoryDetailPair> data =
        ref.watch(inventoryProductDetailProvider(productId));
    final bool isDark = Theme.of(context).brightness == Brightness.dark;
    final Uri uri = GoRouterState.of(context).uri;
    final String? scannedBoxBarcode = uri.queryParameters['scannedBoxBarcode'];
    final int? unitsPerBox = int.tryParse(uri.queryParameters['unitsPerBox'] ?? '');

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : const Color(0xFFF5F5F5),
      appBar: AppBar(
        title: Text(InventoryStrings.invTitle(invLoc)),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: data.when(
        data: (InventoryDetailPair pair) {
          final PickerProductDetailResponse main = pair.main;
          final List<PickerProductLocation> mainMerged =
              mergePickerProductLocationsForDisplay(main.locations);
          final List<PickerProductLocation> showroomMerged =
              mergePickerProductLocationsForDisplay(pair.showroom.locations);
          final int mainTotalOnHand = _totalOnHandForDisplay(mainMerged);
          final int showroomTotalOnHand = _totalOnHandForDisplay(showroomMerged);
          return ListView(
            padding: const EdgeInsets.all(16),
            children: <Widget>[
              if (scannedBoxBarcode != null &&
                  scannedBoxBarcode.isNotEmpty &&
                  unitsPerBox != null &&
                  unitsPerBox > 0)
                Card(
                  color: isDark ? const Color(0xFF1E3A5F) : const Color(0xFFE8EAF6),
                  margin: const EdgeInsets.only(bottom: 12),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    child: Text(
                      StringLookup.tParams(
                        appLoc,
                        'inventoryScannedViaBox',
                        <String, String>{
                          'barcode': scannedBoxBarcode,
                          'units': '$unitsPerBox',
                        },
                      ),
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: isDark ? const Color(0xFF93C5FD) : const Color(0xFF1A237E),
                      ),
                    ),
                  ),
                ),
              Text(
                main.name,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: isDark ? Colors.white : Colors.black87,
                    ),
              ),
              if (main.mainBarcode != null && main.mainBarcode!.isNotEmpty)
                Text(main.mainBarcode!, style: TextStyle(color: isDark ? Colors.white70 : Colors.black54)),
              Text(
                main.code,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: isDark ? const Color(0xFF93C5FD) : const Color(0xFF1A237E),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      '${InventoryStrings.invTitle(invLoc)} — asosiy',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: isDark ? Colors.white70 : Colors.black54,
                      ),
                    ),
                  ),
                  Text(
                    '${InventoryStrings.invOnHand(invLoc)}: $mainTotalOnHand',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: isDark ? Colors.white70 : Colors.black54,
                    ),
                  ),
                ],
              ),
              ...inventoryLocTiles(main.locations, invLoc, appLoc, isDark),
              const SizedBox(height: 16),
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      'Showroom',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: isDark ? Colors.white70 : Colors.black54,
                      ),
                    ),
                  ),
                  Text(
                    '${InventoryStrings.invOnHand(invLoc)}: $showroomTotalOnHand',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: isDark ? Colors.white70 : Colors.black54,
                    ),
                  ),
                ],
              ),
              ...inventoryLocTiles(pair.showroom.locations, invLoc, appLoc, isDark),
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => Center(child: Text(InventoryStrings.invLoadError(invLoc))),
      ),
    );
  }
}

/// Bir xil [PickerProductLocation.locationCode] + bir xil [PickerProductLocation.expiryDate] uchun qoldiqlarni yig‘ish.
List<PickerProductLocation> mergePickerProductLocationsForDisplay(
  List<PickerProductLocation> locations,
) {
  final Map<String, PickerProductLocation> byKey = <String, PickerProductLocation>{};
  for (final PickerProductLocation p in locations) {
    final String locCode = p.locationCode.trim();
    final String exp = (p.expiryDate ?? '').trim();
    final String key = '$locCode\u0000$exp';
    final PickerProductLocation? ex = byKey[key];
    if (ex == null) {
      byKey[key] = p;
    } else {
      byKey[key] = PickerProductLocation(
        locationId: ex.locationId,
        locationCode: ex.locationCode,
        lotId: ex.lotId,
        batchNo: ex.batchNo,
        expiryDate: ex.expiryDate,
        onHandQty: ex.onHandQty + p.onHandQty,
        reservedQty: ex.reservedQty + p.reservedQty,
        availableQty: ex.availableQty + p.availableQty,
        boxCount: ex.boxCount + p.boxCount,
        unitsInBoxes: ex.unitsInBoxes + p.unitsInBoxes,
        looseUnits: ex.looseUnits + p.looseUnits,
      );
    }
  }
  return byKey.values.toList();
}

int _toNonNegativeRounded(double value) => math.max(0, value).round();

int _totalOnHandForDisplay(List<PickerProductLocation> locations) {
  return locations.fold<int>(0, (int sum, PickerProductLocation l) {
    return sum + _toNonNegativeRounded(l.availableQty);
  });
}

List<Widget> inventoryLocTiles(
  List<PickerProductLocation> locations,
  InventoryLocale loc,
  AppLocale appLoc,
  bool isDark,
) {
  if (locations.isEmpty) {
    return <Widget>[
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(InventoryStrings.invNoResults(loc)),
      ),
    ];
  }
  final List<PickerProductLocation> merged = mergePickerProductLocationsForDisplay(locations)
      .where((PickerProductLocation l) => _toNonNegativeRounded(l.availableQty) > 0)
      .toList(growable: false);
  if (merged.isEmpty) {
    return <Widget>[
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(InventoryStrings.invNoResults(loc)),
      ),
    ];
  }
  return merged.map((PickerProductLocation l) {
    final List<String> boxLines = <String>[];
    if (l.boxCount > 0 || l.unitsInBoxes > 0) {
      boxLines.add(
        '${StringLookup.t(appLoc, 'inventoryLocationFullBoxes')}: ${l.boxCount}',
      );
      boxLines.add(
        '${StringLookup.t(appLoc, 'inventoryUnitsInBoxes')}: ${l.unitsInBoxes}',
      );
      boxLines.add(
        '${StringLookup.t(appLoc, 'inventoryLocationLooseUnits')}: ${l.looseUnits}',
      );
    }
    return Card(
      color: isDark ? const Color(0xFF1E293B) : Colors.white,
      child: ListTile(
        title: Text(l.locationCode, style: TextStyle(color: isDark ? Colors.white : Colors.black87)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              formatExpiryMonthYear(l.expiryDate),
              style: TextStyle(color: isDark ? Colors.white54 : Colors.black45),
            ),
            if (boxLines.isNotEmpty) ...<Widget>[
              const SizedBox(height: 4),
              ...boxLines.map(
                (String line) => Text(
                  line,
                  style: TextStyle(
                    fontSize: 12,
                    color: isDark ? Colors.white60 : Colors.black54,
                  ),
                ),
              ),
            ],
          ],
        ),
        trailing: Text(
          '${InventoryStrings.invOnHand(loc)}: ${_toNonNegativeRounded(l.availableQty)}',
          style: TextStyle(color: isDark ? Colors.white70 : Colors.black87),
          textAlign: TextAlign.right,
        ),
      ),
    );
  }).toList();
}
