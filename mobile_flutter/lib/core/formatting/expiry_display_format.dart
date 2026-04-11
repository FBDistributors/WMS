import 'package:intl/intl.dart';

/// Yaroqlilikni foydalanuvchiga `MMM yyyy` (locale bo‘yicha) ko‘rinishida chiqarish. API qiymati ISO bo‘lishi mumkin.
String formatExpiryMonthYear(String? rawIso, String languageCode) {
  if (rawIso == null || rawIso.trim().isEmpty) {
    return '—';
  }
  final String s = rawIso.trim();
  final String datePart = s.length >= 10 ? s.substring(0, 10) : s;
  final DateTime? parsed = DateTime.tryParse(datePart);
  if (parsed == null) {
    return s;
  }
  try {
    return DateFormat('MMM yyyy', languageCode).format(parsed);
  } on ArgumentError catch (_) {
    return DateFormat('MMM yyyy', 'en').format(parsed);
  }
}
