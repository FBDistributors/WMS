/// Backend `timestamptz` va HTTP JSON uchun: vaqt zonasi ko‘rsatilmagan ISO qatorlar
/// Dart `DateTime.tryParse` da mahalliy deb talqin qilinadi; UTC bo‘lsa jismoniy vaqt
/// noto‘g‘ri chiqadi. Offset yoki `Z` bo‘lsa oddiy parse; bo‘lmasa UTC deb qayta o‘qiladi.
String formatCustomerReturnApiDateTime(String raw) {
  final DateTime? dt = parseCustomerReturnApiDateTime(raw);
  if (dt == null) {
    return raw;
  }
  final DateTime local = dt.toLocal();
  final String mm = local.month.toString().padLeft(2, '0');
  final String dd = local.day.toString().padLeft(2, '0');
  final String hh = local.hour.toString().padLeft(2, '0');
  final String min = local.minute.toString().padLeft(2, '0');
  return '${local.year}-$mm-$dd $hh:$min';
}

DateTime? parseCustomerReturnApiDateTime(String raw) {
  final String t = raw.trim();
  if (t.isEmpty) {
    return null;
  }
  final bool explicitTz = t.endsWith('Z') ||
      RegExp(r'[+-]\d{2}:\d{2}$').hasMatch(t) ||
      RegExp(r'[+-]\d{4}$').hasMatch(t);
  if (explicitTz) {
    return DateTime.tryParse(t);
  }
  if (t.contains('T')) {
    return DateTime.tryParse('${t}Z') ?? DateTime.tryParse(t);
  }
  return DateTime.tryParse(t);
}
