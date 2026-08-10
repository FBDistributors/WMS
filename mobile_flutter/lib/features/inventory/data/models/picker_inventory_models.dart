// DTOs mirroring React Native `api/inventory.ts` (picker list + locations).

class PickerLotInfo {
  const PickerLotInfo({
    required this.locationCode,
    required this.batchNo,
    required this.expiryDate,
    required this.availableQty,
    required this.reservedQty,
  });

  final String locationCode;
  final String batchNo;
  final String? expiryDate;
  final double availableQty;
  final double reservedQty;

  factory PickerLotInfo.fromJson(Map<String, Object?> json) {
    return PickerLotInfo(
      locationCode: _reqString(json, 'location_code'),
      batchNo: _reqString(json, 'batch_no'),
      expiryDate: json['expiry_date'] as String?,
      availableQty: _reqNum(json, 'available_qty'),
      reservedQty: _reqNum(json, 'reserved_qty'),
    );
  }
}

class PickerInventoryItem {
  const PickerInventoryItem({
    required this.productId,
    required this.name,
    required this.code,
    required this.mainBarcode,
    required this.bestLocation,
    required this.onHandQty,
    required this.availableQty,
    required this.nearestExpiry,
    required this.topLocations,
  });

  final String productId;
  final String name;
  final String code;
  final String? mainBarcode;
  final String? bestLocation;
  final double onHandQty;
  final double availableQty;
  final String? nearestExpiry;
  final List<PickerLotInfo> topLocations;

  factory PickerInventoryItem.fromJson(Map<String, Object?> json) {
    final Object? top = json['top_locations'];
    final List<PickerLotInfo> lots = top is List
        ? top
            .whereType<Map<dynamic, dynamic>>()
            .map(
              (Map<dynamic, dynamic> m) =>
                  PickerLotInfo.fromJson(Map<String, Object?>.from(m)),
            )
            .toList(growable: false)
        : const <PickerLotInfo>[];

    return PickerInventoryItem(
      productId: _reqString(json, 'product_id'),
      name: _reqString(json, 'name'),
      code: _reqString(json, 'code'),
      mainBarcode: json['main_barcode'] as String?,
      bestLocation: json['best_location'] as String?,
      onHandQty: _reqNum(json, 'on_hand_qty'),
      availableQty: _reqNum(json, 'available_qty'),
      nearestExpiry: json['nearest_expiry'] as String?,
      topLocations: lots,
    );
  }
}

class PickerInventoryListResponse {
  const PickerInventoryListResponse({
    required this.items,
    required this.nextCursor,
  });

  final List<PickerInventoryItem> items;
  final String? nextCursor;

  factory PickerInventoryListResponse.fromJson(Map<String, Object?> json) {
    final Object? rawItems = json['items'];
    final List<PickerInventoryItem> items = rawItems is List
        ? rawItems
            .whereType<Map<dynamic, dynamic>>()
            .map(
              (Map<dynamic, dynamic> m) =>
                  PickerInventoryItem.fromJson(Map<String, Object?>.from(m)),
            )
            .toList(growable: false)
        : const <PickerInventoryItem>[];

    return PickerInventoryListResponse(
      items: items,
      nextCursor: json['next_cursor'] as String?,
    );
  }
}

class PickerLocationOption {
  const PickerLocationOption({
    required this.id,
    required this.code,
    required this.name,
    required this.zoneType,
    required this.expiredSlot,
    required this.expiredDisplayLabel,
  });

  final String id;
  final String code;
  final String name;
  final String? zoneType;
  final String? expiredSlot;
  final int? expiredDisplayLabel;

  factory PickerLocationOption.fromJson(Map<String, Object?> json) {
    final Object? label = json['expired_display_label'];
    int? displayLabel;
    if (label is int) {
      displayLabel = label;
    } else if (label is num) {
      displayLabel = label.toInt();
    }

    return PickerLocationOption(
      id: _reqString(json, 'id'),
      code: _reqString(json, 'code'),
      name: json['name'] is String ? json['name']! as String : '',
      zoneType: json['zone_type'] as String?,
      expiredSlot: json['expired_slot'] as String?,
      expiredDisplayLabel: displayLabel,
    );
  }
}

