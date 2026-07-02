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

final RegExp _stockInsufficientAvailable = RegExp(
  r"Yetarli qoldiq yo'q \(lot\\joy: mavjud ([\d.,]+), so'ralgan ([\d.,]+)\)",
);

final RegExp _boxInvariantViolated = RegExp(
  r'Quti invariant buzildi: qutilardagi dona \((\d+)\) fizik qoldiqdan \((\d+)\) oshib ketdi',
);

final RegExp _movementBoxedLooseOnly = RegExp(
  r"Qutidagi zaxirani dona qilib ko'chirib bo'lmaydi \(qutisiz mavjud ([\d.,]+)\)",
);

final RegExp _movementReservedAtSource = RegExp(
  r'Joyda rezervdagi \(terish uchun band\) zaxira bor: (\d+) dona',
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

  // --- Ko'chirish (transfer-location) xatolari ---
  if (raw.contains('No available quantity to transfer')) {
    return StringLookup.t(loc, 'movementNoAvailableAtSource');
  }

  if (raw.contains('No transfer lines selected')) {
    return StringLookup.t(loc, 'movementNothingToTransfer');
  }

  if (raw.contains('Source and destination locations must differ')) {
    return StringLookup.t(loc, 'movementSourceDestinationSame');
  }

  if (raw.contains('Source location not found or inactive')) {
    return StringLookup.t(loc, 'movementSourceInactive');
  }

  if (raw.contains('Destination location not found or inactive')) {
    return StringLookup.t(loc, 'movementDestInactive');
  }

  if (raw.contains('Lot not available at source location')) {
    return StringLookup.t(loc, 'movementLotNotAtSource');
  }

  if (raw.contains('Requested qty exceeds available for lot')) {
    return StringLookup.t(loc, 'movementQtyExceedsLot');
  }

  final RegExpMatch? reservedAtSource = _movementReservedAtSource.firstMatch(raw);
  if (reservedAtSource != null) {
    return StringLookup.tParams(
      loc,
      'movementReservedAtSource',
      <String, String>{'reserved': reservedAtSource.group(1)!},
    );
  }

  final RegExpMatch? boxedLoose = _movementBoxedLooseOnly.firstMatch(raw);
  if (boxedLoose != null) {
    return StringLookup.tParams(
      loc,
      'movementBoxedStockLooseOnly',
      <String, String>{'loose': boxedLoose.group(1)!},
    );
  }

  final RegExpMatch? insufficient = _stockInsufficientAvailable.firstMatch(raw);
  if (insufficient != null) {
    return StringLookup.tParams(
      loc,
      'stockInsufficientAvailable',
      <String, String>{
        'available': insufficient.group(1)!,
        'requested': insufficient.group(2)!,
      },
    );
  }

  final RegExpMatch? invariant = _boxInvariantViolated.firstMatch(raw);
  if (invariant != null) {
    return StringLookup.tParams(
      loc,
      'boxInvariantViolated',
      <String, String>{
        'inBoxes': invariant.group(1)!,
        'onHand': invariant.group(2)!,
      },
    );
  }

  if (raw.contains('Negative balance detected')) {
    return StringLookup.t(loc, 'negativeBalanceDetected');
  }

  if (raw.contains('Idempotency-Key already used with different payload')) {
    return StringLookup.t(loc, 'idempotencyConflict');
  }

  if (raw.contains('Duplicate request in progress')) {
    return StringLookup.t(loc, 'duplicateRequestInProgress');
  }

  // Tanilmagan xato: sababni yashirmasdan foydalanuvchiga ko'rsatamiz —
  // aks holda haqiqiy muammo generik xabar ortida ko'rinmay qoladi.
  if (raw.isNotEmpty) {
    return StringLookup.tParams(
      loc,
      'operationFailedWithReason',
      <String, String>{'reason': raw},
    );
  }
  return StringLookup.t(loc, 'operationFailed');
}
