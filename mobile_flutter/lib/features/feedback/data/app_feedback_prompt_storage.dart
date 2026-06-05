import 'package:shared_preferences/shared_preferences.dart';

/// Cooldown state for automatic in-app feedback prompts.
class AppFeedbackPromptStorage {
  static const String submittedAtKey = 'app_feedback_submitted_at_v1';
  static const String dismissedUntilKey = 'app_feedback_dismissed_until_v1';
  static const String snoozeUntilKey = 'app_feedback_snooze_until_v1';

  static DateTime? _readInstant(SharedPreferences prefs, String key) {
    final String? raw = prefs.getString(key);
    if (raw == null || raw.isEmpty) {
      return null;
    }
    return DateTime.tryParse(raw);
  }

  static bool shouldShowAutomaticPrompt(SharedPreferences prefs, DateTime now) {
    final DateTime? dismissed = _readInstant(prefs, dismissedUntilKey);
    if (dismissed != null && dismissed.isAfter(now)) {
      return false;
    }
    final DateTime? snooze = _readInstant(prefs, snoozeUntilKey);
    if (snooze != null && snooze.isAfter(now)) {
      return false;
    }
    final DateTime? submitted = _readInstant(prefs, submittedAtKey);
    if (submitted != null && now.difference(submitted).inDays < 7) {
      return false;
    }
    return true;
  }

  static Future<void> recordSubmitted(SharedPreferences prefs) async {
    await prefs.setString(submittedAtKey, DateTime.now().toIso8601String());
  }

  static Future<void> recordLater(SharedPreferences prefs) async {
    final DateTime until = DateTime.now().add(const Duration(days: 14));
    await prefs.setString(snoozeUntilKey, until.toIso8601String());
  }

  static Future<void> recordNever(SharedPreferences prefs) async {
    final DateTime until = DateTime.now().add(const Duration(days: 30));
    await prefs.setString(dismissedUntilKey, until.toIso8601String());
  }
}
