import 'models/picker_inventory_models.dart';

/// Same behaviour as RN `formatPickerLocationOptionLine`.
String formatPickerLocationOptionLine(PickerLocationOption loc) {
  if (loc.zoneType != 'EXPIRED' || loc.expiredSlot == null || loc.expiredSlot!.isEmpty) {
    return loc.code;
  }
  if (loc.expiredDisplayLabel != null) {
    return '${loc.code} · ${loc.expiredSlot} (${loc.expiredDisplayLabel})';
  }
  return '${loc.code} · ${loc.expiredSlot}';
}