class PickerSealedBoxLine {
  const PickerSealedBoxLine({
    required this.boxBarcode,
    required this.unitsPerBox,
    this.count = 1,
  });

  final String boxBarcode;
  final int unitsPerBox;
  final int count;

  factory PickerSealedBoxLine.fromJson(Map<String, Object?> json) {
    return PickerSealedBoxLine(
      boxBarcode: json['box_barcode'] as String? ?? '',
      unitsPerBox: _int(json['units_per_box']),
      count: _int(json['count']) < 1 ? 1 : _int(json['count']),
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'box_barcode': boxBarcode,
        'units_per_box': unitsPerBox,
        'count': count,
      };
}

class PickerProductLocation {
  const PickerProductLocation({
    required this.locationId,
    required this.locationCode,
    required this.lotId,
    required this.batchNo,
    required this.expiryDate,
    required this.onHandQty,
    required this.reservedQty,
    required this.availableQty,
    this.boxCount = 0,
    this.unitsInBoxes = 0,
    this.looseUnits = 0,
    this.sealedBoxes = const <PickerSealedBoxLine>[],
  });

  final String locationId;
  final String locationCode;
  final String lotId;
  final String batchNo;
  final String? expiryDate;
  final double onHandQty;
  final double reservedQty;
  final double availableQty;
  final int boxCount;
  final int unitsInBoxes;
  final int looseUnits;
  final List<PickerSealedBoxLine> sealedBoxes;

