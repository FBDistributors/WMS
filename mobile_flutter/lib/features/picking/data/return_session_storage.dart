import 'package:shared_preferences/shared_preferences.dart';

/// Ilova yopilganda / tarmoq uzilganda qaytarish sessiyasini eslab qolish.
class ReturnSessionStorage {
  static const String key = 'wms_safe_cancel_return_session_id_v1';

  static Future<void> save(SharedPreferences prefs, String sessionId) async {
    await prefs.setString(key, sessionId.trim());
  }

  static Future<void> clear(SharedPreferences prefs) async {
    await prefs.remove(key);
  }

  static String? read(SharedPreferences prefs) => prefs.getString(key);
}
