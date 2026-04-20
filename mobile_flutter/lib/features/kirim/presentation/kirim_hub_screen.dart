import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/widgets/picker_footer.dart';

/// RN `KirimScreen` — yo‘nalish kartalari.
class KirimHubScreen extends ConsumerWidget {
  const KirimHubScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocale loc = ref.watch(appLocaleProvider);

    return Scaffold(
      appBar: AppBar(title: Text(StringLookup.t(loc, 'kirimTitle'))),
      body: Column(
        children: <Widget>[
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: <Widget>[
                _card(
                  context,
                  icon: Icons.inventory_2_outlined,
                  title: StringLookup.t(loc, 'kirimNewProducts'),
                  subtitle: StringLookup.t(loc, 'kirimCardNewProductsSubtitle'),
                  onTap: () => context.pushNamed('kirimNew'),
                ),
                _card(
                  context,
                  icon: Icons.undo,
                  title: StringLookup.t(loc, 'kirimCustomerReturns'),
                  subtitle: StringLookup.t(loc, 'kirimCardReturnsSubtitle'),
                  onTap: () => context.pushNamed(
                    'kirimForm',
                    queryParameters: <String, String>{'flow': 'return'},
                  ),
                ),
                _card(
                  context,
                  icon: Icons.checklist,
                  title: StringLookup.t(loc, 'kirimInventory'),
                  subtitle: StringLookup.t(loc, 'kirimCardInventorySubtitle'),
                  onTap: () => context.pushNamed(
                    'kirimForm',
                    queryParameters: <String, String>{'flow': 'inventory'},
                  ),
                ),
                _card(
                  context,
                  icon: Icons.swap_horiz,
                  title: StringLookup.t(loc, 'movementTitle'),
                  subtitle: StringLookup.t(loc, 'kirimCardMovementSubtitle'),
                  onTap: () => context.pushNamed('movement'),
                ),
              ],
            ),
          ),
          const PickerFooter(current: PickerFooterRoute.kirim),
        ],
      ),
    );
  }

  Widget _card(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: Icon(icon, color: const Color(0xFF1A237E)),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
