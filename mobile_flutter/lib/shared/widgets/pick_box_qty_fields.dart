import 'dart:async' show unawaited;
import 'dart:math' show max, min;

import 'package:flutter/material.dart';

import '../../core/app_state/app_locale.dart';
import '../../features/picking/data/picking_models.dart';
import '../../features/product_boxes/box_qty_breakdown.dart';
import '../../l10n/string_lookup.dart';
import '../input/input_clear_button.dart';
import '../input/stock_quantity_input.dart';
import 'scan_action_button.dart';

/// Terish modali: Dona / Quti bo'yicha (kirim uslubida).
class PickBoxQtyFields extends StatelessWidget {
  const PickBoxQtyFields({
    super.key,
    required this.loc,
    required this.mode,
    required this.onModeChanged,
    required this.unitQty,
    required this.boxCount,
    required this.unitsPerBox,
    required this.maxUnits,
    required this.onFieldsChanged,
    this.looseUnits,
  });

  final AppLocale loc;
  final String mode;
  final ValueChanged<String> onModeChanged;
  final TextEditingController unitQty;
  final TextEditingController boxCount;
  final int? unitsPerBox;
  final double maxUnits;
  final VoidCallback onFieldsChanged;
  final int? looseUnits;

  void _syncBoxQty() {
    final int? upb = unitsPerBox;
    final int bc = int.tryParse(boxCount.text.trim()) ?? 0;
    if (upb != null && bc > 0) {
      final int total = upb * bc;
      final int capped = min(total, maxUnits.round());
      unitQty.text = '$capped';
    }
    onFieldsChanged();
  }

  @override
  Widget build(BuildContext context) {
    final int? upb = unitsPerBox;
    final int bc = int.tryParse(boxCount.text.trim()) ?? 0;
    final int? totalUnits = upb != null && bc > 0 ? upb * bc : null;
    final int maxPick = max(0, maxUnits.round());
    final int? loose = looseUnits;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        SegmentedButton<String>(
          segments: <ButtonSegment<String>>[
            ButtonSegment<String>(
              value: 'byUnit',
              label: Text(StringLookup.t(loc, 'kirimNewQtyTabByUnit')),
            ),
            ButtonSegment<String>(
              value: 'byBox',
              label: Text(StringLookup.t(loc, 'kirimNewQtyTabByBox')),
            ),
          ],
          selected: <String>{mode},
          onSelectionChanged: (Set<String> sel) {
            if (sel.isEmpty) {
              return;
            }
            onModeChanged(sel.first);
          },
        ),
        if (loose != null &&
            loose < maxPick &&
            (unitsPerBox ?? 0) > 0 &&
            mode == 'byUnit') ...<Widget>[
          const SizedBox(height: 8),
          Text(
            StringLookup.t(loc, 'pickUseBoxScan'),
            style: TextStyle(fontSize: 12, color: Colors.orange.shade800),
          ),
        ],
        const SizedBox(height: 12),
        if (mode == 'byBox') ...<Widget>[
          InputDecorator(
            decoration: InputDecoration(
              labelText: StringLookup.t(loc, 'kirimNewUnitsPerBox'),
              border: const OutlineInputBorder(),
            ),
            child: Text(
              upb?.toString() ?? '—',
              style: TextStyle(
                fontSize: 16,
                color: upb != null ? null : Colors.grey.shade600,
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: boxCount,
            keyboardType: kStockQtyKeyboardType,
            inputFormatters: kStockQtyInputFormatters,
            decoration: InputDecoration(
              labelText: StringLookup.t(loc, 'kirimNewBoxCount'),
              border: const OutlineInputBorder(),
              suffixIcon: buildInputClearButton(
                visible:
                    boxCount.text.trim().isNotEmpty && boxCount.text.trim() != '1',
                onPressed: () {
                  boxCount.text = '1';
                  _syncBoxQty();
                },
              ),
            ),
            onChanged: (_) => _syncBoxQty(),
          ),
          if (totalUnits != null) ...<Widget>[
            const SizedBox(height: 12),
            Text(
              StringLookup.tParams(
                loc,
                'kirimNewTotalUnits',
                <String, String>{'total': '${min(totalUnits, maxPick)}'},
              ),
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ],
        ] else ...<Widget>[
          TextField(
            controller: unitQty,
            keyboardType: kStockQtyKeyboardType,
            inputFormatters: kStockQtyInputFormatters,
            decoration: InputDecoration(
              labelText: StringLookup.t(loc, 'qtyShort'),
              border: const OutlineInputBorder(),
              suffixIcon: buildInputClearButton(
                visible: unitQty.text.trim().isNotEmpty,
                onPressed: () {
                  unitQty.clear();
                  onFieldsChanged();
                },
              ),
            ),
            onChanged: (_) => onFieldsChanged(),
          ),
        ],
      ],
    );
  }
}

/// Quti skan natijasiga qarab terish miqdorini hisoblash.
int pickQtyFromBoxMode({
  required String mode,
  required TextEditingController unitQty,
  required TextEditingController boxCount,
  required int? unitsPerBox,
  required double maxUnits,
}) {
  final int maxPick = max(0, maxUnits.round());
  if (mode == 'byBox') {
    final int upb = unitsPerBox ?? 0;
    final int bc = int.tryParse(boxCount.text.trim()) ?? 0;
    if (upb < 1 || bc < 1) {
      return 0;
    }
    return min(upb * bc, maxPick);
  }
  return int.tryParse(unitQty.text.trim()) ?? 0;
}

int? pickBoxCountForSubmit({
  required String mode,
  required TextEditingController boxCount,
  required int? unitsPerBox,
}) {
  if (mode != 'byBox' || (unitsPerBox ?? 0) < 1) {
    return null;
  }
  final int bc = int.tryParse(boxCount.text.trim()) ?? 0;
  return bc > 0 ? bc : null;
}

/// Gibrid terish: quti soni + qo'shimcha dona natijasi.
class PickHybridQty {
  const PickHybridQty({
    required this.total,
    required this.boxUnits,
    required this.looseUnits,
    required this.boxCount,
    required this.valid,
  });

