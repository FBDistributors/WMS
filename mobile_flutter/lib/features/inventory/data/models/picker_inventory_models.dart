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
  });

  final String productId;
  final String name;
  final String? barcode;
  final String? brand;
  final List<InventoryByBarcodeLocation> bestLocations;
  final double totalAvailable;

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
