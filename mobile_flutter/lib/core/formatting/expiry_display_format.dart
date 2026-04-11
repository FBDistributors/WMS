import 'package:intl/intl.dart';

/// Yaroqlilik: doim ingliz `MMM yyyy` (tarjima yo‘q), bosh harf katta, masalan `Sep 2028`. API qiymati ISO bo‘lishi mumkin.
String formatExpiryMonthYear(String? rawIso) {
  if (rawIso == null || rawIso.trim().isEmpty) {
    return '—';
  }
  final String s = rawIso.trim();
  final String datePart = s.length >= 10 ? s.substring(0, 10) : s;
  final DateTime? parsed = DateTime.tryParse(datePart);
  if (parsed == null) {
    return s;
  }
  final String formatted = DateFormat('MMM yyyy', 'en').format(parsed);
  if (formatted.isEmpty) {
    return formatted;
  }
  return formatted[0].toUpperCase() + formatted.substring(1);
}