  final int total;
  final int boxUnits;
  final int looseUnits;
  final int boxCount;
  final bool valid;
}

PickHybridQty computePickHybridQty({
  required int boxCount,
  required int looseQty,
  required int? unitsPerBox,
  required double maxUnits,
}) {
  final int maxPick = max(0, maxUnits.round());
  final int bc = max(0, boxCount);
  final int loose = max(0, looseQty);
  final int? upb = unitsPerBox;
  if (bc > 0 && (upb == null || upb < 1)) {
    return PickHybridQty(
      total: 0,
      boxUnits: 0,
      looseUnits: loose,
      boxCount: bc,
      valid: false,
    );
  }
  final int boxUnits = bc > 0 && upb != null ? bc * upb : 0;
  final int total = min(boxUnits + loose, maxPick);
  final int effectiveBoxUnits =
      bc > 0 && upb != null ? min(boxUnits, total) : 0;
  final int effectiveLoose = total - effectiveBoxUnits;
  final bool valid = total >= 1 && total <= maxPick && (bc == 0 || upb! >= 1);
  return PickHybridQty(
    total: total,
    boxUnits: effectiveBoxUnits,
    looseUnits: effectiveLoose,
    boxCount: bc,
    valid: valid,
  );
}

PickHybridQty pickHybridQtyFromControllers({
  required TextEditingController boxCount,
  required TextEditingController looseQty,
  required int? unitsPerBox,
  required double maxUnits,
}) {
  return computePickHybridQty(
    boxCount: int.tryParse(boxCount.text.trim()) ?? 0,
    looseQty: int.tryParse(looseQty.text.trim()) ?? 0,
    unitsPerBox: unitsPerBox,
    maxUnits: maxUnits,
  );
}

/// Gibrid miqdorni qolgan chegaraga sig'dirish (avval dona, keyin quti kamayadi).
void capHybridQtyToMax({
  required TextEditingController boxCount,
  required TextEditingController looseQty,
  required int? unitsPerBox,
  required double maxUnits,
}) {
  final int maxPick = max(0, maxUnits.round());
  int bc = max(0, int.tryParse(boxCount.text.trim()) ?? 0);
  int loose = max(0, int.tryParse(looseQty.text.trim()) ?? 0);
  final int upb = unitsPerBox ?? 0;

  int rawTotal() => (bc > 0 && upb >= 1 ? bc * upb : 0) + loose;

  while (rawTotal() > maxPick) {
    if (computePickHybridQty(
          boxCount: bc,
          looseQty: loose,
          unitsPerBox: upb >= 1 ? upb : null,
          maxUnits: maxUnits,
        ).total <=
        maxPick) {
      break;
    }
    if (loose > 0) {
      loose--;
    } else if (bc > 0 && upb >= 1) {
      bc--;
    } else {
      break;
    }
  }
  boxCount.text = '$bc';
  looseQty.text = '$loose';
}

/// Lokatsiyada faqat qutisiz dona (yopiq quti yo'q).
bool isLooseOnlyLocation({
  int? stockBoxCount,
  int? stockLooseUnits,
}) =>
    (stockBoxCount ?? 0) < 1 && (stockLooseUnits ?? 0) > 0;

/// Terish modali: quti skan/maydonlari faqat joyda yopiq quti (box_count >= 1) bo'lsa.
bool shouldUseLooseOnlyPickUi({
  int? stockBoxCount,
}) =>
    (stockBoxCount ?? 0) < 1;

/// Terish defaultlari: lokatsiya quti/qutisiz zaxirasiga mos.
({int boxCount, int looseQty}) computeLocationAwareHybridDefaults({
  required int maxPick,
  required int? unitsPerBox,
  int? stockBoxCount,
  int? stockLooseUnits,
  bool forControllerVerify = false,
}) {
  if (maxPick < 1) {
    return (boxCount: 0, looseQty: 0);
  }

  final int boxes = stockBoxCount ?? 0;
  final int looseStock = stockLooseUnits ?? 0;
  final int upb = unitsPerBox ?? 0;

  if (boxes < 1) {
    if (forControllerVerify) {
      return (boxCount: 0, looseQty: maxPick);
    }
    final int looseQty = looseStock > 0 ? min(maxPick, looseStock) : maxPick;
    return (boxCount: 0, looseQty: looseQty);
  }

  if (upb < 1) {
    return (boxCount: 0, looseQty: maxPick);
  }

  if (stockBoxCount != null || stockLooseUnits != null) {
    if (looseStock < 1 && boxes > 0) {
      final HybridPickPlan? plan = computeHybridPickPlan(
        total: maxPick,
        unitsPerBox: upb,
        availableLoose: 0,
      );
      if (plan != null) {
        return (boxCount: plan.fullBoxes, looseQty: plan.looseNeeded);
      }
    }
    if (boxes > 0 || looseStock > 0) {
      final HybridPickPlan? plan = computeHybridPickPlan(
        total: maxPick,
        unitsPerBox: upb,
        availableLoose: looseStock,
      );
      if (plan != null) {
        return (boxCount: plan.fullBoxes, looseQty: plan.looseNeeded);
      }
    }
  }

  return (boxCount: maxPick ~/ upb, looseQty: maxPick % upb);
}

/// Qolgan miqdorga qarab quti + qo'shimcha dona maydonlarini to'ldirish.
void applyHybridQtyDefaults({
  required TextEditingController boxCount,
  required TextEditingController looseQty,
  required int? unitsPerBox,
  required double maxUnits,
  int? stockBoxCount,
  int? stockLooseUnits,
  bool forControllerVerify = false,
}) {
  final int maxPick = max(0, maxUnits.round());
  final ({int boxCount, int looseQty}) defaults = computeLocationAwareHybridDefaults(
    maxPick: maxPick,
    unitsPerBox: unitsPerBox,
    stockBoxCount: stockBoxCount,
    stockLooseUnits: stockLooseUnits,
    forControllerVerify: forControllerVerify,
  );
  boxCount.text = '${defaults.boxCount}';
  looseQty.text = '${defaults.looseQty}';
}

/// Umumiy yig'ish: 2+ buyurtmada har buyurtma bo'yicha quti/dona defaultlari.
void applyConsolidatedHybridQtyDefaults({
  required TextEditingController boxCount,
  required TextEditingController looseQty,
  required int? unitsPerBox,
  required double maxUnits,
  required List<ConsolidatedLineItem> lines,
  int? suggestedBoxCount,
  int? suggestedLooseQty,
  int? stockBoxCount,
  int? stockLooseUnits,
}) {
  final int maxPick = max(0, maxUnits.round());
  if (maxPick < 1) {
    boxCount.text = '0';
    looseQty.text = '0';
    return;
  }
  if (isLooseOnlyLocation(
    stockBoxCount: stockBoxCount,
    stockLooseUnits: stockLooseUnits,
  )) {
    applyHybridQtyDefaults(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: unitsPerBox,
      maxUnits: maxUnits,
      stockBoxCount: stockBoxCount,
      stockLooseUnits: stockLooseUnits,
    );
    return;
  }
  if (suggestedBoxCount != null && suggestedLooseQty != null) {
    boxCount.text = '${max(0, suggestedBoxCount)}';
    looseQty.text = '${max(0, suggestedLooseQty)}';
    return;
  }
  final List<ConsolidatedLineItem> openLines = lines
      .where((ConsolidatedLineItem l) => l.qtyPicked < l.qtyRequired)
      .toList(growable: false);
  final List<int> remainders = consolidatedRemaindersByDocument(
    lines: openLines
        .map(
          (ConsolidatedLineItem l) => (
            documentId: l.documentId,
            qtyRequired: l.qtyRequired,
            qtyPicked: l.qtyPicked,
          ),
        )
        .toList(growable: false),
  );
  final int upb = unitsPerBox ?? 0;
  if (remainders.length >= 2 && upb >= 1) {
    final ({int boxCount, int looseQty})? plan = computeConsolidatedBoxLoosePlan(
      lineRemainders: remainders,
      unitsPerBox: upb,
    );
    if (plan != null) {
      boxCount.text = '${plan.boxCount}';
      looseQty.text = '${plan.looseQty}';
      return;
    }
  }
  applyHybridQtyDefaults(
    boxCount: boxCount,
    looseQty: looseQty,
    unitsPerBox: unitsPerBox,
    maxUnits: maxUnits,
    stockBoxCount: stockBoxCount,
    stockLooseUnits: stockLooseUnits,
  );
}

/// Umumiy yig'ish terish rejasi matni (buyurtma bo'yicha).
String? consolidatedPickPlanHintMessage({
  required AppLocale loc,
  required List<ConsolidatedLineItem> lines,
  required int? unitsPerBox,
  int? suggestedBoxCount,
  int? suggestedLooseQty,
}) {
  final List<ConsolidatedLineItem> openLines = lines
      .where((ConsolidatedLineItem l) => l.qtyPicked < l.qtyRequired)
      .toList(growable: false);
  if (openLines.length < 2) {
    return null;
  }
  final int upb = unitsPerBox ?? 0;
  int boxes;
  int loose;
  if (suggestedBoxCount != null && suggestedLooseQty != null) {
    boxes = max(0, suggestedBoxCount);
    loose = max(0, suggestedLooseQty);
  } else if (upb >= 1) {
    final List<int> remainders = consolidatedRemaindersByDocument(
      lines: openLines
          .map(
            (ConsolidatedLineItem l) => (
              documentId: l.documentId,
              qtyRequired: l.qtyRequired,
              qtyPicked: l.qtyPicked,
            ),
          )
          .toList(growable: false),
    );
    final ({int boxCount, int looseQty})? plan = computeConsolidatedBoxLoosePlan(
      lineRemainders: remainders,
      unitsPerBox: upb,
    );
    if (plan == null) {
      return null;
    }
    boxes = plan.boxCount;
    loose = plan.looseQty;
  } else {
    return null;
  }
  if (boxes < 1 && loose > 0) {
    return StringLookup.tParams(
      loc,
      'consolidatedPickPlanAllLoose',
      <String, String>{'loose': '$loose'},
    );
  }
  if (boxes > 0) {
    return StringLookup.tParams(
      loc,
      'consolidatedPickPlanByOrder',
      <String, String>{
        'boxes': '$boxes',
        'loose': '$loose',
      },
    );
  }
  return null;
}

/// Buyurtma bo'yicha ochiq qatorlar matni.
String consolidatedOpenLinesByOrderText({
  required List<ConsolidatedLineItem> lines,
  required String countTaLabel,
}) {
  final List<ConsolidatedLineItem> openLines = lines
      .where((ConsolidatedLineItem l) => l.qtyPicked < l.qtyRequired)
      .toList(growable: false);
  return openLines
      .map(
        (ConsolidatedLineItem l) =>
            '${l.referenceNumber}: ${(l.qtyRequired - l.qtyPicked).round()} $countTaLabel',
      )
      .join(', ');
}

/// Umumiy yig'ish: buyurtma bo'yicha ro'yxat va terish rejasi.
class ConsolidatedPickPlanBanner extends StatelessWidget {
  const ConsolidatedPickPlanBanner({
    super.key,
    required this.loc,
    required this.product,
    required this.unitsPerBox,
  });

