import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../auth/presentation/auth_providers.dart';
import '../../customer_returns/customer_returns_providers.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/widgets/picker_footer.dart';

/// RN `KirimScreen` — yo‘nalish kartalari.
class KirimHubScreen extends ConsumerWidget {
  const KirimHubScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final AuthSession session =
        ref.watch(authControllerProvider).valueOrNull ?? const AuthSession.unauthenticated();
    final List<String> perms = session.me?.permissions ?? const <String>[];
    final bool canReceive = perms.contains('receiving:write');
    final bool canControllerReturns = perms.contains('documents:edit_status');
    final bool canPickerReturns = perms.contains('picking:write');
    final bool canInventoryAdjust = perms.contains('inventory:adjust');
    final int returnsBadge = ref.watch(customerReturnsAssignedCountProvider);

    return Scaffold(
      appBar: AppBar(title: Text(StringLookup.t(loc, 'kirimTitle'))),
      body: Column(
        children: <Widget>[
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: <Widget>[
                if (canReceive)
                  _card(
                    context,
                    icon: Icons.inventory_2_outlined,
                    title: StringLookup.t(loc, 'kirimNewProducts'),
                    subtitle: StringLookup.t(loc, 'kirimCardNewProductsSubtitle'),
                    onTap: () => context.pushNamed('kirimNew'),
                  ),
                if (canControllerReturns || canPickerReturns)
                  _card(
                    context,
                    icon: Icons.undo,
                    title: StringLookup.t(loc, 'kirimCustomerReturns'),
                    subtitle: StringLookup.t(loc, 'kirimCardReturnsSubtitle'),
                    badge: returnsBadge,
                    onTap: () {
                      if (canControllerReturns) {
                        context.pushNamed(
                          'kirimForm',
                          queryParameters: <String, String>{'flow': 'return'},
                        );
                        return;
                      }
                      context.pushNamed('customerReturnsQueue');
                    },
                  ),
                if (canInventoryAdjust)
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
                if (canInventoryAdjust)
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
    int badge = 0,
  }) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: Icon(icon, color: const Color(0xFF1A237E)),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            if (badge > 0)
              Container(
                margin: const EdgeInsets.only(right: 8),
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.red.shade600,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  badge > 99 ? '99+' : '$badge',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            const Icon(Icons.chevron_right),
          ],
        ),
        onTap: onTap,
      ),
    );
  }
}
