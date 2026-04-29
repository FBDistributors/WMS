/// API base URL — matches React Native `env.ts` (default Render).
/// Override with `--dart-define=API_BASE_URL=https://your-host` at build/run time.
class ApiConfig {
  ApiConfig._();

  static const String _prodDefault = 'https://api.fbwarehouse.uz';

  static String get rawBaseUrl {
    const String fromDefine = String.fromEnvironment(
      'API_BASE_URL',
      defaultValue: '',
    );
    if (fromDefine.trim().isNotEmpty) {
      return fromDefine.trim().replaceAll(RegExp(r'/$'), '');
    }
    return _prodDefault;
  }

  /// Same rules as RN `API_V1`: append `/api/v1` when missing.
  static String get apiV1Base {
    final String base = rawBaseUrl;
    if (base.contains('/api/v1')) {
      return base;
    }
    return '$base/api/v1';
  }
}
