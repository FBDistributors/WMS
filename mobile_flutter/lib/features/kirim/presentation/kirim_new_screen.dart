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
            DefaultTabController(
              length: 2,
              child: Card(
                clipBehavior: Clip.antiAlias,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          const Icon(Icons.warehouse, color: Color(0xFF1A237E)),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Text(
                                  StringLookup.t(loc, 'kirimWarehouseMainCardTitle'),
                                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                        fontWeight: FontWeight.w600,
                                      ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  StringLookup.t(loc, 'kirimWarehouseMainCardSubtitle'),
                                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                                      ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    TabBar(
                      tabs: <Widget>[
                        Tab(text: StringLookup.t(loc, 'kirimNewMainTabByLocation')),
                        Tab(text: StringLookup.t(loc, 'kirimNewMainTabByProduct')),
                      ],
                    ),
                    SizedBox(
                      height: 228,
                      child: TabBarView(
                        children: <Widget>[
                          Padding(
                            padding: const EdgeInsets.all(16),
                            child: SingleChildScrollView(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: <Widget>[
                                  Text(
                                    StringLookup.t(loc, 'kirimNewMainTabByLocationHint'),
                                    style: Theme.of(context).textTheme.bodySmall,
                                  ),
                                  const SizedBox(height: 12),
                                  FilledButton(
                                    onPressed: () => context.pushNamed(
                                      'kirimForm',
                                      queryParameters: <String, String>{
                                        'flow': 'new',
                                        'warehouse': 'main',
                                        'newMode': 'byLocation',
                                      },
                                    ),
                                    child: Text(StringLookup.t(loc, 'kirimNewMainContinue')),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.all(16),
                            child: SingleChildScrollView(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: <Widget>[
                                  Text(
                                    StringLookup.t(loc, 'kirimNewMainTabByProductHint'),
                                    style: Theme.of(context).textTheme.bodySmall,
                                  ),
                                  const SizedBox(height: 12),
                                  FilledButton(
                                    onPressed: () => context.pushNamed(
                                      'kirimForm',
                                      queryParameters: <String, String>{
                                        'flow': 'new',
                                        'warehouse': 'main',
                                        'newMode': 'byProduct',
                                      },
                                    ),
                                    child: Text(StringLookup.t(loc, 'kirimNewMainContinue')),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
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
