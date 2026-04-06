import 'package:shared_preferences/shared_preferences.dart';

/// Persists bearer token — same key as React Native `client.ts` (`@wms_access_token`).
class AuthTokenStorage {
  AuthTokenStorage(this._prefs);

  static const String tokenKey = '@wms_access_token';

  final SharedPreferences _prefs;

  String? readToken() {
    return _prefs.getString(tokenKey);
  }

  Future<void> writeToken(String? token) async {
    if (token != null && token.isNotEmpty) {
      await _prefs.setString(tokenKey, token);
    } else {
      await _prefs.remove(tokenKey);
    }
  }
}
