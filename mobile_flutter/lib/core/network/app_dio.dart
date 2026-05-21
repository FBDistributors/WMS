import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/api_config.dart';
import '../storage/auth_token_storage.dart';
import '../storage/shared_preferences_provider.dart';

const String unauthorizedMessage = 'UNAUTHORIZED';

final authTokenStorageProvider = Provider<AuthTokenStorage>((Ref ref) {
  return AuthTokenStorage(ref.watch(sharedPreferencesProvider));
});

final appDioProvider = Provider<Dio>((Ref ref) {
  final AuthTokenStorage storage = ref.watch(authTokenStorageProvider);
  final Dio dio = Dio(
    BaseOptions(
      baseUrl: ApiConfig.apiV1Base,
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 20),
      headers: const <String, String>{
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ),
  );

  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (RequestOptions options, RequestInterceptorHandler handler) {
        final String? token = storage.readToken();
        if (token != null && token.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (DioException err, ErrorInterceptorHandler handler) async {
        if (err.response?.statusCode == 401) {
          await storage.writeToken(null);
          return handler.reject(
            DioException(
              requestOptions: err.requestOptions,
              error: Exception(unauthorizedMessage),
              type: err.type,
              response: err.response,
            ),
          );
        }
        return handler.next(err);
      },
    ),
  );

  return dio;
});

String mapDioExceptionToMessage(DioException err) {
  final int? status = err.response?.statusCode;

  if (status == 401) {
    return unauthorizedMessage;
  }

  final Object? data = err.response?.data;
  if (data is Map<String, Object?>) {
    final Object? detail = data['detail'];
    if (detail is String && detail.trim().isNotEmpty) {
      return detail;
    }
    if (detail is Map<String, Object?>) {
      final Object? m = detail['message'];
      if (m is String && m.trim().isNotEmpty) {
        return m;
      }
    }
    if (detail is List) {
      final Iterable<String> parts = detail
          .map((Object? e) => e == null ? '' : e.toString().trim())
          .where((String s) => s.isNotEmpty);
      if (parts.isNotEmpty) {
        return parts.join('; ');
      }
    }
  }

  if (status == 404) {
    final String url =
        '${err.requestOptions.baseUrl}${err.requestOptions.path}';
    return "Yo'l topilmadi (404). Tekshiring: $url";
  }
  if (status == 500) {
    return "Server xatosi (500). Keyinroq urinib ko'ring yoki administrator bilan bog'laning.";
  }
  if (status != null && status >= 500) {
    return 'Server xatosi. Keyinroq urinib ko\'ring.';
  }
  return err.message ?? 'Tarmoq xatosi';
}
