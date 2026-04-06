import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/app_state/theme_controller.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/widgets/app_header.dart';
import '../../../shared/widgets/picker_footer.dart';
import '../domain/profile_type_param.dart';
import '../picking_providers.dart';
import '../data/picking_models.dart';

class PickTaskListScreen extends ConsumerStatefulWidget {
  const PickTaskListScreen({super.key});

  @override
  ConsumerState<PickTaskListScreen> createState() => _PickTaskListScreenState();
}

class _PickTaskListScreenState extends ConsumerState<PickTaskListScreen> {
  bool _handledConsolidatedDeepLink = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final Uri uri = GoRouterState.of(context).uri;
    if (uri.queryParameters['openConsolidated'] != '1' || _handledConsolidatedDeepLink) {
      return;
    }
    _handledConsolidatedDeepLink = true;
    final String? barcode = uri.queryParameters['scannedBarcode'];
    final String? key = uri.queryParameters['selectedProductKey'];
    final String? profileQ = uri.queryParameters['profile'];
    final PickerProfileParam profile = pickerProfileFromQuery(profileQ);
    final String p = profileToQuery(profile);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      context.goNamed(
        'pickTasks',
        queryParameters: <String, String>{'profile': p},
      );
      if (!mounted) {
        return;
      }
      context.pushNamed(
        'consolidatedPick',
        queryParameters: <String, String>{
          'profile': p,
          if (barcode != null && barcode.isNotEmpty) 'barcode': barcode,
          if (key != null && key.isNotEmpty) 'selectedProductKey': key,
        },
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final bool isDark = ref.watch(appThemeModeProvider) == ThemeMode.dark;
    final String? qp = GoRouterState.of(context).uri.queryParameters['profile'];
    final PickerProfileParam profile = pickerProfileFromQuery(qp);
    final AsyncValue<List<PickingListItem>> tasks = ref.watch(openPickTasksProvider);

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : Colors.white,
      body: Column(
        children: <Widget>[
          AppHeader(
            title: StringLookup.t(loc, 'openTasks'),
            showBack: true,
            onBack: () => context.goNamed(
              'pickerHome',
              queryParameters: <String, String>{'profile': profileToQuery(profile)},
            ),
            showLogo: true,
            headerBackgroundColor: isDark ? const Color(0xFF1E293B) : Colors.white,
            titleColor: isDark ? const Color(0xFFF1F5F9) : const Color(0xFF333333),
            accentColor: isDark ? const Color(0xFF93C5FD) : const Color(0xFF1A237E),
            onRefresh: () => ref.invalidate(openPickTasksProvider),
          ),
          Expanded(
            child: tasks.when(
              data: (List<PickingListItem> list) {
                if (list.isEmpty) {
                  return Center(child: Text(StringLookup.t(loc, 'openTasksEmpty')));
                }
                return ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: list.length,
                  itemBuilder: (BuildContext context, int i) {
                    final PickingListItem t = list[i];
                    return Card(
                      child: ListTile(
                        title: Text(t.referenceNumber),
                        subtitle: Text('${t.linesDone} / ${t.linesTotal} · ${t.status}'),
                        onTap: () => context.pushNamed(
                          'pickTaskDetail',
                          pathParameters: <String, String>{'taskId': t.id},
                          queryParameters: <String, String>{'profile': profileToQuery(profile)},
                        ),
                      ),
                    );
                  },
                );
              },
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (Object e, _) => Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    Text('$e'),
                    FilledButton(
                      onPressed: () => ref.invalidate(openPickTasksProvider),
                      child: Text(StringLookup.t(loc, 'retry')),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const PickerFooter(current: PickerFooterRoute.pickTaskList),
        ],
      ),
    );
  }
}