  factory PickerProductLocation.fromJson(Map<String, Object?> json) {
    return PickerProductLocation(
      locationId: _reqString(json, 'location_id'),
      locationCode: _reqString(json, 'location_code'),
      lotId: _reqString(json, 'lot_id'),
      batchNo: _reqString(json, 'batch_no'),
      expiryDate: json['expiry_date'] as String?,
      onHandQty: _reqNum(json, 'on_hand_qty'),
      reservedQty: _reqNum(json, 'reserved_qty'),
      availableQty: _reqNum(json, 'available_qty'),
      boxCount: _int(json['box_count']),
      unitsInBoxes: _int(json['units_in_boxes']),
      looseUnits: _int(json['loose_units']),
      sealedBoxes: parsePickerSealedBoxes(json['sealed_boxes']),
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

List<PickerSealedBoxLine> parsePickerSealedBoxes(Object? raw) {
  if (raw is! List) {
    return const <PickerSealedBoxLine>[];
  }
  return raw
      .whereType<Map<dynamic, dynamic>>()
      .map(
        (Map<dynamic, dynamic> m) => PickerSealedBoxLine.fromJson(
          Map<String, Object?>.from(m),
        ),
      )
      .where((PickerSealedBoxLine line) => line.boxBarcode.trim().isNotEmpty)
      .toList(growable: false);
}

List<PickerSealedBoxLine> mergePickerSealedBoxLines(
  List<PickerSealedBoxLine> a,
  List<PickerSealedBoxLine> b,
) {
  final Map<String, PickerSealedBoxLine> byKey = <String, PickerSealedBoxLine>{};
  for (final PickerSealedBoxLine line in <PickerSealedBoxLine>[...a, ...b]) {
    final String key = '${line.boxBarcode.trim()}\u0000${line.unitsPerBox}';
    final PickerSealedBoxLine? existing = byKey[key];
    if (existing == null) {
      byKey[key] = line;
    } else {
      byKey[key] = PickerSealedBoxLine(
        boxBarcode: existing.boxBarcode,
        unitsPerBox: existing.unitsPerBox,
        count: existing.count + line.count,
      );
    }
  }
  final List<PickerSealedBoxLine> sorted = byKey.values.toList(growable: false)
    ..sort((PickerSealedBoxLine x, PickerSealedBoxLine y) {
      return x.boxBarcode.compareTo(y.boxBarcode);
    });
  return sorted;
}

/// Detail UI: label faqat birinchi qatorda, keyingilari indent.
List<String> sealedBoxBarcodeDisplayLines({
  required String label,
  required List<PickerSealedBoxLine> sealedBoxes,
}) {
  if (sealedBoxes.isEmpty) {
    return const <String>[];
  }
  final List<PickerSealedBoxLine> sorted = List<PickerSealedBoxLine>.from(sealedBoxes)
    ..sort((PickerSealedBoxLine a, PickerSealedBoxLine b) {
      return a.boxBarcode.compareTo(b.boxBarcode);
    });
  final List<String> lines = <String>[];
  for (int i = 0; i < sorted.length; i++) {
    final PickerSealedBoxLine line = sorted[i];
    final String suffix = line.count > 1 ? ' (${line.count} × ${line.unitsPerBox})' : '';
    if (i == 0) {
      lines.add('$label: ${line.boxBarcode}$suffix');
    } else {
      lines.add('${line.boxBarcode}$suffix');
    }
  }
  return lines;
}

class PickerProductDetailResponse {
  const PickerProductDetailResponse({
    required this.productId,
    required this.name,
    required this.code,
    required this.mainBarcode,
    required this.locations,
  });

  final String productId;
  final String name;
  final String code;
  final String? mainBarcode;
  final List<PickerProductLocation> locations;

  factory PickerProductDetailResponse.fromJson(Map<String, Object?> json) {
    final Object? locs = json['locations'];
    final List<PickerProductLocation> list = locs is List
        ? locs
            .whereType<Map<dynamic, dynamic>>()
            .map(
              (Map<dynamic, dynamic> m) => PickerProductLocation.fromJson(
                Map<String, Object?>.from(m),
              ),
            )
            .toList(growable: false)
        : const <PickerProductLocation>[];
    return PickerProductDetailResponse(
      productId: _reqString(json, 'product_id'),
      name: _reqString(json, 'name'),
      code: _reqString(json, 'code'),
      mainBarcode: json['main_barcode'] as String?,
      locations: list,
    );
  }
}

class InventoryByBarcodeLocation {
  const InventoryByBarcodeLocation({
    required this.locationCode,
    required this.availableQty,
  });

  final String locationCode;
  final double availableQty;

  factory InventoryByBarcodeLocation.fromJson(Map<String, Object?> json) {
    return InventoryByBarcodeLocation(
      locationCode: _reqString(json, 'location_code'),
      availableQty: _reqNum(json, 'available_qty'),
    );
  }
}

class InventoryByBarcodeResponse {
  const InventoryByBarcodeResponse({
    required this.productId,
    required this.name,
    required this.barcode,
    required this.brand,
    required this.bestLocations,
    required this.totalAvailable,
    this.scanKind = 'unit',
    this.scannedBarcode,
    this.unitsPerBox,
    this.boxBarcode,
  });

  final String productId;
  final String name;
  final String? barcode;
  final String? brand;
  final List<InventoryByBarcodeLocation> bestLocations;
  final double totalAvailable;
  final String scanKind;
  final String? scannedBarcode;
  final int? unitsPerBox;
  final String? boxBarcode;

  factory InventoryByBarcodeResponse.fromJson(Map<String, Object?> json) {
    final Object? best = json['best_locations'];
    final List<InventoryByBarcodeLocation> locs = best is List
        ? best
            .whereType<Map<dynamic, dynamic>>()
            .map(
              (Map<dynamic, dynamic> m) => InventoryByBarcodeLocation.fromJson(
                    Map<String, Object?>.from(m),
                  ),
            )
            .toList(growable: false)
        : const <InventoryByBarcodeLocation>[];
    return InventoryByBarcodeResponse(
      productId: _reqString(json, 'product_id'),
      name: _reqString(json, 'name'),
      barcode: json['barcode'] as String?,
      brand: json['brand'] as String?,
      bestLocations: locs,
      totalAvailable: _reqNum(json, 'total_available'),
      scanKind: json['scan_kind'] as String? ?? 'unit',
      scannedBarcode: json['scanned_barcode'] as String?,
      unitsPerBox: _optionalInt(json['units_per_box']),
      boxBarcode: json['box_barcode'] as String?,
    );
  }
}

int? _optionalInt(Object? v) {
  if (v is int) {
    return v;
  }
  if (v is num) {
    return v.round();
  }
  return null;
}

/// Sektor ichidagi bitta joy — inventarizatsiya ro'yxati uchun.
class SectorLocationInfo {
  const SectorLocationInfo({
    required this.id,
    required this.code,
    required this.itemsCount,
    required this.blocked,
    required this.blockingOrders,
  });

  final String id;
  final String code;
  final int itemsCount;

  /// Rezervdagi tovar bor — sanab bo'lmaydi.
  final bool blocked;
  final List<String> blockingOrders;

  factory SectorLocationInfo.fromJson(Map<String, Object?> json) {
    final Object? orders = json['blocking_orders'];
    return SectorLocationInfo(
      id: (json['id'] ?? '').toString(),
      code: (json['code'] ?? '').toString(),
      itemsCount: (json['items_count'] as num?)?.toInt() ?? 0,
      blocked: json['blocked'] == true,
      blockingOrders: orders is List
          ? orders.map((Object? e) => '$e').toList(growable: false)
          : const <String>[],
    );
  }
}

class SectorContents {
  const SectorContents({
    required this.sector,
    required this.locations,
    required this.blockedCount,
  });

  final String sector;
  final List<SectorLocationInfo> locations;
  final int blockedCount;

  factory SectorContents.fromJson(Map<String, Object?> json) {
    final Object? locs = json['locations'];
    return SectorContents(
      sector: (json['sector'] ?? '').toString(),
      locations: locs is List
          ? locs
              .whereType<Map<dynamic, dynamic>>()
              .map((Map<dynamic, dynamic> m) =>
                  SectorLocationInfo.fromJson(Map<String, Object?>.from(m)))
              .toList(growable: false)
          : const <SectorLocationInfo>[],
      blockedCount: (json['blocked_count'] as num?)?.toInt() ?? 0,
    );
  }
}

class LocationContentsItem {
  const LocationContentsItem({
    required this.productId,
    required this.lotId,
    required this.locationId,
    required this.productName,
    required this.productCode,
    required this.barcode,
    required this.batchNo,
    required this.expiryDate,
    required this.availableQty,
  });

  final String productId;
  final String lotId;
  final String locationId;
  final String productName;
  final String productCode;
  final String? barcode;
  final String batchNo;
  final String? expiryDate;
  final double availableQty;

  factory LocationContentsItem.fromJson(Map<String, Object?> json) {
    return LocationContentsItem(
      productId: _reqString(json, 'product_id'),
      lotId: _reqString(json, 'lot_id'),
      locationId: _reqString(json, 'location_id'),
      productName: _reqString(json, 'product_name'),
      productCode: _reqString(json, 'product_code'),
      barcode: json['barcode'] as String?,
      batchNo: _reqString(json, 'batch_no'),
      expiryDate: json['expiry_date'] as String?,
      availableQty: _reqNum(json, 'available_qty'),
    );
  }
}

class LocationContentsResponse {
  const LocationContentsResponse({
    required this.locationId,
    required this.locationCode,
    required this.items,
  });

  final String locationId;
  final String locationCode;
  final List<LocationContentsItem> items;

  factory LocationContentsResponse.fromJson(Map<String, Object?> json) {
    final Object? raw = json['items'];
    final List<LocationContentsItem> items = raw is List
        ? raw
            .whereType<Map<dynamic, dynamic>>()
            .map(
              (Map<dynamic, dynamic> m) =>
                  LocationContentsItem.fromJson(Map<String, Object?>.from(m)),
            )
            .toList(growable: false)
        : const <LocationContentsItem>[];
    return LocationContentsResponse(
      locationId: _reqString(json, 'location_id'),
      locationCode: _reqString(json, 'location_code'),
      items: items,
    );
  }
}

String _reqString(Map<String, Object?> json, String key) {
  final Object? v = json[key];
  if (v is String) {
    return v;
  }
  if (v != null) {
    return v.toString();
  }
  throw FormatException('Missing or invalid string field: $key');
}

double _reqNum(Map<String, Object?> json, String key) {
  final Object? v = json[key];
  if (v is num) {
    return v.toDouble();
  }
  if (v is String) {
    return double.tryParse(v) ?? 0;
  }
  throw FormatException('Missing or invalid number field: $key');
}
