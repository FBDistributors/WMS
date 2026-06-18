import '../data/picking_models.dart';
import 'pick_scan_resolution.dart';

/// Guruhlangan karta (controller) yoki bitta qator (picker sheet wrapper).
class PickLineGroup {
  const PickLineGroup({required this.virtual, required this.members});

  final PickingLine virtual;
  final List<PickingLine> members;
}

bool pickingLineEffectivelyDone(PickingLine l) =>
    l.isVipExpiryInformational || l.qtyPicked >= l.qtyRequired;

bool pickLineGroupEffectivelyDone(PickLineGroup g) =>
    g.members.every(pickingLineEffectivelyDone);

PickLineGroup pickLineGroupFromSingle(PickingLine line) =>
    PickLineGroup(virtual: line, members: <PickingLine>[line]);

/// Picker ro‘yxati: ochiq qatorlar yuqorida, tugaganlar pastda.
List<PickingLine> orderedPickerLines(List<PickingLine> lines) {
  final List<PickingLine> incomplete = lines
      .where((PickingLine l) => !pickingLineEffectivelyDone(l))
      .toList(growable: false);
  final List<PickingLine> complete = lines
      .where(pickingLineEffectivelyDone)
      .toList(growable: false);
  return <PickingLine>[...incomplete, ...complete];
}

/// Picker kartasi: faqat shu joy miqdori.
String pickerLocationQtyLine(PickingLine l) {
  final String? breakdown = pickLocationBreakdownLabel(l);
  final String base =
      '${l.locationCode} · ${formatPickQty(l.qtyPicked)}/${formatPickQty(l.qtyRequired)}';
  if (breakdown != null && breakdown.isNotEmpty) {
    return '$base · $breakdown';
  }
  return base;
}

String groupLocationQtyLine(PickLineGroup g) {
  final List<PickingLine> physical = g.members
      .where((PickingLine l) => !l.isVipExpiryInformational)
      .toList();
  if (physical.length <= 1) {
    final PickingLine l = physical.isNotEmpty ? physical.first : g.members.first;
    final String? breakdown = pickLocationBreakdownLabel(l);
    final String base =
        '${l.locationCode} · ${formatPickQty(g.virtual.qtyPicked)}/${formatPickQty(g.virtual.qtyRequired)}';
    if (breakdown != null && breakdown.isNotEmpty) {
      return '$base · $breakdown';
    }
    return base;
  }
  return physical
      .map(
        (PickingLine l) =>
            '${l.locationCode}: ${formatPickQty(l.qtyPicked)}/${formatPickQty(l.qtyRequired)}',
      )
      .join(' · ');
}

List<PickLineGroup> groupLinesByProduct(List<PickingLine> lines) {
  final Map<String, List<PickingLine>> map = <String, List<PickingLine>>{};
  for (final PickingLine l in lines) {
    final String key = pickLineGroupKey(l);
    map.putIfAbsent(key, () => <PickingLine>[]).add(l);
  }
  return map.values.map((List<PickingLine> groupLines) {
    final PickingLine first = groupLines.first;
    final double required = groupLines.fold<double>(
      0,
      (double s, PickingLine l) => s + l.qtyRequired,
    );
    final double picked = groupLines.fold<double>(
      0,
      (double s, PickingLine l) => s + l.qtyPicked,
    );
    final PickingLine virtual = PickingLine(
      id: first.id,
      productName: first.productName,
      sku: first.sku,
      barcode: first.barcode,
      locationCode: '—',
      batch: first.batch,
      expiryDate: first.expiryDate,
      qtyRequired: required,
      qtyPicked: picked,
      skipReason: first.skipReason,
      productId: first.productId,
      alternateLocations: first.alternateLocations,
      isVipExpiryInformational: first.isVipExpiryInformational,
      vipExpiryInformationKey: first.vipExpiryInformationKey,
      lineSource: first.lineSource,
    );
    return PickLineGroup(virtual: virtual, members: groupLines);
  }).toList(growable: false);
}

List<PickLineGroup> orderedLineGroups(List<PickLineGroup> groups) {
  final List<PickLineGroup> incomplete = groups
      .where((PickLineGroup g) => !pickLineGroupEffectivelyDone(g))
      .toList();
  final List<PickLineGroup> complete = groups
      .where(pickLineGroupEffectivelyDone)
      .toList();
  return <PickLineGroup>[...incomplete, ...complete];
}

bool pickLineGroupFullyVerified(PickLineGroup g, Set<String> verifiedLineIds) {
  return g.members.every((PickingLine l) => verifiedLineIds.contains(l.id));
}

typedef PickPositionProgress = ({int done, int total});

bool pickPositionDonePicker(PickingLine line) => pickingLineEffectivelyDone(line);

bool pickPositionDoneController(PickLineGroup group, Set<String> verifiedLineIds) =>
    pickLineGroupFullyVerified(group, verifiedLineIds);

PickPositionProgress pickPositionProgressPicker(List<PickingLine> lines) {
  final int total = lines.length;
  final int done = lines.where(pickPositionDonePicker).length;
  return (done: done, total: total);
}

PickPositionProgress pickPositionProgressController(
  List<PickingLine> lines,
  Set<String> verifiedLineIds,
) {
  final List<PickLineGroup> groups = groupLinesByProduct(lines);
  final int total = groups.length;
  final int done = groups
      .where((PickLineGroup g) => pickPositionDoneController(g, verifiedLineIds))
      .length;
  return (done: done, total: total);
}

List<PickLineGroup> orderedLineGroupsController(
  List<PickLineGroup> groups,
  Set<String> verifiedLineIds,
) {
  final List<PickLineGroup> pending = <PickLineGroup>[];
  final List<PickLineGroup> done = <PickLineGroup>[];
  for (final PickLineGroup g in groups) {
    if (pickLineGroupFullyVerified(g, verifiedLineIds)) {
      done.add(g);
    } else {
      pending.add(g);
    }
  }
  final List<PickLineGroup> pendingInc = pending
      .where((PickLineGroup g) => !pickLineGroupEffectivelyDone(g))
      .toList();
  final List<PickLineGroup> pendingRest = pending
      .where(pickLineGroupEffectivelyDone)
      .toList();
  return <PickLineGroup>[...pendingInc, ...pendingRest, ...done];
}

List<PickingLine> membersOfSameCardAs(PickingDocument doc, PickingLine anchor) {
  final List<PickLineGroup> groups = groupLinesByProduct(doc.lines);
  for (final PickLineGroup g in groups) {
    if (g.members.any((PickingLine l) => l.id == anchor.id)) {
      return List<PickingLine>.from(g.members);
    }
  }
  return <PickingLine>[anchor];
}

/// Yig‘ish uchun keyingi ochiq qator (guruh ichida).
PickingLine activePickMember(PickLineGroup g) {
  for (final PickingLine l in g.members) {
    if (!l.isVipExpiryInformational && l.qtyPicked < l.qtyRequired) {
      return l;
    }
  }
  return g.members.first;
}
