import 'package:dio/dio.dart';

import '../../../core/network/app_dio.dart';

enum ScannerResolveType { product, location, unknown }

class ScannerResolveOut {
  const ScannerResolveOut({
    required this.type,
    required this.productId,
    required this.productName,
    required this.productBarcode,
    required this.locationId,
    required this.locationCode,
    required this.entityId,
    required this.displayLabel,
    required this.message,
    this.scanKind,
    this.unitsPerScan,
  });

  final ScannerResolveType type;
  final String? productId;
  final String? productName;
  final String? productBarcode;
  final String? locationId;
  final String? locationCode;
  final String? entityId;
  final String? displayLabel;
  final String? message;
  /// `unit` yoki `box` (quti shtrix-kodi).
  final String? scanKind;
  final int? unitsPerScan;

  factory ScannerResolveOut.fromJson(Map<String, Object?> json) {
    final String t = (json['type'] as String? ?? 'UNKNOWN').toUpperCase();
    final ScannerResolveType type = switch (t) {
      'PRODUCT' => ScannerResolveType.product,
      'LOCATION' => ScannerResolveType.location,
      _ => ScannerResolveType.unknown,
    };
    final Object? prod = json['product'];
    String? pid;
    String? pname;
    String? pbar;
    if (prod is Map) {
      final Map<String, Object?> m = Map<String, Object?>.from(prod);
      pid = m['id'] as String?;
      pname = m['name'] as String?;
      pbar = m['barcode'] as String?;
    }
    final Object? loc = json['location'];
    String? lid;
    String? lcode;
    if (loc is Map) {
      final Map<String, Object?> m = Map<String, Object?>.from(loc);
      lid = m['id'] as String?;
      lcode = m['code'] as String?;
    }
    final Object? unitsRaw = json['units_per_scan'];
    int? unitsPerScan;
    if (unitsRaw is int) {
      unitsPerScan = unitsRaw;
    } else if (unitsRaw is num) {
      unitsPerScan = unitsRaw.round();
    }
    return ScannerResolveOut(
      type: type,
      productId: pid,
      productName: pname,
      productBarcode: pbar,
      locationId: lid,
      locationCode: lcode,
      entityId: json['entity_id'] as String?,
      displayLabel: json['display_label'] as String?,
      message: json['message'] as String?,
      scanKind: json['scan_kind'] as String?,
      unitsPerScan: unitsPerScan,
    );
  }

  bool get isBoxScan => scanKind == 'box' && (unitsPerScan ?? 0) > 0;
}

class ScannerRepository {
  ScannerRepository(this._dio);

  final Dio _dio;

  Future<ScannerResolveOut> resolveBarcode(String barcode) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/scanner/resolve',
        data: <String, String>{'barcode': barcode.trim()},
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('resolve');
      }
      return ScannerResolveOut.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }
}