  final AppLocale loc;
  final ConsolidatedProduct product;
  final int? unitsPerBox;

  @override
  Widget build(BuildContext context) {
    final List<ConsolidatedLineItem> openLines = product.lines
        .where((ConsolidatedLineItem l) => l.qtyPicked < l.qtyRequired)
        .toList(growable: false);
    if (openLines.length < 2) {
      return const SizedBox.shrink();
    }
    final ColorScheme cs = Theme.of(context).colorScheme;
    final String byOrder = consolidatedOpenLinesByOrderText(
      lines: product.lines,
      countTaLabel: StringLookup.t(loc, 'countTa').trim(),
    );
    final String? planHint = consolidatedPickPlanHintMessage(
      loc: loc,
      lines: product.lines,
      unitsPerBox: unitsPerBox,
      suggestedBoxCount: product.suggestedBoxCount,
      suggestedLooseQty: product.suggestedLooseQty,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          '${StringLookup.t(loc, 'consolidatedProductByOrder')}: $byOrder',
          style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant),
        ),
        if (planHint != null) ...<Widget>[
          const SizedBox(height: 8),
          Text(
            planHint,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: cs.primary,
            ),
          ),
        ],
        const SizedBox(height: 12),
      ],
    );
  }
}

int? unitsPerBoxFromAlternateLocations(List<PickingAlternateLocation> alternates) {
  for (final PickingAlternateLocation a in alternates) {
    final int? upb = _unitsPerBoxFromAlternate(a);
    if (upb != null) {
      return upb;
    }
  }
  return null;
}

