import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../l10n/string_lookup.dart';

/// RN `KirimNewScreen` — asosiy yoki showroom; to‘liq kenglikdagi dropdown, tanlovda darhol forma.
class KirimNewScreen extends ConsumerWidget {
  const KirimNewScreen({super.key});

  void _onBack(BuildContext context) {
    context.goNamed('kirim');
  }

  void _openKirimForm(BuildContext context, {required String warehouse, required String newMode}) {
    context.pushNamed(
      'kirimForm',
      queryParameters: <String, String>{
        'flow': 'new',
        'warehouse': warehouse,
        'newMode': newMode,
      },
    );
  }

  Widget _warehouseCard({
    required BuildContext context,
    required AppLocale loc,
    required IconData leadingIcon,
    required String title,
    required String subtitle,
    required String warehouse,
  }) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          ListTile(
            leading: Icon(leadingIcon, color: const Color(0xFF1A237E)),
            title: Text(title),
            subtitle: Text(subtitle),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: null,
                isExpanded: true,
                hint: Text(
                  StringLookup.t(loc, 'kirimNewSelectModeHint'),
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                borderRadius: BorderRadius.circular(8),
                items: <DropdownMenuItem<String>>[
                  DropdownMenuItem<String>(
                    value: 'byLocation',
                    child: Text(StringLookup.t(loc, 'kirimNewMainTabByLocation')),
                  ),
                  DropdownMenuItem<String>(
                    value: 'byProduct',
                    child: Text(StringLookup.t(loc, 'kirimNewMainTabByProduct')),
                  ),
                ],
                onChanged: (String? v) {
                  if (v != null) {
                    _openKirimForm(context, warehouse: warehouse, newMode: v);
                  }
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocale loc = ref.watch(appLocaleProvider);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (bool didPop, Object? result) {
        if (!didPop) {
          _onBack(context);
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(StringLookup.t(loc, 'kirimNewProducts')),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => _onBack(context),
          ),
        ),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            _warehouseCard(
              context: context,
              loc: loc,
              leadingIcon: Icons.warehouse,
              title: StringLookup.t(loc, 'kirimWarehouseMainCardTitle'),
              subtitle: StringLookup.t(loc, 'kirimWarehouseMainCardSubtitle'),
              warehouse: 'main',
            ),
            const SizedBox(height: 12),
            _warehouseCard(
              context: context,
              loc: loc,
              leadingIcon: Icons.storefront,
              title: StringLookup.t(loc, 'kirimWarehouseShowroomCardTitle'),
              subtitle: StringLookup.t(loc, 'kirimWarehouseShowroomCardSubtitle'),
              warehouse: 'showroom',
            ),
          ],
        ),
      ),
    );
  }
}
