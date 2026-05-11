import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../l10n/string_lookup.dart';

/// RN `KirimNewScreen` — asosiy yoki showroom; sarlavha bosilganda ostida kartada qabul tartibi.
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
    required String warehouse,
  }) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        leading: Icon(leadingIcon, color: const Color(0xFF1A237E)),
        title: Text(title),
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            child: Card(
              margin: EdgeInsets.zero,
              elevation: 1,
              clipBehavior: Clip.antiAlias,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  ListTile(
                    title: Text(StringLookup.t(loc, 'kirimNewMainTabByLocation')),
                    onTap: () => _openKirimForm(context, warehouse: warehouse, newMode: 'byLocation'),
                  ),
                  const Divider(height: 1),
                  ListTile(
                    title: Text(StringLookup.t(loc, 'kirimNewMainTabByProduct')),
                    onTap: () => _openKirimForm(context, warehouse: warehouse, newMode: 'byProduct'),
                  ),
                ],
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
              warehouse: 'main',
            ),
            const SizedBox(height: 12),
            _warehouseCard(
              context: context,
              loc: loc,
              leadingIcon: Icons.storefront,
              title: StringLookup.t(loc, 'kirimWarehouseShowroomCardTitle'),
              warehouse: 'showroom',
            ),
          ],
        ),
      ),
    );
  }
}