int? _unitsPerBoxFromAlternate(PickingAlternateLocation a) {
  final int boxes = a.boxCount ?? 0;
  final int units = a.unitsInBoxes ?? 0;
  if (boxes < 1 || units < 1) {
    return null;
  }
  final int upb = units ~/ boxes;
  return upb >= 1 ? upb : null;
}

/// Terish qatori uchun aktiv alternate: primary, keyin locationCode, oxirgi fallback.
PickingAlternateLocation? pickActiveAlternate(
  List<PickingAlternateLocation> alternates, {
  String? locationCode,
}) {
  if (alternates.isEmpty) {
    return null;
  }
  final String preferCode = locationCode?.trim().toLowerCase() ?? '';
  if (preferCode.isNotEmpty) {
    for (final PickingAlternateLocation a in alternates) {
      if (a.isPrimary && a.locationCode.trim().toLowerCase() == preferCode) {
        return a;
      }
    }
    PickingAlternateLocation? fallback;
    for (final PickingAlternateLocation a in alternates) {
      if (a.locationCode.trim().toLowerCase() == preferCode) {
        if (a.isPrimary) {
          return a;
        }
        fallback ??= a;
      }
    }
    if (fallback != null) {
      return fallback;
    }
  }
  for (final PickingAlternateLocation a in alternates) {
    if (a.isPrimary) {
      return a;
    }
  }
  return alternates.first;
}

