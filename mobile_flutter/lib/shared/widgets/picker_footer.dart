import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_state/profile_type.dart';
import '../../core/app_state/profile_type_controller.dart';
import '../../core/app_state/task_count_provider.dart';
import '../../core/app_state/theme_controller.dart';
import '../../core/router/scanner_args.dart';
import '../../features/picking/domain/profile_type_param.dart';
import '../../l10n/string_lookup.dart';
import '../../core/app_state/locale_controller.dart';
import '../../core/app_state/app_locale.dart';

enum PickerFooterRoute {
  pickerHome,
  pickTaskList,
  inventory,
  kirim,
  hisob,
}

class PickerFooter extends ConsumerWidget {
  const PickerFooter({
    super.key,
    required this.current,
  });

  final PickerFooterRoute current;

  static const Color _active = Color(0xFF1A237E);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final bool isDark = ref.watch(appThemeModeProvider) == ThemeMode.dark;
    final int taskCount = ref.watch(taskCountProvider);
    final ProfileType pt = ref.watch(profileTypeProvider);
    final PickerProfileParam profileParam =
        pt == ProfileType.controller ? PickerProfileParam.controller : PickerProfileParam.picker;

    final Color activeC = isDark ? const Color(0xFF93C5FD) : _active;
    final Color inactiveC = isDark ? const Color(0xFF94A3B8) : const Color(0xFF666666);
    final Color barBg = isDark ? const Color(0xFF1E293B) : Colors.white;
    final Color borderC = isDark ? const Color(0xFF334155) : const Color(0xFFE0E0E0);

    void goHome() => context.goNamed(
          'pickerHome',
          queryParameters: <String, String>{'profile': profileToQuery(profileParam)},
        );
    void goTasks() => context.goNamed(
          'pickTasks',
          queryParameters: <String, String>{'profile': profileToQuery(profileParam)},
        );
    void goInv() => context.goNamed('inventory');
    void goKirim() => context.goNamed('kirim');
    void goScan() => context.pushNamed(
          'scanner',
          extra: ScannerArgs(
            profileType: profileParam,
            returnToInventoryDetail: true,
          ),
        );

    return Material(
      color: barBg,
      child: Container(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: borderC)),
        ),
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: <Widget>[
            _tab(
              context,
              icon: Icons.home_outlined,
              label: StringLookup.t(loc, 'tabMain'),
              active: current == PickerFooterRoute.pickerHome,
              activeC: activeC,
              inactiveC: inactiveC,
              onTap: goHome,
            ),
            _tab(
              context,
              icon: Icons.list_alt,
              label: StringLookup.t(loc, 'tabPickLists'),
              active: current == PickerFooterRoute.pickTaskList,
              activeC: activeC,
              inactiveC: inactiveC,
              badge: taskCount,
              onTap: goTasks,
            ),
            _scanButton(context, goScan),
            _tab(
              context,
              icon: Icons.inventory_2_outlined,
              label: StringLookup.t(loc, 'tabInventory'),
              active: current == PickerFooterRoute.inventory,
              activeC: activeC,
              inactiveC: inactiveC,
              onTap: goInv,
            ),
            _tab(
              context,
              icon: Icons.move_to_inbox,
              label: StringLookup.t(loc, 'kirim'),
              active: current == PickerFooterRoute.kirim,
              activeC: activeC,
              inactiveC: inactiveC,
              onTap: goKirim,
            ),
          ],
        ),
      ),
    );
  }

  Widget _tab(
    BuildContext context, {
    required IconData icon,
    required String label,
    required bool active,
    required Color activeC,
    required Color inactiveC,
    required VoidCallback onTap,
    int badge = 0,
  }) {
    final Color c = active ? activeC : inactiveC;
    return InkWell(
      onTap: onTap,
      child: SizedBox(
        width: 64,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Stack(
              clipBehavior: Clip.none,
              children: <Widget>[
                Icon(icon, color: c, size: 24),
                if (badge > 0)
                  Positioned(
                    right: -8,
                    top: -6,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      decoration: const BoxDecoration(
                        color: Color(0xFFE53935),
                        borderRadius: BorderRadius.all(Radius.circular(8)),
                      ),
                      constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                      child: Text(
                        badge > 99 ? '99+' : '$badge',
                        style: const TextStyle(color: Colors.white, fontSize: 10),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ),
              ],
            ),
            Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 10, color: c)),
          ],
        ),
      ),
    );
  }

  Widget _scanButton(BuildContext context, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: _active,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: const Padding(
            padding: EdgeInsets.all(12),
            child: Icon(Icons.qr_code_scanner, color: Colors.white, size: 28),
          ),
        ),
      ),
    );
  }
}
