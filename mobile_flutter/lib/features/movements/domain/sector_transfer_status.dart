/// Sektor ko'chirish rejasidagi joy holatlari (backend bilan bir xil qiymatlar).
library;

/// Muammosiz ko'chadi.
const String kSectorStatusOk = 'ok';

/// Manbada qoldiq yo'q — o'tkazib yuboriladi.
const String kSectorStatusEmpty = 'empty';

/// Manzilda mos o'rin yo'q yoki nofaol.
const String kSectorStatusDestMissing = 'dest_missing';

/// Joyda terish uchun band zaxira bor.
const String kSectorStatusReserved = 'reserved';

/// Manzilda shu mahsulotning boshqa muddati bor.
const String kSectorStatusExpiryConflict = 'expiry_conflict';

/// Manzil bo'sh emas — ogohlantirish, ko'chirishga to'sqinlik qilmaydi.
const String kSectorStatusDestNotEmpty = 'dest_not_empty';

/// Butun amalni bloklovchi holatlar.
const Set<String> kSectorBlockingStatuses = <String>{
  kSectorStatusDestMissing,
  kSectorStatusReserved,
  kSectorStatusExpiryConflict,
};

/// Holat uchun tarjima kaliti.
String sectorStatusLabelKey(String status) {
  switch (status) {
    case kSectorStatusEmpty:
      return 'sectorStatusEmpty';
    case kSectorStatusDestMissing:
      return 'sectorStatusDestMissing';
    case kSectorStatusReserved:
      return 'sectorStatusReserved';
    case kSectorStatusExpiryConflict:
      return 'sectorStatusExpiryConflict';
    case kSectorStatusDestNotEmpty:
      return 'sectorStatusDestNotEmpty';
    default:
      return 'sectorStatusOk';
  }
}

/// Kiritilgan matndan sektor prefiksini ajratadi: `P-H-03` → `P-H`.
///
/// Ombor xodimi sektorning o'zini skanerlay olmaydi — palet yorlig'ini
/// skanerlaydi, shuning uchun to'liq kod ham qabul qilinadi. Yaroqsiz matn
/// uchun `null`.
String? sectorPrefixFromInput(String raw) {
  final List<String> parts = raw
      .trim()
      .toUpperCase()
      .split('-')
      .where((String p) => p.isNotEmpty)
      .toList(growable: false);
  if (parts.length < 2) {
    return null;
  }
  return '${parts[0]}-${parts[1]}';
}