PickingAlternateLocation? pickLineActiveAlternate(PickingLine line) {
  return pickActiveAlternate(
    line.alternateLocations,
    locationCode: line.locationCode,
  );
}

({int? looseUnits, int? boxCount}) activeBoxHintForPickLine(PickingLine line) {
  final PickingAlternateLocation? active = pickLineActiveAlternate(line);
  if (active == null) {
    return (looseUnits: null, boxCount: null);
  }
  return (looseUnits: active.looseUnits, boxCount: active.boxCount);
}

int? unitsPerBoxForActiveAlternate(PickingAlternateLocation? active) {
  if (active == null) {
    return null;
  }
  return _unitsPerBoxFromAlternate(active);
}

/// Asosiy lokatsiyada qutisiz qoldiq va quti soni (ogohlantirish / upb uchun).
({int? looseUnits, int? boxCount}) primaryAlternateBoxHint(
  List<PickingAlternateLocation> alternates,
) {
  for (final PickingAlternateLocation a in alternates) {
    if (a.isPrimary) {
      return (looseUnits: a.looseUnits, boxCount: a.boxCount);
    }
  }
  return (looseUnits: null, boxCount: null);
}

/// Terish qatori lokatsiyasi bo'yicha qutisiz/quti zaxira (primary-first).
({int? looseUnits, int? boxCount}) alternateBoxHintForLocation(
  List<PickingAlternateLocation> alternates,
  String locationCode,
) {
  final PickingAlternateLocation? active = pickActiveAlternate(
    alternates,
    locationCode: locationCode,
  );
  if (active == null) {
    return (looseUnits: null, boxCount: null);
  }
  return (looseUnits: active.looseUnits, boxCount: active.boxCount);
}

/// Quti soni 0 bo'lsa quti barcode maydonini tozalash (open-box qisman terishda saqlanadi).
void syncHybridBoxBarcodeWithQty({
  required TextEditingController boxCount,
  TextEditingController? boxBarcode,
  TextEditingController? looseQty,
  int? stockBoxCount,
  int? stockLooseUnits,
}) {
  if (boxBarcode == null) {
    return;
  }
  if (isLooseOnlyLocation(
    stockBoxCount: stockBoxCount,
    stockLooseUnits: stockLooseUnits,
  )) {
    boxBarcode.clear();
    return;
  }
  final int bc = int.tryParse(boxCount.text.trim()) ?? 0;
  final int loose = looseQty != null
      ? (int.tryParse(looseQty.text.trim()) ?? 0)
      : 0;
  if (bc < 1 && loose > 0 && boxBarcode.text.trim().isNotEmpty) {
    return;
  }
  if (bc < 1 && boxBarcode.text.isNotEmpty) {
    boxBarcode.clear();
  }
}

int? hybridUnitsPerBoxHint({
  required int? unitsPerBox,
  PickingAlternateLocation? activeAlternate,
  List<PickingAlternateLocation>? alternates,
}) {
  if (unitsPerBox != null && unitsPerBox >= 1) {
    return unitsPerBox;
  }
  if (activeAlternate != null) {
    return unitsPerBoxForActiveAlternate(activeAlternate);
  }
  if (alternates != null && alternates.isNotEmpty) {
    return unitsPerBoxFromAlternateLocations(alternates);
  }
  return null;
}

bool hybridShowBoxOnlyHint({
  int? looseUnits,
  int? stockBoxCount,
}) {
  if (looseUnits == 0) {
    return true;
  }
  return (stockBoxCount ?? 0) > 0 && looseUnits == null;
}

