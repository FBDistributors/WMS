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

final RegExp _receivingQtyBelowBoxUnits = RegExp(
  r'qty (\d+) < box_count \* units_per_box \((\d+)\)',
  caseSensitive: false,
);

final RegExp _receivingInsufficientStockUz = RegExp(
  r'Qabul qilingan qoldiq yetarli emas \(kerak (\d+), mavjud (\d+)\)',
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

  // --- Qabul (receiving) xatolari ---
  if (raw.contains('Bitta lokatsiyaga ikki xil muddati')) {
    return StringLookup.t(loc, 'receivingLocationSingleExpiry');
  }

  if (raw == 'Quti topilmadi') {
    return StringLookup.t(loc, 'inventoryBoxNotFound');
  }

  if (raw == 'Quti mahsulotga mos emas') {
    return StringLookup.t(loc, 'inventoryBoxProductMismatch');
  }

  if (raw.contains('box_barcode va box_count birgalikda')) {
    return StringLookup.t(loc, 'receivingBoxBarcodeCountRequired');
  }

  final RegExpMatch? qtyBelowBox = _receivingQtyBelowBoxUnits.firstMatch(raw);
  if (qtyBelowBox != null) {
    return StringLookup.tParams(
      loc,
      'receivingQtyBelowBoxUnits',
      <String, String>{
        'qty': qtyBelowBox.group(1)!,
        'expected': qtyBelowBox.group(2)!,
      },
    );
  }

  final RegExpMatch? recvStock = _receivingInsufficientStockUz.firstMatch(raw);
  if (recvStock != null) {
    return StringLookup.tParams(
      loc,
      'receivingInsufficientStock',
      <String, String>{
        'needed': recvStock.group(1)!,
        'available': recvStock.group(2)!,
      },
    );
  }

  if (raw.contains('Quti joylashuvi sozlanmagan')) {
    return StringLookup.t(loc, 'receivingBoxPlacementNotConfigured');
  }

  if (raw.contains('is in the past')) {
    return StringLookup.t(loc, 'receivingExpiryInPast');
  }

  if (raw == 'Product not found') {
    return StringLookup.t(loc, 'receivingProductNotFound');
  }

  if (raw == 'Location not found') {
    return StringLookup.t(loc, 'receivingLocationNotFound');
  }

  if (raw == 'Partiya mahsulotga mos emas') {
    return StringLookup.t(loc, 'receivingLotProductMismatch');
  }

  return StringLookup.t(loc, 'operationFailed');
}
