# WMS — Flutter mobil ilova (`mobile_flutter`)

Bu faylda monorepo ichidagi Flutter loyiha, tuzilma va muhim texnik qarorlar qisqacha yozilgan.

## Loyiha joylashuvi

- **Papka:** `mobile_flutter/`
- **Eslatma:** Eski React Native ilova `mobile/` papkasida. Flutter kodlari va o‘zgarishlar faqat `mobile_flutter/` da; RN manbasi o‘zgartirilmaydi (faqat kerak bo‘lsa migratsiya uchun o‘qiladi).

## 1. Loyihani yaratish (`flutter create`)

Birinchi marta loyiha qo‘lda `pubspec.yaml` + `lib/` bilan boshlangan bo‘lishi mumkin. To‘liq platforma papkalari (android, ios, …) uchun:

```powershell
cd c:\Users\hp\Desktop\WMS\mobile_flutter
flutter create .
flutter pub get
```

## 2. Bog‘liqliklar (`pubspec.yaml`)

| Paket | Vazifasi |
|--------|--------|
| `flutter_riverpod` | State management (providerlar, `StateNotifier`) |
| `dio` | Backend / ERP HTTP API |
| `go_router` | Marshrutlash |
| `shared_preferences` | Token va boshqa mahalliy ma’lumot (RN `AsyncStorage` kalitlari bilan mos: `@wms_access_token`) |

Qo‘shimcha: `cupertino_icons`, dev uchun `flutter_test`, `flutter_lints`.

## 3. API va muhit

- **Asosiy URL:** React Native `env.ts` dagi default bilan mos — `https://wms-ngdm.onrender.com`; kerak bo‘lsa `/api/v1` avtomatik qo‘shiladi (`ApiConfig.apiV1Base`).
- **Boshqa server:** ishga tushirishda `--dart-define=API_BASE_URL=https://sizning-host` ishlatiladi.

## 4. `lib/` tuzilmasi (Clean-style)

### `core/`

| Yo‘l | Tavsif |
|------|--------|
| `config/api_config.dart` | API bazaviy URL va `/api/v1` qoidalari |
| `config/brand.dart` | Brend nomi va logo o‘lchamlari (web/RN bilan mos) |
| `router.dart` | `GoRouter`: `/` login, `/inventory` inventar ro‘yxati, `/inventory/detail/:productId` — hozircha placeholder detal |
| `network/app_dio.dart` | Asosiy `Dio`: bearer token, 401 da tokenni tozalash, xato xabarlari (RN axios client ga yaqin) |
| `network_client.dart` | Eski soddalashtirilgan `AppNetworkClient` (ixtiyoriy; asosiy trafik `app_dio` orqali) |
| `storage/shared_preferences_provider.dart` | `main` da `override` qilinadigan `SharedPreferences` |
| `storage/auth_token_storage.dart` | Token o‘qish/yozish |

### `features/auth/`

| Yo‘l | Tavsif |
|------|--------|
| `login_screen.dart` | Login placeholder (keyinchalik RN `LoginScreen` migratsiyasi) |

### `features/inventory/`

React Native **`InventoryScreen.tsx`** + `api/inventory.ts` mantiqasi Flutter ga ko‘chirilgan.

| Yo‘l | Tavsif |
|------|--------|
| `inventory_screen.dart` | Export: `presentation/inventory_screen.dart` |
| `data/models/picker_inventory_models.dart` | `PickerInventoryItem`, joylar, javoblar — `factory fromJson`, `dynamic` ishlatilmaydi |
| `data/inventory_repository.dart` | `GET /inventory/picker`, `GET /inventory/picker/locations` |
| `data/picker_location_format.dart` | `formatPickerLocationOptionLine` (EXPIRED zona satrlari) |
| `presentation/inventory_screen.dart` | Qidiruv, joy filtri (modal), kartalar, pagination, xato/bo‘sh holatlar, header yangilash |
| `presentation/inventory_list_controller.dart` | `InventoryViewState` + yuklash / `loadMore` / filtrlar |
| `presentation/inventory_filter_providers.dart` | `inventoryQueryProvider`, `inventoryLocationIdProvider` |
| `presentation/inventory_providers.dart` | Repository, joylar `FutureProvider`, `inventoryListControllerProvider` |
| `presentation/inventory_locale.dart` | Inventar matnlari uz / ru / en |
| `presentation/inventory_detail_screen.dart` | Vaqtincha placeholder (to‘liq detal keyin) |

### `shared/`

| Yo‘l | Tavsif |
|------|--------|
| `widgets/app_header.dart` | Sarlavha, refresh (RN `AppHeader` ga mos); logo o‘rniga hozircha ikonka |

## 5. Ilova ishga tushirish (`lib/main.dart`)

- `WidgetsFlutterBinding.ensureInitialized()` keyin `SharedPreferences.getInstance()`.
- `ProviderScope` + `sharedPreferencesProvider.overrideWithValue(prefs)`.
- `MaterialApp.router`, `theme` / `darkTheme`, `themeMode: ThemeMode.system` (inventar ekrani tizim rejimiga mos ranglar ishlatadi).

## 6. Test

- `test/widget_test.dart` — `SharedPreferences` mock bilan `MobileFlutterApp` yuklanishini tekshiradi.

## 7. Tekshiruv buyruqlari

```powershell
cd c:\Users\hp\Desktop\WMS\mobile_flutter
flutter pub get
dart analyze
flutter test
flutter run -d chrome
```

## Keyingi qadamlar (tavsiya)

1. RN **`LoginScreen.tsx`** + `auth` API ni Flutter `features/auth` ga to‘liq ko‘chirish (sessiya, til tanlash, `getMe`).
2. **`InventoryDetailScreen`** ni RN `InventoryDetailScreen` bilan bir xil qilish.
3. Header uchun haqiqiy `logo.png` ni `assets` ga qo‘shib `AppHeader` da `Image.asset` ishlatish.
4. `inventoryLocaleProvider` ni login/tillar bilan bir xil global i18n tizimiga ulash.

---

*Oxirgi yangilanish: inventar moduli RN dan migratsiya qilindi; Dio + Riverpod + `go_router` ishlaydi; `flutter.md` shu holatga moslashtirildi.*