/// Terish: quti-only zaxira yoki qisman ochish bo'yicha ogohlantirish matni.
String? hybridPickStockHintMessage({
  required AppLocale loc,
  required PickHybridQty hybrid,
  int? stockLooseUnits,
  int? stockBoxCount,
  String? boxBarcode,
}) {
  final int stockLoose = stockLooseUnits ?? 0;
  final int stockBoxes = stockBoxCount ?? 0;
  if (isLooseOnlyLocation(
    stockBoxCount: stockBoxCount,
    stockLooseUnits: stockLooseUnits,
  )) {
    return StringLookup.t(loc, 'pickLooseOnlyLocationHint');
  }
  if (hybrid.boxCount > 0 &&
      hybrid.looseUnits > 0 &&
      stockLoose < hybrid.looseUnits) {
    return StringLookup.tParams(
      loc,
      'pickHybridPickPlanHint',
      <String, String>{
        'boxes': '${hybrid.boxCount}',
        'loose': '${hybrid.looseUnits}',
      },
    );
  }
  if (hybrid.looseUnits > 0 && hybrid.boxCount == 0 && stockLoose < 1 && stockBoxes > 0) {
    if (boxBarcode != null && boxBarcode.trim().isNotEmpty) {
      return StringLookup.tParams(
        loc,
        'pickHybridOpenBoxHint',
        <String, String>{'loose': '${hybrid.looseUnits}'},
      );
    }
    return StringLookup.t(loc, 'pickUseBoxScan');
  }
  if (hybrid.looseUnits > 0 &&
      hybrid.boxCount == 0 &&
      stockLoose < hybrid.looseUnits) {
    return StringLookup.tParams(
      loc,
      'pickHybridOpenBoxHint',
      <String, String>{'loose': '${hybrid.looseUnits}'},
    );
  }
  if (stockLoose == 0 && stockBoxes > 0 && hybrid.looseUnits < 1) {
    return StringLookup.t(loc, 'pickUseBoxScan');
  }
  return null;
}

/// Quti skan qilingandan keyin quti hajmi maydonini ko'rsatish.
bool hybridShowUnitsPerBoxField({
  required TextEditingController? boxBarcode,
  required TextEditingController boxCount,
}) {
  if (boxBarcode != null && boxBarcode.text.trim().isNotEmpty) {
    return true;
  }
  return (int.tryParse(boxCount.text.trim()) ?? 0) > 0;
}

/// Terish: quti + qutisiz dona bitta panelda (skan avval, soni keyin).
class PickHybridQtyFields extends StatelessWidget {
  const PickHybridQtyFields({
    super.key,
    required this.loc,
    required this.boxCount,
    required this.looseQty,
    required this.unitsPerBox,
    required this.maxUnits,
    required this.onFieldsChanged,
    this.looseUnits,
    this.stockBoxCount,
    this.boxBarcode,
    this.productBarcode,
    this.onBoxBarcodeChanged,
    this.onProductBarcodeChanged,
    this.onScanBox,
    this.onScanProduct,
    this.onBoxBarcodeSubmitted,
    this.onProductBarcodeSubmitted,
    this.busy = false,
    this.controllerVerifyMode = false,
  });

  final AppLocale loc;
  final TextEditingController boxCount;
  final TextEditingController looseQty;
  final int? unitsPerBox;
  final double maxUnits;
  final VoidCallback onFieldsChanged;
  final int? looseUnits;
  final int? stockBoxCount;
  final TextEditingController? boxBarcode;
  final TextEditingController? productBarcode;
  final VoidCallback? onBoxBarcodeChanged;
  final VoidCallback? onProductBarcodeChanged;
  final VoidCallback? onScanBox;
  final VoidCallback? onScanProduct;
  final Future<void> Function(String code)? onBoxBarcodeSubmitted;
  final Future<void> Function(String code)? onProductBarcodeSubmitted;
  final bool busy;
  /// Controller tekshiruvi: yig‘ish turiga qarab quti va/yoki mahsulot skani.
  final bool controllerVerifyMode;

