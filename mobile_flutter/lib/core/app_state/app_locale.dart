enum AppLocale {
  uz('uz'),
  ru('ru'),
  en('en');

  const AppLocale(this.code);
  final String code;

  static AppLocale fromCode(String? raw) {
    return switch (raw) {
      'ru' => AppLocale.ru,
      'en' => AppLocale.en,
      _ => AppLocale.uz,
    };
  }
}
