import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../l10n/string_lookup.dart';

/// RN `KirimNewScreen` — asosiy yoki showroom.
class KirimNewScreen extends ConsumerWidget {
  const KirimNewScreen({super.key});

  void _onBack(BuildContext context) {
    context.goNamed('kirim');
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
            Card(
              child: ListTile(
                leading: const Icon(Icons.warehouse, color: Color(0xFF1A237E)),
                title: Text(StringLookup.t(loc, 'kirimWarehouseMainCardTitle')),
                subtitle: Text(StringLookup.t(loc, 'kirimWarehouseMainCardSubtitle')),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.pushNamed(
                  'kirimForm',
                  queryParameters: <String, String>{
                    'flow': 'new',
                    'warehouse': 'main',
                  },
                ),
              ),
            ),
            Card(
              child: ListTile(
                leading: const Icon(Icons.storefront, color: Color(0xFF1A237E)),
                title: Text(StringLookup.t(loc, 'kirimWarehouseShowroomCardTitle')),
                subtitle: Text(StringLookup.t(loc, 'kirimWarehouseShowroomCardSubtitle')),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.pushNamed(
                  'kirimForm',
                  queryParameters: <String, String>{
                    'flow': 'new',
                    'warehouse': 'showroom',
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
