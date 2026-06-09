import '../../features/picking/domain/profile_type_param.dart';

/// RN `Scanner` ekrani parametrlarining Dart ekvivalenti (GoRouter `extra`).
class ScannerArgs {
  const ScannerArgs({
    this.returnToPick = false,
    this.returnToConsolidated = false,
    this.returnToReturns = false,
    this.returnToKirimForm = false,
    this.returnToMovement = false,
    this.returnToMovementPallet = false,
    this.returnToKirimLocation = false,
    this.returnToInventoryDetail = false,
    this.returnToCustomerReturnLocation = false,
    this.returnToCustomerReturnProductVerify = false,
    this.flow,
    this.newMode,
    this.warehouse,
    this.taskId,
    this.customerReturnId,
    this.lineId,
    this.expectedProductId,
    this.profileType,
    this.selectedProductKey,
    this.inventoryStep,
    this.inventoryLocationId,
    this.inventoryLocationCode,
    this.receivingLocationId,
    this.receivingLocationCode,
    this.returnRawBarcode = false,
  });

  final bool returnToPick;
  final bool returnToConsolidated;
  final bool returnToReturns;
  final bool returnToKirimForm;
  final bool returnToMovement;
  final bool returnToMovementPallet;
  final bool returnToKirimLocation;
  final bool returnToInventoryDetail;
  final bool returnToCustomerReturnLocation;
  final bool returnToCustomerReturnProductVerify;
  final String? flow;
  final String? newMode;
  final String? warehouse;
  final String? taskId;
  final String? customerReturnId;
  final String? lineId;
  final String? expectedProductId;
  final PickerProfileParam? profileType;
  final String? selectedProductKey;
  final int? inventoryStep;
  final String? inventoryLocationId;
  final String? inventoryLocationCode;
  final String? receivingLocationId;
  final String? receivingLocationCode;
  /// Mahsulot resolve qilmasdan faqat shtrix-kodni qaytarish (quti skan).
  final bool returnRawBarcode;
}
