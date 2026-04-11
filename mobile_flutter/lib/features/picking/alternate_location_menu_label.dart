import '../../core/formatting/expiry_display_format.dart';
import 'data/picking_models.dart';

String? _alternateDisambiguationSuffix(PickingAlternateLocation a, String languageCode) {
  final String? b = a.batch?.trim();
  if (b != null && b.isNotEmpty) {
    return b.length > 24 ? '${b.substring(0, 21)}…' : b;
  }
  final String? e = a.expiryDate?.trim();
  if (e != null && e.isNotEmpty) {
    return formatExpiryMonthYear(e, languageCode);
  }
  final String lid = a.lotId.trim();
  if (lid.length > 8) {
    return lid.substring(lid.length - 8);
  }
  if (lid.isNotEmpty) {
    return lid;
  }
  return null;
}

/// Bir xil [PickingAlternateLocation.locationCode] bir necha lot uchun takrorlansa, partiya/muddat/lot qisqacha qo‘shiladi.
String alternateLocationMenuLabel(
  PickingAlternateLocation a,
  List<PickingAlternateLocation> siblings,
  String languageCode,
) {
  final String code = a.locationCode.trim();
  final int dupCount = code.isEmpty
      ? 0
      : siblings.where((PickingAlternateLocation x) => x.locationCode.trim() == code).length;
  final String base = '${a.locationCode} — ${a.availableQty}';
  if (dupCount <= 1) {
    return base;
  }
  final String? suffix = _alternateDisambiguationSuffix(a, languageCode);
  if (suffix != null && suffix.isNotEmpty) {
    return '$base · $suffix';
  }
  final String lid = a.lotId.trim();
  if (lid.length > 8) {
    return '$base · ${lid.substring(lid.length - 8)}';
  }
  if (lid.isNotEmpty) {
    return '$base · $lid';
  }
  return base;
}
