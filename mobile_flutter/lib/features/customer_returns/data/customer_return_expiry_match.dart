/// Qaytarish qatori va zaxira loti muddatini solishtirish (oy/yil; backend oyning 1-kuni).
bool expiryMatchesReturnLine(String? lineExpiry, String? locExpiry) {
  final DateTime? dl = _firstDayOfMonth(_parseYmd(lineExpiry));
  final DateTime? dr = _firstDayOfMonth(_parseYmd(locExpiry));
  if (dl == null && dr == null) {
    return true;
  }
  if (dl == null || dr == null) {
    return false;
  }
  return dl.year == dr.year && dl.month == dr.month;
}

DateTime? _parseYmd(String? s) {
  if (s == null) {
    return null;
  }
  final String t = s.trim();
  if (t.isEmpty) {
    return null;
  }
  return DateTime.tryParse(t.length >= 10 ? t.substring(0, 10) : t);
}

DateTime? _firstDayOfMonth(DateTime? d) {
  if (d == null) {
    return null;
  }
  return DateTime(d.year, d.month, 1);
}
