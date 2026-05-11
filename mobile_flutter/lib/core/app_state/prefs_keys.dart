/// SharedPreferences kalitlari — React Native AsyncStorage bilan mos.
abstract final class PrefsKeys {
  static const String locale = '@wms_locale';
  static const String theme = '@wms_theme';
  static const String profileType = '@wms_profile_type';
  static const String lastUsername = '@wms_last_username';
  /// Bildirishnomalar: o‘qilgan yozuvlar ID ro‘yxati (mock yoki API qayta kelganda ham saqlanadi).
  static const String notificationReadIds = '@wms_notification_read_ids_v1';
}

