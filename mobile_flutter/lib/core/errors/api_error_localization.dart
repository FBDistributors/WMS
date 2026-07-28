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

final RegExp _belowBoxedUnits = RegExp(
  r'Qoldiqni quti ichidagi donadan past tushirib bo.lmaydi \(qutida (\d+) dona\)',
);

final RegExp _notEnoughSealedBoxes = RegExp(
  r'Sealed quti yetarli emas \(kerak (\d+), mavjud (\d+)\)',
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

  // --- Terish / skan oqimi xatolari (picker + controller) ---
  // Miqdor oshib ketdi — inglizcha va o'zbekcha backend variantlari.
  if (raw.contains('qty_picked cannot exceed qty_required') ||
      raw.contains('kerak miqdordan oshib ketdi')) {
    return StringLookup.t(loc, 'pickQtyExceedsRequired');
  }
  if (raw.contains('qty_picked cannot be below 0')) {
    return StringLookup.t(loc, 'pickQtyBelowZero');
  }
  if (raw.contains('delta cannot exceed qty_picked')) {
    return StringLookup.t(loc, 'pickDeltaExceedsPicked');
  }
  if (raw.contains('Line already fully picked')) {
    return StringLookup.t(loc, 'pickLineAlreadyFull');
  }
  if (raw.contains('Line is skipped')) {
    return StringLookup.t(loc, 'pickLineSkipped');
  }
  if (raw.contains('Line has no picked qty')) {
    return StringLookup.t(loc, 'pickLineNoPickedQty');
  }
  if (raw.contains('Line missing product') ||
      raw.contains('missing allocation details')) {
    return StringLookup.t(loc, 'pickLineMissingAllocation');
  }
  if (raw == 'Mahsulot mos emas') {
    return StringLookup.t(loc, 'pickProductMismatch');
  }
  if (raw.contains('Invalid lot for this product')) {
    return StringLookup.t(loc, 'pickInvalidLot');
  }
  if (raw.contains("Quti topilmadi yoki noto'g'ri")) {
    return StringLookup.t(loc, 'pickBoxNotFoundOrWrong');
  }
  if (raw.contains("buyurtma qatorlarida yetarli joy yo'q")) {
    return StringLookup.t(loc, 'pickBoxNoRoom');
  }
  if (raw.contains('yetarli qoldiq yo‘q') ||
      raw.contains("yetarli qoldiq yo'q")) {
    return StringLookup.t(loc, 'pickNotEnoughAtLocation');
  }
  if (raw.contains('Pick only from NORMAL zone')) {
    return StringLookup.t(loc, 'pickOnlyNormalZone');
  }
  if (raw.contains('qty must be positive')) {
    return StringLookup.t(loc, 'pickQtyMustBePositive');
  }
  if (raw.contains('Document must be in picked status')) {
    return StringLookup.t(loc, 'pickDocMustBePicked');
  }
  if (raw.contains('Already sent to controller')) {
    return StringLookup.t(loc, 'pickAlreadySentToController');
  }
  if (raw.contains('Document not assigned to you')) {
    return StringLookup.t(loc, 'pickDocNotYours');
  }
  if (raw.contains('VIP muddat')) {
    return StringLookup.t(loc, 'pickVipInfoOnly');
  }
  if (raw.contains('sizning vazifangizda')) {
    return StringLookup.t(loc, 'pickProductNotInTasks');
  }

  if (raw.contains('box_count required for box scan')) {
    return StringLookup.t(loc, 'pickBoxCountRequired');
  }

  if (raw.contains('barcode required for hybrid pick') ||
      raw.contains('Gibrid terish uchun mahsulot')) {
    return StringLookup.t(loc, 'pickBarcodeRequiredHybrid');
  }

  // Oddiy "barcode required" — gibrid variantidan keyin tekshiriladi (soya solmasin).
  if (raw == 'barcode required') {
    return StringLookup.t(loc, 'pickBarcodeRequired');
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

  // --- Quti / inventarizatsiya xatolari ---
  final RegExpMatch? belowBoxed = _belowBoxedUnits.firstMatch(raw);
  if (belowBoxed != null) {
    return StringLookup.tParams(
      loc,
      'errBelowBoxedUnits',
      <String, String>{'units': belowBoxed.group(1)!},
    );
  }

  final RegExpMatch? sealedShort = _notEnoughSealedBoxes.firstMatch(raw);
  if (sealedShort != null) {
    return StringLookup.tParams(
      loc,
      'errNotEnoughSealedBoxes',
      <String, String>{
        'needed': sealedShort.group(1)!,
        'available': sealedShort.group(2)!,
      },
    );
  }

  if (raw.contains('Quti bu lokatsiyada joylashmagan')) {
    return StringLookup.t(loc, 'errBoxNotAtLocation');
  }
  if (raw == 'Quti joylashmagan') {
    return StringLookup.t(loc, 'errBoxNotPlaced');
  }
  if (raw.contains("Quti ichidagi dona soni noto'g'ri")) {
    return StringLookup.t(loc, 'errBoxUnitsInvalid');
  }
  if (raw.contains('shtrix-kodi sifatida band')) {
    return StringLookup.t(loc, 'errBarcodeTakenByProduct');
  }
  if (raw.contains("manfiy bo'lmasligi kerak")) {
    return StringLookup.t(loc, 'errNegativeCount');
  }
  if (raw.contains('ajratishlarda yetarli joy')) {
    return StringLookup.t(loc, 'errBoxPickNoRoomAllocations');
  }
  if (raw.contains('dona soni farq qiladi')) {
    return StringLookup.t(loc, 'errBoxMergeSizeMismatch');
  }
  if (raw.contains('har xil mahsulotga tegishli')) {
    return StringLookup.t(loc, 'errBoxMergeOtherProduct');
  }
  if (raw.contains("shu shtrix-kodli yopiq quti yo'q")) {
    return StringLookup.t(loc, 'errBoxMergeNothingHere');
  }

  // --- Terish sessiyasi / bekor qilish xatolari ---
  if (raw.contains('Barcha qatorlar uchun mahsulot skanerlanishi kerak')) {
    return StringLookup.t(loc, 'errScanAllLines');
  }
  if (raw.contains('Bu sessiya sizga tegishli emas')) {
    return StringLookup.t(loc, 'errSessionNotYours');
  }
  if (raw.contains('Terilgan miqdor sessiya bilan mos kelmaydi')) {
    return StringLookup.t(loc, 'errPickedQtyMismatch');
  }
  if (raw.contains('Kutilgan qator uchun skanerlang')) {
    return StringLookup.t(loc, 'errWrongProductScanned');
  }
  if (raw.contains('xavfsiz bekor rejimida')) {
    return StringLookup.t(loc, 'errSafeCancelInProgress');
  }
  if (raw.contains('Buyurtma bekor qilinmoqda')) {
    return StringLookup.t(loc, 'errOrderCancelling');
  }
  if (raw.contains('Xavfsiz bekor faqat')) {
    return StringLookup.t(loc, 'errSafeCancelOnly');
  }
  if (raw.contains('Hujjat holati bekor qilishga mos emas')) {
    return StringLookup.t(loc, 'errDocStateNotCancellable');
  }
  if (raw.contains('oddiy bekor ishlating')) {
    return StringLookup.t(loc, 'errNothingPicked');
  }
  if (raw.contains('xavfsiz bekor mumkin emas')) {
    return StringLookup.t(loc, 'errLineIncompleteForCancel');
  }
  if (raw.contains('Ortiqcha pick topilmadi')) {
    return StringLookup.t(loc, 'errOverPickNotFound');
  }
  if (raw.contains('Faqat controller uchun')) {
    return StringLookup.t(loc, 'errControllerOnly');
  }

  // --- Qaytim (customer returns) xatolari ---
  if (raw.contains('Qaytarish topilmadi')) {
    return StringLookup.t(loc, 'errReturnNotFound');
  }
  if (raw.contains("Qaytimda mahsulot yo'q")) {
    return StringLookup.t(loc, 'errReturnNoProducts');
  }
  if (raw.contains('qaytim mumkin emas')) {
    return StringLookup.t(loc, 'errOrderShipped');
  }
  if (raw.contains('WMS bazasida topilmadi')) {
    return StringLookup.t(loc, 'errProductsNotInWms');
  }

  // --- Sektor ko'chirish xatolari ---
  if (raw.contains('Sektor topilmadi')) {
    return StringLookup.t(loc, 'sectorNotFound');
  }
  if (raw.contains('bir nechta joy turiga')) {
    return StringLookup.t(loc, 'sectorAmbiguous');
  }
  if (raw.contains('turlari mos emas')) {
    return StringLookup.t(loc, 'sectorTypesMismatch');
  }
  if (raw.contains("Sektorda juda ko'p joy")) {
    return StringLookup.t(loc, 'sectorTooManyLocations');
  }
  if (raw.contains("Sektorni ko'chirib bo'lmadi")) {
    return StringLookup.t(loc, 'sectorTransferBlocked');
  }
  if (raw.contains('Source and destination sectors must differ')) {
    return StringLookup.t(loc, 'sectorSameSource');
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
