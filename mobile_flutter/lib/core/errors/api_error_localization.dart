import '../../features/product_boxes/data/box_location_models.dart';
import '../app_state/app_locale.dart';
import '../../l10n/string_lookup.dart';

final RegExp _pickInsufficientLooseUz = RegExp(
  r'Qutisiz qoldiq yetarli emas \(kerak (\d+), mavjud (\d+)\)',
);
final RegExp _pickInsufficientLooseEn = RegExp(
  r'Not enough loose units \(need (\d+), have (\d+)\)',
  caseSensitive: false,
);

String _stripExceptionPrefix(String message) {
  const String prefix = 'Exception: ';
  if (message.startsWith(prefix)) {
    return message.substring(prefix.length).trim();
  }
  return message.trim();
}

/// Backend API xabarlarini foydalanuvchi tiliga moslashtirish.
String localizeApiErrorMessage(AppLocale loc, Object error) {
  final String raw = _stripExceptionPrefix(error.toString());

  if (isBreakdownInconsistentMessage(raw)) {
    return StringLookup.t(loc, 'pickDataInconsistent');
  }

  final RegExpMatch? uzLoose = _pickInsufficientLooseUz.firstMatch(raw);
  if (uzLoose != null) {
    return StringLookup.tParams(
      loc,
      'pickInsufficientLoose',
      <String, String>{
        'needed': uzLoose.group(1)!,
        'available': uzLoose.group(2)!,
      },
    );
  }

  final RegExpMatch? enLoose = _pickInsufficientLooseEn.firstMatch(raw);
  if (enLoose != null) {
    return StringLookup.tParams(
      loc,
      'pickInsufficientLoose',
      <String, String>{
        'needed': enLoose.group(1)!,
        'available': enLoose.group(2)!,
      },
    );
  }

  if (raw.contains('Quti skan qiling') || raw.toLowerCase().contains('scan a box')) {
    return StringLookup.t(loc, 'pickUseBoxScan');
  }

  if (raw.contains('box_count required for box scan')) {
    return StringLookup.t(loc, 'pickBoxCountRequired');
  }

  if (raw.contains('barcode required for hybrid pick') ||
      raw.contains('Gibrid terish uchun mahsulot')) {
    return StringLookup.t(loc, 'pickBarcodeRequiredHybrid');
  }

  return StringLookup.t(loc, 'operationFailed');
}
