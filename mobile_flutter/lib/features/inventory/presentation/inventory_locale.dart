import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';

/// UI locale for inventory strings — mirrors RN `translations.ts` keys used on InventoryScreen.
enum InventoryLocale { uz, ru, en }

final inventoryLocaleProvider = Provider<InventoryLocale>((Ref ref) {
  return switch (ref.watch(appLocaleProvider)) {
    AppLocale.uz => InventoryLocale.uz,
    AppLocale.ru => InventoryLocale.ru,
    AppLocale.en => InventoryLocale.en,
  };
});

class InventoryStrings {
  const InventoryStrings._();

  static String invTitle(InventoryLocale l) => switch (l) {
        InventoryLocale.uz => 'Mahsulotlar',
        InventoryLocale.ru => 'Товары',
        InventoryLocale.en => 'Products',
      };

  static String invSearchPlaceholder(InventoryLocale l) => switch (l) {
        InventoryLocale.uz => 'SKU, nom yoki barkod',
        InventoryLocale.ru => 'SKU, название или штрихкод',
        InventoryLocale.en => 'SKU, name or barcode',
      };

  static String invBestLocation(InventoryLocale l) => switch (l) {
        InventoryLocale.uz => 'Joy',
        InventoryLocale.ru => 'Место',
        InventoryLocale.en => 'Location',
      };

  static String invQoldiq(InventoryLocale l) => switch (l) {
        InventoryLocale.uz => 'Qoldiq',
        InventoryLocale.ru => 'Остаток',
        InventoryLocale.en => 'Stock',
      };

  static String invOnHand(InventoryLocale l) => switch (l) {
        InventoryLocale.uz => 'Jami joyda',
        InventoryLocale.ru => 'В наличии',
        InventoryLocale.en => 'On hand',
      };

  static String invLoadError(InventoryLocale l) => switch (l) {
        InventoryLocale.uz => 'Mahsulotlar yuklanmadi',
        InventoryLocale.ru => 'Не удалось загрузить товары',
        InventoryLocale.en => 'Failed to load products',
      };

  static String invNoResults(InventoryLocale l) => switch (l) {
        InventoryLocale.uz => "Natija yo'q",
        InventoryLocale.ru => 'Нет результатов',
        InventoryLocale.en => 'No results',
      };

  static String invRetry(InventoryLocale l) => switch (l) {
        InventoryLocale.uz => 'Qayta urinish',
        InventoryLocale.ru => 'Повторить',
        InventoryLocale.en => 'Retry',
      };

  static String invAllLocations(InventoryLocale l) => switch (l) {
        InventoryLocale.uz => 'Barcha joylar',
        InventoryLocale.ru => 'Все места',
        InventoryLocale.en => 'All locations',
      };

  static String invSearch(InventoryLocale l) => switch (l) {
        InventoryLocale.uz => 'Qidirish',
        InventoryLocale.ru => 'Поиск',
        InventoryLocale.en => 'Search',
      };
}
