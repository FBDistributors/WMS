import 'package:dio/dio.dart';

/// HTTP client for backend / ERP APIs. Configure [baseUrl] to match your environment.
class AppNetworkClient {
  AppNetworkClient({String? baseUrl, Dio? dio})
      : _dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: baseUrl ?? '',
                connectTimeout: const Duration(seconds: 30),
                receiveTimeout: const Duration(seconds: 30),
                headers: const <String, String>{
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
                },
              ),
            );

  final Dio _dio;

  Dio get client => _dio;
}