  Widget _barcodeScanRow({
    required TextEditingController controller,
    required String label,
    required String fieldLabel,
    required VoidCallback? onScan,
    required Future<void> Function(String code)? onSubmitted,
    required VoidCallback? onChanged,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: <Widget>[
        Expanded(
          child: TextField(
            controller: controller,
            enabled: !busy,
            decoration: InputDecoration(
              labelText: fieldLabel,
              border: const OutlineInputBorder(),
            ),
            onChanged: (_) => onChanged?.call(),
            onSubmitted: (String v) {
              final Future<void> Function(String code)? handler = onSubmitted;
              if (handler != null) {
                unawaited(handler(v));
              }
            },
          ),
        ),
        const SizedBox(width: 8),
        ScanActionButton(
          onPressed: busy || onScan == null ? null : onScan,
          label: label,
          compact: true,
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final int? upb = unitsPerBox;
    final PickHybridQty hybrid = pickHybridQtyFromControllers(
      boxCount: boxCount,
      looseQty: looseQty,
      unitsPerBox: isLooseOnlyLocation(
        stockBoxCount: stockBoxCount,
        stockLooseUnits: looseUnits,
      )
          ? null
          : upb,
      maxUnits: maxUnits,
    );

    if (controllerVerifyMode) {
      final bool needsBox = hybrid.boxCount > 0;
      final bool needsProduct = hybrid.looseUnits > 0;
      final bool canShowBoxFields = upb != null && upb >= 1;
      final bool looseOnly = isLooseOnlyLocation(
        stockBoxCount: stockBoxCount,
        stockLooseUnits: looseUnits,
      );
      final bool showBoxBarcodeField = !looseOnly &&
          canShowBoxFields &&
          boxBarcode != null &&
          onScanBox != null;
      final String? hintKey =
          needsBox && !needsProduct ? 'controllerVerifyScanBoxHint' : null;
      final String boxFieldLabel = StringLookup.t(loc, 'pickHybridBoxBarcode');
      final String boxScanLabel = StringLookup.t(loc, 'pickHybridScanBox');
      final String productFieldLabel = StringLookup.t(loc, 'pickHybridScanProduct');

      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (hintKey != null) ...<Widget>[
            Text(
              StringLookup.t(loc, hintKey),
              style: TextStyle(fontSize: 12, color: Colors.grey.shade700),
            ),
            const SizedBox(height: 12),
          ],
          if (showBoxBarcodeField) ...<Widget>[
            _barcodeScanRow(
              controller: boxBarcode!,
              label: boxScanLabel,
              fieldLabel: boxFieldLabel,
              onScan: onScanBox,
              onSubmitted: onBoxBarcodeSubmitted,
              onChanged: onBoxBarcodeChanged,
            ),
            const SizedBox(height: 12),
          ],
          if ((needsBox || showBoxBarcodeField) && canShowBoxFields) ...<Widget>[
            if (hybridShowUnitsPerBoxField(
              boxBarcode: boxBarcode,
              boxCount: boxCount,
            )) ...<Widget>[
              InputDecorator(
                decoration: InputDecoration(
                  labelText: StringLookup.t(loc, 'kirimNewUnitsPerBox'),
                  border: const OutlineInputBorder(),
                ),
                child: Text('$upb'),
              ),
              const SizedBox(height: 12),
            ],
            if (needsBox)
              InputDecorator(
                decoration: InputDecoration(
                  labelText: StringLookup.t(loc, 'kirimNewBoxCount'),
                  border: const OutlineInputBorder(),
                ),
                child: Text(boxCount.text.trim().isEmpty ? '0' : boxCount.text),
              ),
          ],
          if (showBoxBarcodeField && needsProduct) const SizedBox(height: 16),
          if (needsProduct && productBarcode != null && onScanProduct != null) ...<Widget>[
            _barcodeScanRow(
              controller: productBarcode!,
              label: productFieldLabel,
              fieldLabel: productFieldLabel,
              onScan: onScanProduct,
              onSubmitted: onProductBarcodeSubmitted,
              onChanged: onProductBarcodeChanged,
            ),
            const SizedBox(height: 12),
          ],
          if (needsProduct) ...<Widget>[
            InputDecorator(
              decoration: InputDecoration(
                labelText: StringLookup.t(loc, 'pickHybridExtraLoose'),
                border: const OutlineInputBorder(),
              ),
              child: Text(looseQty.text.trim().isEmpty ? '0' : looseQty.text),
            ),
          ],
          if (hybrid.valid && hybrid.total >= 1) ...<Widget>[
            const SizedBox(height: 12),
            Text(
              StringLookup.tParams(
                loc,
                'kirimNewTotalUnits',
                <String, String>{'total': '${hybrid.total}'},
              ),
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ],
        ],
      );
    }

    final bool looseOnly = shouldUseLooseOnlyPickUi(stockBoxCount: stockBoxCount);
    final bool hasBoxStock = !looseOnly && (stockBoxCount ?? 0) >= 1;
    final bool canEditBoxCount = hasBoxStock;
    final bool showBoxBarcodeField = canEditBoxCount &&
        boxBarcode != null &&
        onScanBox != null;
    final bool showProductBarcodeField =
        productBarcode != null && onScanProduct != null;
    final String boxFieldLabel = StringLookup.t(loc, 'pickHybridBoxBarcode');
    final String boxScanLabel = StringLookup.t(loc, 'pickHybridScanBox');
    final String productFieldLabel = StringLookup.t(loc, 'pickHybridScanProduct');
    final String? stockHint = hybridPickStockHintMessage(
      loc: loc,
      hybrid: hybrid,
      stockLooseUnits: looseUnits,
      stockBoxCount: stockBoxCount,
      boxBarcode: boxBarcode?.text,
    );

    if (looseOnly) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (stockHint != null) ...<Widget>[
            Text(
              stockHint,
              style: TextStyle(fontSize: 12, color: Colors.orange.shade800),
            ),
            const SizedBox(height: 8),
          ],
          if (productBarcode != null && onScanProduct != null) ...<Widget>[
            _barcodeScanRow(
              controller: productBarcode!,
              label: productFieldLabel,
              fieldLabel: productFieldLabel,
              onScan: onScanProduct,
              onSubmitted: onProductBarcodeSubmitted,
              onChanged: onProductBarcodeChanged,
            ),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: looseQty,
            keyboardType: kStockQtyKeyboardType,
            inputFormatters: kStockQtyInputFormatters,
            decoration: InputDecoration(
              labelText: looseOnly
                  ? StringLookup.t(loc, 'pickHybridExtraLoose')
                  : StringLookup.t(loc, 'qtyShort'),
              border: const OutlineInputBorder(),
              suffixIcon: buildInputClearButton(
                visible: looseQty.text.trim().isNotEmpty,
                onPressed: () {
                  looseQty.clear();
                  onFieldsChanged();
                },
              ),
            ),
            onChanged: (_) => onFieldsChanged(),
          ),
          if (hybrid.valid && hybrid.total >= 1) ...<Widget>[
            const SizedBox(height: 12),
            Text(
              StringLookup.tParams(
                loc,
                'kirimNewTotalUnits',
                <String, String>{'total': '${hybrid.total}'},
              ),
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ],
        ],
      );
    }

    final bool showUnitsPerBox = hybridShowUnitsPerBoxField(
      boxBarcode: boxBarcode,
      boxCount: boxCount,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (stockHint != null) ...<Widget>[
          Text(
            stockHint,
            style: TextStyle(fontSize: 12, color: Colors.orange.shade800),
          ),
          const SizedBox(height: 8),
        ],
        if (showBoxBarcodeField) ...<Widget>[
          _barcodeScanRow(
            controller: boxBarcode!,
            label: boxScanLabel,
            fieldLabel: boxFieldLabel,
            onScan: onScanBox,
            onSubmitted: onBoxBarcodeSubmitted,
            onChanged: onBoxBarcodeChanged,
          ),
          const SizedBox(height: 12),
        ],
        if (showUnitsPerBox) ...<Widget>[
          InputDecorator(
            decoration: InputDecoration(
              labelText: StringLookup.t(loc, 'kirimNewUnitsPerBox'),
              border: const OutlineInputBorder(),
            ),
            child: Text('$upb'),
          ),
          const SizedBox(height: 12),
        ],
        TextField(
          controller: boxCount,
          enabled: canEditBoxCount && !busy,
          keyboardType: kStockQtyKeyboardType,
          inputFormatters: kStockQtyInputFormatters,
          decoration: InputDecoration(
            labelText: StringLookup.t(loc, 'kirimNewBoxCount'),
            border: const OutlineInputBorder(),
            suffixIcon: buildInputClearButton(
              visible: canEditBoxCount &&
                  boxCount.text.trim().isNotEmpty &&
                  boxCount.text.trim() != '0',
              onPressed: () {
                boxCount.text = '0';
                onFieldsChanged();
              },
            ),
          ),
          onChanged: (_) {
            syncHybridBoxBarcodeWithQty(
              boxCount: boxCount,
              boxBarcode: boxBarcode,
              looseQty: looseQty,
              stockBoxCount: stockBoxCount,
              stockLooseUnits: looseUnits,
            );
            onFieldsChanged();
          },
        ),
        const SizedBox(height: 16),
        if (showProductBarcodeField) ...<Widget>[
          _barcodeScanRow(
            controller: productBarcode!,
            label: productFieldLabel,
            fieldLabel: productFieldLabel,
            onScan: onScanProduct,
            onSubmitted: onProductBarcodeSubmitted,
            onChanged: onProductBarcodeChanged,
          ),
          const SizedBox(height: 12),
        ],
        TextField(
          controller: looseQty,
          enabled: !busy,
          keyboardType: kStockQtyKeyboardType,
          inputFormatters: kStockQtyInputFormatters,
          decoration: InputDecoration(
            labelText: StringLookup.t(loc, 'pickHybridExtraLoose'),
            border: const OutlineInputBorder(),
            suffixIcon: buildInputClearButton(
              visible: looseQty.text.trim().isNotEmpty && looseQty.text.trim() != '0',
              onPressed: () {
                looseQty.text = '0';
                onFieldsChanged();
              },
            ),
          ),
          onChanged: (_) => onFieldsChanged(),
        ),
        if (hybrid.valid && hybrid.total >= 1) ...<Widget>[
          const SizedBox(height: 12),
          Text(
            StringLookup.tParams(
              loc,
              'kirimNewTotalUnits',
              <String, String>{'total': '${hybrid.total}'},
            ),
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        ],
      ],
    );
  }
}
