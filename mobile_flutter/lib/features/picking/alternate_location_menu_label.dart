import 'dart:collection';

import '../../core/formatting/expiry_display_format.dart';
import 'data/picking_models.dart';

/// Birlashtirilgan alternativ joy qatori (UI): bir xil joy + bir xil muddat bo‘yicha qoldiq yig‘indi, `changePickSource` uchun [representative] (eng katta qoldiqli lot).
class MergedAlternateLocationRow {
  const MergedAlternateLocationRow({
    required this.representative,
    required this.totalQtyRounded,
    required this.menuLabel,
  });

  final PickingAlternateLocation representative;
  final int totalQtyRounded;
  final String menuLabel;
}

String _alternateMergeKey(PickingAlternateLocation a) =>
    '${a.locationCode.trim()}\u001f${(a.expiryDate ?? '').trim()}';

/// Bir xil [PickingAlternateLocation.locationCode] + bir xil muddat bo‘yicha guruhlab, qoldiqlarni yig‘adi; vakil — guruhda [availableQty] eng kattasi.
List<MergedAlternateLocationRow> mergeAlternateLocationsForDisplay(
  List<PickingAlternateLocation> raw,
) {
  if (raw.isEmpty) {
    return const <MergedAlternateLocationRow>[];
  }
  final LinkedHashMap<String, List<PickingAlternateLocation>> byKey =
      LinkedHashMap<String, List<PickingAlternateLocation>>();
  for (final PickingAlternateLocation a in raw) {
    final String k = _alternateMergeKey(a);
    byKey.putIfAbsent(k, () => <PickingAlternateLocation>[]).add(a);
  }
  final List<MergedAlternateLocationRow> out = <MergedAlternateLocationRow>[];
  for (final List<PickingAlternateLocation> g in byKey.values) {
    double sum = 0;
    PickingAlternateLocation rep = g.first;
    for (final PickingAlternateLocation a in g) {
      sum += a.availableQty;
      if (a.availableQty > rep.availableQty) {
        rep = a;
      }
    }
    final int total = sum.round();
    final String? expTrim = rep.expiryDate?.trim();
    final String suffix = expTrim != null && expTrim.isNotEmpty
        ? ' · ${formatExpiryMonthYear(rep.expiryDate)}'
        : '';
    out.add(
      MergedAlternateLocationRow(
        representative: rep,
        totalQtyRounded: total,
        menuLabel: '${rep.locationCode} — $total$suffix',
      ),
    );
  }
  return out;
}
