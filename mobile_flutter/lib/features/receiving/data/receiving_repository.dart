import 'package:dio/dio.dart';

import '../../../core/network/app_dio.dart';
import 'receiving_models.dart';

class ReceivingRepository {
  ReceivingRepository(this._dio);

  final Dio _dio;

  Future<Receipt> createReceipt({
    String? docNo,
    required List<ReceiptLineCreate> lines,
    // True bo'lsa backend qabulni atomik yaratadi va yakunlaydi:
    // xato bo'lsa qoralama (draft) saqlanib qolmaydi.
    bool complete = false,
  }) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/receiving/receipts',
        data: <String, Object?>{
          if (docNo != null) 'doc_no': docNo,
          if (complete) 'complete': true,
          'lines': lines.map((ReceiptLineCreate e) => e.toJson()).toList(),
        },
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('receipt');
      }
      return Receipt.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }

  Future<Receipt> completeReceipt(String receiptId) async {
    try {
      final Response<Object?> res = await _dio.post<Object?>(
        '/receiving/receipts/$receiptId/complete',
      );
      final Object? data = res.data;
      if (data is! Map) {
        throw const FormatException('complete receipt');
      }
      return Receipt.fromJson(Map<String, Object?>.from(data));
    } on DioException catch (e) {
      throw Exception(mapDioExceptionToMessage(e));
    }
  }
}
