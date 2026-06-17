class BoxLocationBreakdown {
  const BoxLocationBreakdown({
    required this.productId,
    required this.lotId,
    required this.locationId,
    required this.boxCount,
    required this.unitsInBoxes,
    required this.looseUnits,
    required this.totalUnits,
    this.sealedBoxes = const <SealedBoxInfo>[],
    this.dataInconsistent = false,
  });

  final String productId;
  final String lotId;
  final String locationId;
  final int boxCount;
  final int unitsInBoxes;
  final int looseUnits;
  final int totalUnits;
  final List<SealedBoxInfo> sealedBoxes;
  final bool dataInconsistent;

  factory BoxLocationBreakdown.fromJson(Map<String, Object?> json) {
    final Object? boxes = json['sealed_boxes'];
    final List<SealedBoxInfo> sealed = boxes is List
        ? boxes
            .whereType<Map<dynamic, dynamic>>()
            .map(
              (Map<dynamic, dynamic> m) => SealedBoxInfo.fromJson(
                Map<String, Object?>.from(m),
              ),
            )
            .toList(growable: false)
        : const <SealedBoxInfo>[];
    return BoxLocationBreakdown(
      productId: '${json['product_id']}',
      lotId: '${json['lot_id']}',
      locationId: '${json['location_id']}',
      boxCount: _int(json['box_count']),
      unitsInBoxes: _int(json['units_in_boxes']),
      looseUnits: _int(json['loose_units']),
      totalUnits: _int(json['total_units']),
      sealedBoxes: sealed,
      dataInconsistent: json['data_inconsistent'] == true,
    );
  }
}

bool isBreakdownInconsistentMessage(String message) {
  return message.contains('nomuvofiqligi') || message.contains('nomuvofiqlik');
}

class SealedBoxInfo {
  const SealedBoxInfo({
    required this.placementId,
    required this.productBoxId,
    required this.boxBarcode,
    required this.unitsPerBox,
    this.label,
  });

  final String placementId;
  final String productBoxId;
  final String boxBarcode;
  final int unitsPerBox;
  final String? label;

  factory SealedBoxInfo.fromJson(Map<String, Object?> json) {
    return SealedBoxInfo(
      placementId: '${json['placement_id']}',
      productBoxId: '${json['product_box_id']}',
      boxBarcode: json['box_barcode'] as String? ?? '',
      unitsPerBox: _int(json['units_per_box']),
      label: json['label'] as String?,
    );
  }
}

int _int(Object? v) {
  if (v is int) {
    return v;
  }
  if (v is num) {
    return v.round();
  }
  return int.tryParse('$v') ?? 0;
}
