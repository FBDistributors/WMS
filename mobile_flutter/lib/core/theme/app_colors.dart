import 'package:flutter/material.dart';

/// Markaziy semantik rang tokenlari (light + dark).
///
/// Ekranlarda qattiq `Color(0xFF...)` yozish o'rniga shu tokenlardan
/// foydalaniladi: `context.colors.textMain` va h.k. Shunda dark mode
/// avtomatik to'g'ri ranglarni oladi.
@immutable
class AppColors extends ThemeExtension<AppColors> {
  const AppColors({
    required this.pageBg,
    required this.surface,
    required this.surfaceAlt,
    required this.textMain,
    required this.textSecondary,
    required this.textFaded,
    required this.accent,
    required this.onAccent,
    required this.accentFg,
    required this.accentTint,
    required this.link,
    required this.hairline,
    required this.danger,
    required this.dangerBg,
    required this.success,
    required this.successBg,
    required this.successBorder,
  });

  /// Sahifa (scaffold) foni.
  final Color pageBg;

  /// Kartochka / panel foni (light'da oq).
  final Color surface;

  /// Biroz ajralib turadigan ichki fon (masalan input, chip).
  final Color surfaceAlt;

  /// Asosiy matn rangi.
  final Color textMain;

  /// Ikkilamchi matn (izoh, subtitle).
  final Color textSecondary;

  /// Xira matn (placeholder, disabled).
  final Color textFaded;

  /// Brend to'ldirish rangi (header, asosiy tugma foni).
  final Color accent;

  /// `accent` fon ustidagi matn/ikon rangi.
  final Color onAccent;

  /// Yuza ustidagi brend urg'usi (ikon/link/emphasis matn).
  final Color accentFg;

  /// Brend tusidagi yengil fon (tint).
  final Color accentTint;

  /// Havola rangi.
  final Color link;

  /// Ingichka chegara / ajratgich chizig'i.
  final Color hairline;

  /// Xato / kam qoldiq matn rangi.
  final Color danger;

  /// Xato fon rangi.
  final Color dangerBg;

  /// Muvaffaqiyat / yetarli qoldiq matn rangi.
  final Color success;

  /// Muvaffaqiyat fon rangi.
  final Color successBg;

  /// Muvaffaqiyat chegara rangi.
  final Color successBorder;

  static const AppColors light = AppColors(
    pageBg: Color(0xFFF0F2F5),
    surface: Color(0xFFFFFFFF),
    surfaceAlt: Color(0xFFF8FAFC),
    textMain: Color(0xFF0F172A),
    textSecondary: Color(0xFF64748B),
    textFaded: Color(0xFF94A3B8),
    accent: Color(0xFF1A237E),
    onAccent: Color(0xFFFFFFFF),
    accentFg: Color(0xFF1A237E),
    accentTint: Color(0xFFE8EAF6),
    link: Color(0xFF1565C0),
    hairline: Color(0xFFE2E8F0),
    danger: Color(0xFFC62828),
    dangerBg: Color(0xFFFDECEA),
    success: Color(0xFF2E7D32),
    successBg: Color(0xFFE8F5E9),
    successBorder: Color(0xFFA5D6A7),
  );

  static const AppColors dark = AppColors(
    pageBg: Color(0xFF0F172A),
    surface: Color(0xFF1E293B),
    surfaceAlt: Color(0xFF243247),
    textMain: Color(0xFFF1F5F9),
    textSecondary: Color(0xFF94A3B8),
    textFaded: Color(0xFF64748B),
    accent: Color(0xFF3949AB),
    onAccent: Color(0xFFFFFFFF),
    accentFg: Color(0xFF93C5FD),
    accentTint: Color(0xFF25324A),
    link: Color(0xFF93C5FD),
    hairline: Color(0xFF334155),
    danger: Color(0xFFF87171),
    dangerBg: Color(0xFF3A1D1D),
    success: Color(0xFF4ADE80),
    successBg: Color(0xFF14311C),
    successBorder: Color(0xFF2E7D32),
  );

  @override
  AppColors copyWith({
    Color? pageBg,
    Color? surface,
    Color? surfaceAlt,
    Color? textMain,
    Color? textSecondary,
    Color? textFaded,
    Color? accent,
    Color? onAccent,
    Color? accentFg,
    Color? accentTint,
    Color? link,
    Color? hairline,
    Color? danger,
    Color? dangerBg,
    Color? success,
    Color? successBg,
    Color? successBorder,
  }) {
    return AppColors(
      pageBg: pageBg ?? this.pageBg,
      surface: surface ?? this.surface,
      surfaceAlt: surfaceAlt ?? this.surfaceAlt,
      textMain: textMain ?? this.textMain,
      textSecondary: textSecondary ?? this.textSecondary,
      textFaded: textFaded ?? this.textFaded,
      accent: accent ?? this.accent,
      onAccent: onAccent ?? this.onAccent,
      accentFg: accentFg ?? this.accentFg,
      accentTint: accentTint ?? this.accentTint,
      link: link ?? this.link,
      hairline: hairline ?? this.hairline,
      danger: danger ?? this.danger,
      dangerBg: dangerBg ?? this.dangerBg,
      success: success ?? this.success,
      successBg: successBg ?? this.successBg,
      successBorder: successBorder ?? this.successBorder,
    );
  }

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) {
    if (other is! AppColors) return this;
    return AppColors(
      pageBg: Color.lerp(pageBg, other.pageBg, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surfaceAlt: Color.lerp(surfaceAlt, other.surfaceAlt, t)!,
      textMain: Color.lerp(textMain, other.textMain, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textFaded: Color.lerp(textFaded, other.textFaded, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      onAccent: Color.lerp(onAccent, other.onAccent, t)!,
      accentFg: Color.lerp(accentFg, other.accentFg, t)!,
      accentTint: Color.lerp(accentTint, other.accentTint, t)!,
      link: Color.lerp(link, other.link, t)!,
      hairline: Color.lerp(hairline, other.hairline, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      dangerBg: Color.lerp(dangerBg, other.dangerBg, t)!,
      success: Color.lerp(success, other.success, t)!,
      successBg: Color.lerp(successBg, other.successBg, t)!,
      successBorder: Color.lerp(successBorder, other.successBorder, t)!,
    );
  }
}

/// `context.colors.textMain` ko'rinishida qulay foydalanish uchun.
extension AppColorsX on BuildContext {
  AppColors get colors =>
      Theme.of(this).extension<AppColors>() ?? AppColors.light;
}
