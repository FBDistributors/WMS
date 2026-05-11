import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../l10n/string_lookup.dart';

/// RN `KirimNewScreen` — asosiy yoki showroom; band tanlanganda darhol kirim formasi.
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

  Widget _warehouseRow({
    required BuildContext context,
    required AppLocale loc,
    required IconData leadingIcon,
    required String title,
    required String subtitle,
    required String warehouse,
  }) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: PopupMenuButton<String>(
        onSelected: (String mode) => _openKirimForm(context, warehouse: warehouse, newMode: mode),
        itemBuilder: (BuildContext ctx) => <PopupMenuEntry<String>>[
          PopupMenuItem<String>(
            value: 'byLocation',
            child: Text(StringLookup.t(loc, 'kirimNewMainTabByLocation')),
          ),
          PopupMenuItem<String>(
            value: 'byProduct',
            child: Text(StringLookup.t(loc, 'kirimNewMainTabByProduct')),
          ),
        ],
        child: ListTile(
          leading: Icon(leadingIcon, color: const Color(0xFF1A237E)),
          title: Text(title),
          subtitle: Text(subtitle),
          trailing: const Icon(Icons.arrow_drop_down_rounded),
        ),
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
            _warehouseRow(
              context: context,
              loc: loc,
              leadingIcon: Icons.warehouse,
              title: StringLookup.t(loc, 'kirimWarehouseMainCardTitle'),
              subtitle: StringLookup.t(loc, 'kirimWarehouseMainCardSubtitle'),
              warehouse: 'main',
            ),
            const SizedBox(height: 12),
            _warehouseRow(
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
